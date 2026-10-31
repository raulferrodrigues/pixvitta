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
  state: "queued" | "active" | "completed";
  cancelled: boolean;
}>;

export type BrokerRequestOptions<T> = Readonly<{
  policy: RequestPolicy;
  priority: RequestPriority;
  request: Request;
  fetch?: (request: Request) => Promise<Response>;
  timeoutMs?: number;
  interruptWhenUnneeded?: () => boolean;
  handleResponse(response: Response): Promise<T>;
}>;

export type RequestBroker = {
  request<T>(options: BrokerRequestOptions<T>): BrokerTask<T>;
  setPriority(task: BrokerTask<unknown>, priority: RequestPriority): void;
  /** "obsolete" aborts active work only when it is unneeded and blocks high priority work. */
  cancel(task: BrokerTask<unknown>, mode?: "all" | "queued" | "obsolete"): boolean;
};
