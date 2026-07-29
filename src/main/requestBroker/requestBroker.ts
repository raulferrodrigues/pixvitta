import { app, dialog, net } from "electron";
import type {
  BrokerRequestOptions,
  BrokerTask,
  RequestPolicy,
  RequestPriority
} from "./types";

type TaskState = "queued" | "active" | "completed";

type QueuedTask = BrokerTask<unknown> & {
  priority: RequestPriority;
  request: Request;
  handleResponse(response: Response): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  queue: RequestQueue;
  state: TaskState;
  abortController: AbortController | null;
};

type RequestQueue = {
  id: string;
  delayMs: number;
  high: QueuedTask[];
  normal: QueuedTask[];
  low: QueuedTask[];
  active: QueuedTask | null;
  running: boolean;
};

const queues: {
  [policyId: string]: RequestQueue | undefined;
} = {};

let halted = false;
let haltDialogShown = false;

class RequestBrokerHaltedError extends Error {
  constructor() {
    super("Provider requests are halted for the remainder of this app session.");
    this.name = "RequestBrokerHaltedError";
  }
}

function validatePolicy(policy: RequestPolicy): void {
  if (!policy.id.trim()) {
    throw new Error("Request policy IDs must not be empty.");
  }
  if (!Number.isFinite(policy.delayMs) || policy.delayMs < 0) {
    throw new Error("Request policy delays must be finite and nonnegative.");
  }
}

function getQueue(policy: RequestPolicy): RequestQueue {
  validatePolicy(policy);
  const existing = queues[policy.id];
  if (existing) {
    if (existing.delayMs !== policy.delayMs) {
      throw new Error(
        `Request policy "${policy.id}" was reused with a different delay.`
      );
    }
    return existing;
  }

  const queue: RequestQueue = {
    id: policy.id,
    delayMs: policy.delayMs,
    high: [],
    normal: [],
    low: [],
    active: null,
    running: false
  };
  queues[policy.id] = queue;
  return queue;
}

function takeNextTask(queue: RequestQueue): QueuedTask | null {
  return (
    queue.high.shift() ??
    queue.normal.shift() ??
    queue.low.shift() ??
    null
  );
}

function showHaltDialog(): void {
  if (haltDialogShown) return;
  haltDialogShown = true;
  void dialog
    .showMessageBox({
      type: "error",
      title: "Request limit reached",
      message:
        "Pixvitta was rate-limited by a media provider and must quit to stop further requests.",
      buttons: ["Quit Pixvitta"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    .then(
      () => app.quit(),
      (error: unknown) => {
        console.error("Could not show the request-limit dialog.", error);
        app.quit();
      }
    );
}

function rejectQueuedTasks(queue: RequestQueue, error: Error): void {
  for (const lane of [queue.high, queue.normal, queue.low]) {
    for (const task of lane.splice(0)) {
      task.state = "completed";
      task.reject(error);
    }
  }
}

function haltBroker(): RequestBrokerHaltedError {
  const error = new RequestBrokerHaltedError();
  if (halted) return error;

  halted = true;
  for (const queue of Object.values(queues)) {
    if (!queue) continue;
    if (queue.active) {
      queue.active.abortController?.abort(error);
      queue.active.reject(error);
    }
    rejectQueuedTasks(queue, error);
  }
  showHaltDialog();
  return error;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The broker is already abandoning this response.
  }
}

async function runTask(task: QueuedTask): Promise<void> {
  task.state = "active";
  const abortController = new AbortController();
  task.abortController = abortController;
  const request = new Request(task.request, {
    signal: AbortSignal.any([
      task.request.signal,
      abortController.signal
    ])
  });

  const response = await net.fetch(request);
  if (response.status === 429) {
    await cancelBody(response);
    throw haltBroker();
  }

  const result = await task.handleResponse(response);
  task.resolve(result);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runQueue(queue: RequestQueue): Promise<void> {
  if (halted || queue.running) {
    return;
  }

  queue.running = true;

  try {
    while (!halted) {
      const task = takeNextTask(queue);
      if (!task) {
        return;
      }

      queue.active = task;

      try {
        await runTask(task);
      } catch (error) {
        task.reject(error);
      } finally {
        task.state = "completed";
        task.abortController = null;
        queue.active = null;
      }

      if (halted) {
        return;
      }

      await wait(queue.delayMs);
    }
  } finally {
    queue.active = null;
    queue.running = false;
  }
}

export const broker = {
  /**
   * Submits provider network work to the process-wide request broker.
   */
  request<T>(options: BrokerRequestOptions<T>): BrokerTask<T> {
    const queue = getQueue(options.policy);
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const task: QueuedTask = {
      result,
      priority: options.priority,
      request: options.request,
      handleResponse: options.handleResponse as (
        response: Response
      ) => Promise<unknown>,
      resolve: resolveResult as (value: unknown) => void,
      reject: rejectResult,
      queue,
      state: "queued",
      abortController: null
    };

    if (halted) {
      task.state = "completed";
      task.reject(new RequestBrokerHaltedError());
      return task as BrokerTask<T>;
    }

    queue[options.priority].push(task);
    void runQueue(queue);
    return task as BrokerTask<T>;
  },

  /**
   * Raises a queued task's priority. Active and completed tasks are unchanged.
   */
  promote(
    task: BrokerTask<unknown>,
    priority: RequestPriority
  ): void {
    const queuedTask = task as Partial<QueuedTask>;
    if (
      queuedTask.state !== "queued" ||
      !queuedTask.queue ||
      !queuedTask.priority
    ) {
      return;
    }

    const ranks: Record<RequestPriority, number> = {
      low: 0,
      normal: 1,
      high: 2
    };
    if (ranks[priority] <= ranks[queuedTask.priority]) return;

    const lane = queuedTask.queue[queuedTask.priority];
    const index = lane.indexOf(queuedTask as QueuedTask);
    if (index < 0) return;

    lane.splice(index, 1);
    queuedTask.priority = priority;
    queuedTask.queue[priority].push(queuedTask as QueuedTask);
  }
};
