# Request Broker

## Status

Implemented on the background-download redesign feature branch. Automated
validation is complete; provider behavior still requires the planned manual
verification.

## Main goal

The request broker must be the only component that performs network requests
for providers.

This is the broker's primary purpose: provider code must not bypass centrally
enforced request limits and send too many requests on the user's behalf.

Queuing, caching, priorities, cancellation, and diagnostics are supporting
behaviors. They must not weaken this guarantee.

## Lifetime and public API

The Electron main process owns one request-broker singleton for the app
session. Every remote provider uses that same broker. The broker still owns
independent scheduler state for each provider-owned request policy.

The broker exposes two operations:

- `request`, which submits provider network work and returns the task
  representing its complete result;
- `promote`, which raises the priority of a queued task and is a no-op after
  that task has started or finished.

The broker does not expose cancellation, retry, pause, resume, policy
registration, direct queue mutation, or manual recovery operations.

The signatures live in `src/main/requestBroker`:

```ts
type RequestPriority = "high" | "normal" | "low";

type RequestPolicy = Readonly<{
  id: string;
  delayMs: number;
}>;

type BrokerTask<T> = Readonly<{
  result: Promise<T>;
}>;

type BrokerRequestOptions<T> = Readonly<{
  policy: RequestPolicy;
  priority: RequestPriority;
  request: Request;
  handleResponse(response: Response): Promise<T>;
}>;
```

The process-wide `broker` singleton exposes `request` and `promote`. The
generic response handler consumes or cancels the complete response body before
settling. For media, it streams the complete body into the cache and does not
settle until the cache entry is atomically committed.

## Enforcement

Provider code is required to route every network request through the broker.
This rule will initially be enforced through the application architecture and
code review rather than an automated repository restriction.

If direct provider networking is accidentally introduced again, an automated
rule that rejects direct network-transport access from provider code should be
reconsidered.

## Provider, broker, and cache ownership

The request broker knows nothing about caches, assets, cache identities, or
how a provider extracts an asset from a response.

The provider owns the cache-aware acquisition flow:

1. The provider checks its in-progress acquisitions for the cache key.
2. An existing acquisition is promoted when appropriate and its promise is
   returned.
3. Otherwise, the provider records a new in-progress acquisition and checks
   its cache.
4. A cache hit is returned without entering the request broker because no
   network request is needed.
5. On a miss, the provider submits each required network request to the broker
   with the appropriate policy and priority.
6. The broker performs the network request and checks the response for the
   broker-level terminal condition.
7. The broker gives the live response to provider-owned response handling and
   waits for that handling to finish. The request remains active in its policy
   for this entire period.
8. The provider interprets the response and, when appropriate, passes its
   body to the cache's streaming-write operation.
9. The broker resolves the request with the provider-owned handler's result
   only after response handling has completed or failed.
10. The provider clears the in-progress acquisition and returns the completed
    asset to every joined caller.

A provider acquisition may require multiple brokered requests. For example, a
provider may first request and parse an HTML page to discover the URL of the
actual asset, then make a second brokered request for that asset.

Caching is not a request-broker responsibility. Partially written responses
must not appear as completed cache entries.

The broker must not buffer an entire large response, such as a video, in
memory merely to hand it to the provider. The response body is a stream. The
cache's streaming-write operation consumes that stream incrementally and
writes each received chunk to a temporary file. The provider invokes the
operation once with the stream; the repeated chunk reads and file writes
happen inside the cache.

The cache owns creating, writing, cleaning up, and atomically committing the
temporary file. The provider owns deciding whether a response represents a
cacheable asset and supplies the asset metadata required by the cache. The
broker remains occupied while the provider's response handler awaits the
cache operation.

Conceptually, the cache may support both streaming a response body into a
cache entry and storing an already-complete file or byte value. Streaming is
the normal path for large brokered responses. In either case, an entry becomes
visible as a valid cache hit only after writing and validation succeed and the
temporary entry is committed atomically.

### Reading completed cache entries

A completed cache entry gives the provider:

- the local filesystem path of the cached file;
- its content type;
- its byte length.

The cache does not need to wrap the file in a read-only file descriptor,
construct a response, or prescribe how its contents are read. The provider
uses normal Node filesystem APIs and may read the entire file, read a byte
range, or create a stream, depending on what that provider operation needs.

Providers treat cached files as immutable and must never modify them. This is
an application architecture rule; the cache does not need operating-system
enforcement against trusted provider code.

The filesystem path remains in the Electron main process. A provider may use
it to construct the response needed by the application's media protocol, but
the raw local path or a `file://` URL is not exposed directly to the renderer.

### Cache storage API

The session cache is one process-wide singleton with a small
provider-facing API:

```ts
type CachedFile = Readonly<{
  filePath: string;
  contentType: string;
  byteLength: number;
}>;

const cache = {
  find(key: string): Promise<CachedFile | null>;

  writeStream(
    key: string,
    source: {
      contentType: string;
      stream: ReadableStream<Uint8Array>;
    }
  ): Promise<CachedFile>;

  writeFile(
    key: string,
    source: {
      contentType: string;
      bytes: Uint8Array;
    }
  ): Promise<CachedFile>;
};
```

`find` returns a completed disk-backed cache entry without reading its contents
into memory.

`writeStream` owns creating a unique temporary file, incrementally consuming
the supplied stream, cleaning up after failure, measuring the completed byte
length, and atomically committing the entry.

`writeFile` provides the equivalent path when the provider already has the
complete file bytes. Both write operations return the completed `CachedFile`.

Writes for different cache keys may run concurrently. Each write owns its own
temporary file and commits independently; the cache does not have one global
write queue.

Because every provider uses the same cache singleton, providers supply
globally unique cache keys that include their provider and resource identity.

The cache API does not construct responses, open read streams, or otherwise
wrap ordinary Node filesystem access. The provider decides how to consume the
file represented by `CachedFile`.

The cache root is `<userData>/resource-cache/v1`. At app readiness one shared
preparation promise removes that root and the legacy `<userData>/media-cache`
tree, then recreates the new root. Every cache operation awaits the same
preparation. Entries are immutable for the remainder of the app session and
are not retained across restarts.

Each cache key is hashed to one entry directory containing `file` and
`metadata.json`. A write is completed in a unique temporary directory and
becomes visible through one atomic directory rename. The metadata records the
content type and completed byte length. Empty, malformed, or length-mismatched
entries are invalid.

### Joining acquisition of the same resource

Each provider keeps one ordinary JavaScript object indexed by cache key for
resource acquisitions that are currently in progress. No separate acquisition
coordinator, class, or cache feature is needed.

When a caller asks the provider for a resource, the provider synchronously
checks that object. If the cache key is already present, the caller joins the
existing acquisition by awaiting its promise instead of starting another
network request or cache write.

If the new caller has a higher priority, the provider records the higher
priority on the existing entry and asks the broker to promote its queued
request. Promotion has no effect if the request is already active, its response
is being written, or the cache entry is being committed; the new caller simply
waits for the existing acquisition to finish.

The provider creates and stores a new in-progress entry before its first
asynchronous cache lookup or network operation. It removes the entry only
after the acquisition has failed or the completed cache entry has been
committed. This ensures that another caller arriving after the response stream
ends but before the cache commit still joins the same work.

The intended shape is approximately:

```js
const inFlight = {};

function getResource(cacheKey, requestedPriority) {
  const existing = inFlight[cacheKey];

  if (existing) {
    if (requestedPriority > existing.priority) {
      existing.priority = requestedPriority;

      if (existing.brokerRequest) {
        broker.promote(existing.brokerRequest, requestedPriority);
      }
    }

    return existing.promise;
  }

  const entry = {
    priority: requestedPriority,
    brokerRequest: null,
    promise: null
  };

  inFlight[cacheKey] = entry;

  entry.promise = acquireResource(cacheKey, entry);

  const cleanup = () => {
    if (inFlight[cacheKey] === entry) {
      delete inFlight[cacheKey];
    }
  };
  void entry.promise.then(cleanup, cleanup);

  return entry.promise;
}
```

`acquireResource` covers the cache lookup, brokered network work, streamed
write, and cache commit. Returning its promise lets every caller await the same
complete operation. Using both fulfillment and rejection cleanup handlers
avoids creating an ignored rejected promise through `finally`.

The cache remains unaware of callers and request priorities.

## Existing provider migration

Both existing remote providers require network-boundary changes:

- every 4chan metadata, thumbnail, and media request must use the broker;
- every E-Hentai metadata, gallery-page, image-page, thumbnail, and final
  asset request must use the broker;
- provider-local pacing queues and throttling machinery must be removed where
  the broker takes over that responsibility.

Provider-specific URL construction, parsing, response validation, and cache
decisions remain provider responsibilities and should be retained where they
are still appropriate.

The local-filesystem provider does not perform remote requests and does not
need to enter the broker.

The provider-facing media request path carries priority explicitly:

```ts
type MediaResource = {
  respond(
    request: Request,
    priority: RequestPriority
  ): Promise<Response>;
};
```

Media protocol requests default to high priority, thumbnail requests use
normal priority, and filmstrip fallback media marked with
`intent=prefetch` uses low priority.

Every remote image, thumbnail, and video is downloaded and committed in full
before the provider returns a response to Chromium. An incoming browser range
is not forwarded upstream on a cache miss. After the full file is committed,
the provider serves the requested range from the local cached file. Multiple
range requests arriving during acquisition join the same full-file promise.

## Request policies

A provider may need to use endpoints governed by different usage limits. The
provider declares separate policies for independently limited request groups,
such as:

- gallery metadata;
- thumbnails;
- full media.

The provider supplies the appropriate policy directly to the broker when
network acquisition is required.

Policies are ordinary provider-owned objects with globally unique, stable
string IDs. The broker indexes process-lifetime queue state by that ID, so
provider recreation cannot reset a pacing boundary. Reusing an ID with a
different delay is a programming error.

The initial policies are:

| Policy ID | Delay after response handling |
| --- | ---: |
| `four-chan:api` | 1000 ms |
| `four-chan:media` | 1000 ms |
| `e-hentai:api` | 5000 ms |
| `e-hentai:pages` | 1000 ms |
| `e-hentai:images` | 2000 ms |
| `e-hentai:thumbnails` | 200 ms |

The delay begins only after the provider response handler completes. A media
handler includes the complete disk write and atomic cache commit.

## Independent policy queues

The broker owns a separate scheduler and queue state for every policy.

Each policy independently owns its waiting requests, pacing state, active
state, and timer. Work and pacing in one policy must not delay requests
governed by another policy.

An admitted request remains active until its response body has been fully
consumed. Receiving response headers does not complete the request or release
the policy's active-request capacity. A failed or aborted body also ends the
active request.

Every policy queue is strictly serial. It may have at most one active request,
and concurrency is not a configurable policy option.

A policy scheduler considers another queued request only after the active
request's body has been fully consumed, failed, or been aborted. Separate
policies remain independent and may each have their own active request.

Each policy declares a delay between sequential requests. After a request has
finished and its response body has been fully consumed, the policy waits for
its declared delay before starting the next request.

For example, a policy with a one-second delay behaves as:

1. complete request 1;
2. wait one second;
3. start and complete request 2;
4. wait one second;
5. start request 3.

The delay belongs only to that policy and does not pause other policy queues.
If the queue becomes empty, the policy still remembers when its most recent
request finished so a newly arriving request cannot bypass the remaining
delay.

### Per-policy worker loop

Each policy scheduler can be understood as one simple asynchronous worker
loop:

1. apply any priority promotions that arrived before selection;
2. select the oldest request from the highest non-empty priority lane;
3. perform the network request and await its provider-owned response handler,
   including full consumption of the response body;
4. release the response handler's completed result;
5. wait for the policy's configured delay;
6. repeat.

The first request can start immediately because there is no preceding request
to delay. Requests and promotions may accumulate while the worker is active or
waiting. The worker observes the current priority lanes when it reaches the
next selection.

Every policy owns its own worker loop. A request or delay in one loop does not
pause another policy's loop.

There is no global scheduling loop or lock that serializes otherwise
independent policies. The policy schedulers share the broker's network
transport, but run asynchronously from one another.

## Priority within a policy

The provider assigns a priority to each request and passes it to the broker.

Each policy scheduler has three FIFO priority lanes:

1. high;
2. normal;
3. low.

Whenever the policy is allowed to start another request, its scheduler selects
the oldest request from the highest non-empty priority lane.

A newly arrived higher-priority request does not cancel or preempt a request
that has already started. It becomes the next eligible request when the policy
can admit more work.

### Caller priorities

The currently selected media uses high priority. Thumbnail requests use normal
priority. Media prefetch and future background downloads use low priority.

These priorities affect ordering only among requests waiting in the same
policy queue. They do not create ordering between independent policies.

### Promotion of queued requests

A request owner may ask the broker to increase the priority of an existing
queued request. The broker exclusively owns the queue entry and its lane
membership; outside code never edits broker queue state directly.

A priority increase is applied synchronously by the broker before that policy
scheduler selects another request to start. Moving an entry between priority
lanes cannot be partially observed by the scheduler. If the scheduler admitted
the request before the priority increase arrived, the request is already
active and the increase is a no-op.

This state is owned by the Electron main process and does not require locks.
Queue mutations do not cross an asynchronous boundary.

Priority selection is strict. The scheduler does not use weighted fairness,
aging, or periodic lower-priority admission. Lower-priority requests may
continue waiting while higher-priority requests remain queued. This is
acceptable because requests within the policy are acquiring the same kind of
resource; priority describes which caller needs that resource first.

Each policy runs this selection process independently. Priority affects
ordering within one policy and does not create coordination between separate
policy queues.

## Terminal halt

There is no recoverable policy suspension or resumption behavior.

The broker has one terminal halted boolean. When any brokered request returns
HTTP 429 Too Many Requests, the entire request broker enters the halted state
for the rest of the app session.

Halting the broker:

- aborts every active provider request across every policy;
- rejects every queued provider request across every policy;
- rejects all future provider requests;
- prevents any policy from resuming independently;
- shows one native Electron error dialog explaining that Pixvitta was
  rate-limited and must quit;
- exposes only a `Quit Pixvitta` action and quits when the dialog closes.

Restarting the app creates a new broker session. There is no automatic retry,
cooldown, probing, or in-session recovery after a terminal halt.

The dialog closes the app; the user may return later by starting a new
process.

## Ordinary failures

Only HTTP 429 has broker-level failure meaning.

Every other HTTP response is returned to the provider without broker
interpretation. Transport failures are likewise returned as failures to the
provider. The broker does not classify, retry, transform, or escalate them.
The provider decides what the failure means and what to do next.

After returning an ordinary result or failure, the policy worker follows its
normal delay and continues processing its queue.

## Cancellation

Ordinary callers cannot cancel queued or active broker requests. An
acquisition continues even if its initiating caller no longer needs the
result, allowing the completed resource to enter the cache.

The broker does not define or manage request timeouts. A stalled request may
leave its policy worker occupied; that is outside the broker's responsibility.
The broker-wide terminal halt still aborts active requests so provider
networking stops immediately.
