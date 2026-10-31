import { broker, RequestCancelledError, type BrokerRequestOptions, type BrokerTask, type RequestBroker, type RequestPriority } from "../requestBroker";
import { cache, type CachedFile } from "../resourceCache";

const ranks: Record<RequestPriority, number> = { low: 0, normal: 1, high: 2 };

export type ResourceLease<T> = {
  result: Promise<T>;
  release(): void;
  setPriority(priority: RequestPriority): void;
};

export type ProviderIO = {
  request<T>(options: Omit<BrokerRequestOptions<T>, "priority" | "interruptWhenUnneeded">): Promise<T>;
  use<T>(key: string, load: (io: ProviderIO) => Promise<T>): Promise<T>;
  cachedFile(key: string, load: () => Promise<CachedFile>): Promise<CachedFile>;
  requestFile(options: Omit<BrokerRequestOptions<CachedFile>, "priority" | "interruptWhenUnneeded" | "handleResponse"> & {
    cacheKey: string;
    validate(response: Response): string | Promise<string>;
  }): Promise<CachedFile>;
};

type Acquisition = {
  key: string;
  consumers: Map<symbol, RequestPriority>;
  tasks: Set<BrokerTask<unknown>>;
  dependencies: Set<ResourceLease<unknown>>;
  result: Promise<unknown>;
};

// A provider supplies resource identities and loaders. Ownership, sharing and
// cancellation apply equally to media and its shared HTML/index dependencies.
export class ResourceAcquisitions {
  private readonly entries = new Map<string, Acquisition>();

  constructor(private readonly requests: RequestBroker = broker) {}

  acquire<T>(key: string, load: (io: ProviderIO) => Promise<T>, priority: RequestPriority, signal?: AbortSignal): ResourceLease<T> {
    if (signal?.aborted) return cancelledLease<T>();
    let entry = this.entries.get(key);
    if (entry && [...entry.tasks].some((task) => task.cancelled)) entry = undefined;
    const consumer = Symbol();
    if (!entry) {
      entry = { key, consumers: new Map([[consumer, priority]]), tasks: new Set(), dependencies: new Set(), result: Promise.resolve() };
      this.entries.set(key, entry);
      const created = entry;
      // Register ownership before the provider can submit its first request.
      created.result = Promise.resolve().then(() => load(this.ioFor(created)));
      const cleanup = () => {
        if (this.entries.get(key) === created) this.entries.delete(key);
      };
      void created.result.then(cleanup, cleanup);
    } else {
      entry.consumers.set(consumer, priority);
      this.reconcile(entry);
    }
    const acquisition = entry;
    let released = false;
    let rejectConsumer!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      rejectConsumer = reject;
      void acquisition.result.then((value) => { if (!released) resolve(value as T); }, (error) => { if (!released) reject(error); });
    });
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener("abort", release);
      acquisition.consumers.delete(consumer);
      rejectConsumer(new RequestCancelledError());
      this.reconcile(acquisition);
    };
    signal?.addEventListener("abort", release, { once: true });
    if (signal?.aborted) release();
    const detach = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener("abort", release);
      acquisition.consumers.delete(consumer);
      this.reconcile(acquisition);
    };
    void result.then(detach, detach);
    return {
      result, release,
      setPriority: (next) => {
        if (released) return;
        acquisition.consumers.set(consumer, next);
        this.reconcile(acquisition);
      }
    };
  }

  private priority(entry: Acquisition): RequestPriority {
    let priority: RequestPriority = "low";
    for (const current of entry.consumers.values()) {
      if (ranks[current] > ranks[priority]) priority = current;
    }
    return priority;
  }

  private reconcile(entry: Acquisition): void {
    const priority = this.priority(entry);
    if (entry.consumers.size > 0) {
      for (const task of entry.tasks) this.requests.setPriority(task, priority);
      for (const dependency of entry.dependencies) dependency.setPriority(priority);
      return;
    }
    for (const dependency of entry.dependencies) dependency.release();
    let finishing = false;
    for (const task of entry.tasks) {
      this.requests.cancel(task, "obsolete");
      if (task.state === "active" && !task.cancelled) finishing = true;
    }
    // An active orphan may be rejoined until the broker aborts it to unblock
    // foreground work. Queued/cancelled work must never be joined again.
    if (!finishing && this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  }

  private ioFor(entry: Acquisition): ProviderIO {
    const assertNeeded = () => {
      if (entry.consumers.size === 0) throw new RequestCancelledError();
    };
    const request = async <T>(options: Omit<BrokerRequestOptions<T>, "priority" | "interruptWhenUnneeded">): Promise<T> => {
        assertNeeded();
        const task = this.requests.request({
          ...options,
          priority: this.priority(entry),
          interruptWhenUnneeded: () => entry.consumers.size === 0
        });
        entry.tasks.add(task);
        try { return await task.result; }
        finally { entry.tasks.delete(task); }
      };
    return {
      request,
      cachedFile: async (key, load) => {
        const cached = await cache.find(key);
        if (cached) return cached;
        assertNeeded();
        return load();
      },
      requestFile: (options) => request({
        ...options,
        handleResponse: async (response) => {
          try {
            const contentType = await options.validate(response);
            if (!response.body) throw new Error("The provider returned an empty media response.");
            return await cache.writeStream(options.cacheKey, { contentType, stream: response.body });
          } catch (error) {
            await response.body?.cancel().catch(() => {});
            throw error;
          }
        }
      }),
      use: async <T>(key: string, load: (io: ProviderIO) => Promise<T>): Promise<T> => {
        assertNeeded();
        const lease = this.acquire(key, load, this.priority(entry));
        entry.dependencies.add(lease);
        try {
          const value = await lease.result;
          assertNeeded();
          return value;
        } finally {
          entry.dependencies.delete(lease);
          lease.release();
        }
      }
    };
  }
}

function cancelledLease<T>(): ResourceLease<T> {
  return { result: Promise.reject(new RequestCancelledError()), release() {}, setPriority() {} };
}
