export type RequestPriority = "high" | "normal" | "low";

/**
 * Providers retain and reuse policy objects so the broker can preserve the
 * scheduler state belonging to each independently governed request group.
 */
export type RequestPolicy = Readonly<{
  id: string;
  delayMs: number;
}>;

/**
 * Represents one request submitted to the broker. The result settles only
 * after the provider's response handler has completed.
 */
export type BrokerTask<T> = Readonly<{
  result: Promise<T>;
}>;

export type BrokerRequestOptions<T> = Readonly<{
  policy: RequestPolicy;
  priority: RequestPriority;
  request: Request;
  handleResponse(response: Response): Promise<T>;
}>;

export type QueuedTask = BrokerTask<unknown> & {
  priority: RequestPriority;
  reject(error: unknown): void;
};

export type RequestQueue = {
  delayMs: number;
  high: QueuedTask[];
  normal: QueuedTask[];
  low: QueuedTask[];
  active: QueuedTask | null;
  running: boolean;
};
