import type {
  BrokerRequestOptions,
  BrokerTask,
  QueuedTask,
  RequestPolicy,
  RequestPriority,
  RequestQueue
} from "./types";

const queues: {
  [policyId: string]: RequestQueue | undefined;
} = {};

let halted = false;

function getQueue(policy: RequestPolicy): RequestQueue {
  throw new Error("Request queues have not been implemented.");
}

function takeNextTask(queue: RequestQueue): QueuedTask | null {
  return (
    queue.high.shift() ??
    queue.normal.shift() ??
    queue.low.shift() ??
    null
  );
}

async function runTask(task: QueuedTask): Promise<void> {
  throw new Error("Brokered network requests have not been implemented.");
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
    throw new Error("The request broker has not been implemented.");
  },

  /**
   * Raises a queued task's priority. Active and completed tasks are unchanged.
   */
  promote(
    task: BrokerTask<unknown>,
    priority: RequestPriority
  ): void {
    throw new Error("The request broker has not been implemented.");
  }
};
