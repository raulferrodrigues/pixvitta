# Provider runtime contract

E-Hentai is the first adapter using this runtime. ExHentai and 4chan retain
their existing resource pipelines and five-forward, five-back prefetch loops.
Source loading and metadata requests retain the existing provider contract.

## Implementing an adapter

Create one `ResourceAcquisitions` instance for a provider, then a
`ProviderCollectionRuntime` for each loaded collection. Supply a
`CollectionAdapter` describing item count, media and thumbnail identities,
resource loaders, and any access-validity check.

Loaders receive `ProviderIO`. They describe site-specific requests, policies,
parsing, URL validation, and response validation. They do not choose request
priority, manage broker tasks, or start their own prefetch loops.

- `io.request` consumes a response inside the broker's response handler.
- `io.use` shares a dependency such as a gallery index or thumbnail sprite.
- `io.cachedFile` checks the session cache before running an acquisition.
- `io.requestFile` validates and streams a response into the cache before the
  broker releases its request slot.

Resource keys identify identical work within a provider. Include the source
and, for authenticated sources, the account and authentication generation.
Disk-cache keys can remain stable across authentication generations for the
same account, provided the adapter validates access before serving them.

## Selection and lifetime

The library establishes the initial selection on each collection commit and
passes subsequent renderer selections to `viewing.select`. Refresh must
establish selection again even when public media IDs remain unchanged.
The E-Hentai adapter converts provider item keys to runtime item indices.

Protocol requests can arrive before their selection event. High-priority
media requests wait for explicit selection, then recheck it before acquiring
work. A stale request cannot navigate the collection. Its abort signal or
collection deactivation ends the wait.

The library calls `viewing.deactivate` when a replacement collection commits.
This releases selected-media and prefetch ownership. Downloads have separate
leases and can continue using retained resources. A failed replacement leaves
the existing collection active.

## Prefetch order

After the selected resource completes, fetch sequentially:

1. Up to five following items at normal priority.
2. Up to five preceding items at normal priority.
3. Following items six through twenty at low priority.

Clamp to collection boundaries without wrapping. Cache hits reuse existing
files. Stop the sequence on failure. Navigation replaces the desired window,
preserves overlapping acquisitions, and updates their priority according to
the remaining consumers. There is no extra idle timer or broker policy.

## Cancellation guarantees

Each acquisition tracks its consumers and shared dependencies. Releasing one
consumer never cancels work still needed by another consumer or download.
The new selected consumer is established before old viewing demand is released.

With no remaining consumers, remove queued requests immediately. Let an active
request finish unless high-priority work is waiting in its policy queue. The
broker checks this both when foreground work arrives and when ownership changes.
An orphan may finish its current stage, but cannot submit another stage.

Cancellation settles consumer promises without retries. The broker retains its
active slot until transport and response handling unwind, then applies the
normal policy delay even if the request was aborted. Completed cache files may
be reused; partial transfers never become completed cache entries.

The focused tests cover ownership, dependency sharing, priority changes,
navigation ordering, refresh lifetime, pacing after abort, and E-Hentai stream
and quota behavior using synthetic responses. They make no live requests.
