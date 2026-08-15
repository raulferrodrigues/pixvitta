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
  timeoutMs?: number;
  handleResponse(response: Response): Promise<T>;
}>;
