import { createRequestBroker } from "../requestBroker/scheduler";
import type { BrokerRequestOptions, BrokerTask, RequestBroker, RequestPolicy } from "../requestBroker/types";

/*
 * scripts/run-tests.mjs swaps src/main/requestBroker/requestBroker.ts for this
 * file in test bundles. The scheduler is the real one, so priorities, queues,
 * cancellation, and the 429 halt all behave as in the app. Only two things
 * differ: pacing delays finish instantly so tests stay fast, and each request
 * is recorded with its policy so tests can check that the delay it asked for
 * honors the upstream's limit. E2E tests cover real pacing on the wire.
 */

export type SubmittedRequest = {
  url: string;
  policy: RequestPolicy;
};

function refuseLiveNetwork(request: Request): Promise<Response> {
  throw new Error(`Live networking is disabled in tests. Attempted: ${request.url}`);
}

function createInnerBroker(fetch: (request: Request) => Promise<Response>): RequestBroker {
  return createRequestBroker({
    fetch,
    wait: async () => {},
    onRateLimit: () => { brokerControl.rateLimitHalts += 1; }
  });
}

export const brokerControl = {
  submitted: [] as SubmittedRequest[],
  rateLimitHalts: 0,
  // Each flow test gets a fresh broker bound to its own fake web. A 429 halts a
  // broker permanently, and prefetch left running by the previous test stays
  // with the previous test's world instead of leaking into this one.
  reset(fetch: (request: Request) => Promise<Response>): void {
    this.submitted = [];
    this.rateLimitHalts = 0;
    inner = createInnerBroker(fetch);
  }
};

let inner = createInnerBroker(refuseLiveNetwork);

export const broker: RequestBroker = {
  request<T>(options: BrokerRequestOptions<T>): BrokerTask<T> {
    brokerControl.submitted.push({ url: options.request.url, policy: options.policy });
    return inner.request(options);
  },
  setPriority: (task, priority) => inner.setPriority(task, priority),
  cancel: (task, mode) => inner.cancel(task, mode)
};
