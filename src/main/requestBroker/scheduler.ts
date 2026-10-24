import type { BrokerRequestOptions, BrokerTask, RequestBroker, RequestPolicy, RequestPriority } from "./types";

export class RequestCancelledError extends Error {
  constructor() {
    super("The request is no longer needed.");
    this.name = "AbortError";
  }
}

type Task = {
  result: Promise<unknown>;
  state: "queued" | "active" | "completed";
  cancelled: boolean;
  priority: RequestPriority;
  options: BrokerRequestOptions<unknown>;
  queue: Queue;
  controller: AbortController | null;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
};

type Queue = {
  id: string;
  delayMs: number;
  high: Task[];
  normal: Task[];
  low: Task[];
  active: Task | null;
  running: boolean;
};

const ranks: Record<RequestPriority, number> = { low: 0, normal: 1, high: 2 };

export function createRequestBroker(dependencies: {
  fetch(request: Request): Promise<Response>;
  wait?: (milliseconds: number) => Promise<void>;
  onRateLimit(): void;
  debug?(message: string): void;
}): RequestBroker {
  const queues = new Map<string, Queue>();
  const tasks = new WeakMap<BrokerTask<unknown>, Task>();
  const wait = dependencies.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let halted = false;

  function queueFor(policy: RequestPolicy): Queue {
    if (!policy.id.trim() || !Number.isFinite(policy.delayMs) || policy.delayMs < 0) {
      throw new Error("Request policies require an ID and a finite nonnegative delay.");
    }
    const existing = queues.get(policy.id);
    if (existing) {
      if (existing.delayMs !== policy.delayMs) throw new Error(`Request policy "${policy.id}" was reused with a different delay.`);
      return existing;
    }
    const queue: Queue = { id: policy.id, delayMs: policy.delayMs, high: [], normal: [], low: [], active: null, running: false };
    queues.set(policy.id, queue);
    return queue;
  }

  function cancel(task: Task, includeActive: boolean): boolean {
    if (task.cancelled || task.state === "completed" || (task.state === "active" && !includeActive)) return false;
    task.cancelled = true;
    dependencies.debug?.(`cancelled policy=${task.queue.id} state=${task.state}`);
    const error = new RequestCancelledError();
    if (task.state === "queued") {
      const lane = task.queue[task.priority];
      const index = lane.indexOf(task);
      if (index >= 0) lane.splice(index, 1);
      task.state = "completed";
      task.cleanup();
      task.reject(error);
    } else {
      // The worker stays occupied until response handling and stream cleanup end.
      task.controller?.abort(error);
    }
    return true;
  }

  function halt(): Error {
    const error = new Error("Provider requests are halted for the remainder of this app session.");
    if (halted) return error;
    halted = true;
    for (const queue of queues.values()) {
      if (queue.active) {
        queue.active.controller?.abort(error);
        queue.active.reject(error);
      }
      for (const lane of [queue.high, queue.normal, queue.low]) {
        for (const task of lane.splice(0)) {
          task.state = "completed";
          task.cleanup();
          task.reject(error);
        }
      }
    }
    dependencies.onRateLimit();
    return error;
  }

  async function runTask(task: Task): Promise<void> {
    task.state = "active";
    dependencies.debug?.(`started policy=${task.queue.id} priority=${task.priority} timeoutMs=${task.options.timeoutMs ?? "none"}`);
    task.controller = new AbortController();
    const signals = [task.options.request.signal, task.controller.signal];
    if (task.options.timeoutMs !== undefined) signals.push(AbortSignal.timeout(task.options.timeoutMs));
    const request = new Request(task.options.request, { signal: AbortSignal.any(signals) });
    const response = await (task.options.fetch ?? dependencies.fetch)(request);
    if (request.signal.aborted || response.status === 429) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429) throw halt();
      request.signal.throwIfAborted();
    }
    const result = await task.options.handleResponse(response);
    request.signal.throwIfAborted();
    task.resolve(result);
    dependencies.debug?.(`completed policy=${task.queue.id} priority=${task.priority} delayMs=${task.queue.delayMs}`);
  }

  async function run(queue: Queue): Promise<void> {
    if (queue.running || halted) return;
    queue.running = true;
    try {
      while (!halted) {
        const task = queue.high.pop() ?? queue.normal.pop() ?? queue.low.shift();
        if (!task) return;
        queue.active = task;
        try {
          await runTask(task);
        } catch (error) {
          task.reject(error);
        } finally {
          task.state = "completed";
          task.controller = null;
          task.cleanup();
          queue.active = null;
        }
        // Started requests consume the normal delay even when aborted.
        if (!halted) await wait(queue.delayMs);
      }
    } finally {
      queue.active = null;
      queue.running = false;
    }
  }

  function setPriority(task: Task, priority: RequestPriority): void {
    if (task.state !== "queued" || task.cancelled || task.priority === priority) return;
    const lane = task.queue[task.priority];
    const index = lane.indexOf(task);
    if (index < 0) return;
    lane.splice(index, 1);
    const previous = task.priority;
    task.priority = priority;
    dependencies.debug?.(`priority policy=${task.queue.id} changed=${previous}->${priority}`);
    task.queue[priority].push(task);
    if (priority === "high" && task.queue.active?.options.interruptWhenUnneeded?.()) cancel(task.queue.active, true);
  }

  return {
    request<T>(options: BrokerRequestOptions<T>): BrokerTask<T> {
      if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
        throw new Error("Request timeouts must be finite and positive.");
      }
      const queue = queueFor(options.policy);
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<T>((resolveResult, rejectResult) => { resolve = resolveResult; reject = rejectResult; });
      const task: Task = {
        result, state: "queued", cancelled: false, priority: options.priority,
        options: options as BrokerRequestOptions<unknown>, queue, controller: null,
        resolve: resolve as (value: unknown) => void, reject, cleanup: () => {}
      };
      const handle = task as BrokerTask<T>;
      tasks.set(handle, task);
      if (halted) {
        task.state = "completed";
        task.reject(new Error("Provider requests are halted for the remainder of this app session."));
        return handle;
      }
      queue[options.priority].push(task);
      const abort = () => { cancel(task, true); };
      options.request.signal.addEventListener("abort", abort, { once: true });
      task.cleanup = () => options.request.signal.removeEventListener("abort", abort);
      if (options.request.signal.aborted) abort();
      if (options.priority === "high" && queue.active?.options.interruptWhenUnneeded?.()) cancel(queue.active, true);
      void run(queue);
      return handle;
    },
    cancel(handle, mode = "all") {
      const task = tasks.get(handle);
      if (!task) return false;
      if (mode === "obsolete" && task.state === "active" &&
          (task.queue.high.length === 0 || !task.options.interruptWhenUnneeded?.())) return false;
      return cancel(task, mode !== "queued");
    },
    setPriority(handle, priority) {
      const task = tasks.get(handle);
      if (task) setPriority(task, priority);
    },
    promote(handle, priority) {
      const task = tasks.get(handle);
      if (task && ranks[priority] > ranks[task.priority]) setPriority(task, priority);
    }
  };
}
