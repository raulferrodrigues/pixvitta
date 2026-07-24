# Post-mortem: Making the Media Library Authoritative

**Date:** July 2026  
**Initial implementation:** `4cdc693`  
**Status:** Implemented  
**Related design:** [Media Provider Architecture](media-provider-architecture.md)

This is a post-mortem of the collection ownership refactor that followed the
media provider work. It documents more than what changed. It records the
reasoning, rejected designs, deliberate tradeoffs, and the architectural
standard this change establishes for Pixvitta.

This was not a production outage. It was a design failure discovered through
review: the app could represent one collection in the renderer while the main
process had already activated another collection's resources. The visible
symptom would be media requests returning 404, failed refreshes, or operations
being applied to a source other than the one on screen.

## Context

Pixvitta began as a local filesystem viewer. Adding the first remote provider
changed the problem substantially:

- loading a local folder and loading a remote thread have different latency;
- providers may perform asynchronous filesystem or network work;
- media URLs shown in React are opaque references resolved by the main process;
- changing a collection therefore changes both renderer state and main-process
  resource state;
- users can issue another source command while an earlier provider is still
  loading.

The provider abstraction itself was the right direction. Local folders and
4chan threads could both implement the same provider contract, and React did
not need provider-specific branches. The mistake was below that seam: ownership
of the active collection was still divided.

## The failure mode

The renderer tracked source request IDs so it could reject a result it believed
was stale. The main process separately loaded providers and activated the media
registry. Those mechanisms could make different decisions because they ran in
different processes and observed different parts of the operation.

A representative failure looked like this:

1. The user opens remote source A, which begins a slow provider load.
2. The user opens local source B, which finishes quickly.
3. Main activates B and the renderer displays B.
4. A later finishes.
5. The renderer recognizes A as stale and ignores its returned collection.
6. Main has nevertheless activated A's registry.
7. The renderer still displays B, but its opaque media URLs are now resolved
   against A.

The renderer's stale-result check protected only renderer state. It could not
undo or reliably observe a main-process activation.

Later guards reduced particular race windows, but the underlying smell
remained: both main and renderer were participating in the decision about which
collection was current. Every fix required their independent request IDs,
results, and timing rules to remain perfectly aligned.

That was not a deep module. It was a distributed protocol leaking through the
application.

## The design motivation

The motivating idea was:

> Whoever owns the authoritative truth for the collection should be the only
> component that decides when it changes, and should pass that truth down in one
> direction.

The goal was not to build a more sophisticated concurrency system. It was to
make most concurrency states impossible.

This led to several strong preferences:

- Collection ownership belongs in the main-process media library.
- The renderer is a projection of that ownership, not a peer authority.
- A new command does not cancel or supersede an existing load.
- We do not queue commands for later execution.
- We do not attach sequence numbers or collection revisions to the handoff.
- We do not ask the renderer to reconcile results.
- While a collection change is underway, other collection-changing commands
  are simply ignored.
- If the tiny main-to-renderer commit protocol breaks, we fail loudly instead
  of inventing recovery behavior we do not trust.

This is intentionally less flexible than a general concurrent task system. That
restriction is its main advantage.

## Designs we rejected

### Renderer request IDs

Request IDs answer “is this still the renderer's newest request?” They do not
answer “which registry did main activate?” Keeping them would preserve two
definitions of current state.

They were removed from collection opening and refreshing.

### Main and renderer revisions

We considered giving every committed collection a revision and requiring the
renderer to acknowledge that revision.

That would be necessary if multiple commits could be in flight. In the chosen
system, they cannot be. Main refuses another collection-changing command until
the current handoff is finished. A renderer acknowledgment can therefore refer
only to the one transition main is awaiting.

Passing a revision would describe complexity the protocol deliberately forbids.
Collection IDs remain part of the media domain, but they are not IPC sequencing
tokens.

### Cancellation and supersession

A newer user command could have canceled or superseded an older provider load.
That creates additional provider requirements:

- every provider must propagate cancellation correctly;
- partially completed provider work must be cleaned up;
- main must define which stages are cancelable;
- commit and cancellation must be ordered;
- the UI must explain whether the newer command replaced the older one.

None of that was necessary for the current product. Provider loading is allowed
to take time, and the UI can show a spinner.

### A command queue

A queue initially sounds friendly because user input is not lost. It also
creates questions with no obvious product answer:

- Should repeated refreshes be coalesced?
- Should an open command replace queued refreshes?
- Should a failed operation allow the next queued command to run?
- What should happen if the queued location is no longer relevant?
- How does the UI represent commands that have not started?

The queue would become a second state machine attached to the first. We chose
no queue. Commands received outside the idle state are ignored.

### Retry, resend, and recovery

We considered resending a committed collection if the renderer did not confirm
it. That is dangerous without an idempotent, more elaborate protocol. A resend
could produce duplicate acknowledgments, repeat renderer side effects, or hide
a genuinely broken renderer.

For now, failure to complete the handoff is treated as an invariant violation.
The app exits instead of guessing.

## The final model

The main-process `MediaLibrary` is the sole owner of:

- the active provider;
- its canonical location and origin;
- the active public collection;
- the active media registry;
- the previous registry during a renderer handoff;
- the collection transition phase.

It has three phases:

| Phase | Meaning | Collection-changing commands |
| --- | --- | --- |
| `idle` | Main and renderer are stable. | One command may begin. |
| `loading` | A provider is building a candidate. | Ignored. |
| `awaiting-renderer` | The candidate is committed and has been published. | Ignored. |

The renderer keeps a copy of the latest collection for presentation. That copy
is not authoritative. It does not decide whether an incoming collection is
newer, stale, or applicable. It applies every collection event it receives.

### End-to-end flow

```text
User command
    |
    v
Main: IDLE -> LOADING
    |
    | provider builds a candidate (may take a long time)
    |
    +-- failure --> keep active catalog -> publish error -> IDLE
    |
    v
Main commits candidate atomically
Main: LOADING -> AWAITING_RENDERER
    |
    | publish authoritative collection
    v
Renderer applies collection and completes the React commit
    |
    | generic "renderer stable" acknowledgment
    v
Main releases previous catalog
Main: AWAITING_RENDERER -> IDLE
```

Opening and refreshing from the renderer are fire-and-forget commands. They do
not return collections and the renderer does not interpret operation results.
Main separately publishes loading state, source errors, and authoritative
collection changes.

## Why loading and commit are separate

Provider work and renderer propagation have very different timing
expectations.

Provider loading may involve network access, filesystem traversal, metadata
work, or API rate limits. It can take a noticeable amount of time. During this
phase the active collection and registry remain untouched. The renderer shows a
loading indicator, and controls capable of changing the collection are
disabled. Main still enforces the rule even if a command arrives from a native
menu or another path.

The committed handoff should be effectively instantaneous. Main already has the
complete collection; the renderer only needs to update its store and commit the
corresponding React projection.

The one-second acknowledgment timeout applies to that delivery, not to provider
loading.

## Why the acknowledgment is generic

The renderer sends only `library:renderer-stable`.

It does not send a source ID, revision, or result. While main is waiting:

- exactly one collection has been committed;
- no other collection change can start;
- exactly one renderer is allowed to acknowledge it.

There is nothing useful to correlate. The absence of an identifier is not an
omission; it is proof that the state machine has removed ambiguity.

React applies the collection inside `flushSync` before acknowledging. The
acknowledgment means the renderer store and subscribed React tree have committed
the new projection. It does not mean that every image or video has finished
loading from disk or the network.

## Atomic resource lifetime

Committing a collection changes more than a list of media. It changes the
registry that resolves opaque `pixvitta-media://` URLs.

Main creates a complete `MediaCatalog` before commit. That catalog contains the
public collection and its private registry as one unit. At commit:

1. the new catalog becomes active synchronously;
2. the former active catalog is retained as the previous catalog;
3. resource lookups check the active catalog and then the previous catalog;
4. the collection is published to the renderer;
5. after the stable acknowledgment, the previous catalog is released.

This prevents media already present in the old React tree from becoming
unresolvable during the handoff. Provider failure before commit never mutates
either catalog.

## Why crashing is acceptable here

Missing, duplicate, early, or otherwise unexpected acknowledgments are fatal.
The main process exits with status 1.

That policy is intentionally severe. The acknowledgment covers only a local
IPC delivery and synchronous renderer state commit. If it cannot finish in one
second, one of the assumptions that makes the protocol safe is false:

- the renderer may have crashed or hung;
- the event may have been delivered incorrectly;
- the renderer may have thrown while applying authoritative state;
- the protocol may have emitted more than one acknowledgment.

Continuing would leave uncertainty about which resources are safe to release
and whether the UI represents the active collection. Quietly recovering would
make the invariant optional.

This is not necessarily the final user experience. A future crash-recovery
design could restart the renderer or restore the last source. That should be a
separate, explicit design with its own invariants—not a resend added casually
to this protocol.

## User experience tradeoffs

The design chooses correctness and simplicity over accepting every input:

- source-changing controls are disabled while loading or committing;
- commands that still reach main during that period are ignored;
- there is no “next source” queue;
- the user may perceive an attempted native command as briefly unresponsive;
- a provider can take a long time, but the current collection remains usable
  until commit and the UI communicates that work is happening.

These tradeoffs are acceptable for the current experiment. If real usage shows
that users frequently need to interrupt slow providers, cancellation should be
designed as a provider capability and state-machine transition—not layered on
as renderer-side request freshness.

## Verification

The tests focus on the invariant rather than every UI detail:

- opening and refreshing use the same authoritative commit path;
- commands are ignored throughout loading and renderer handoff;
- provider failure preserves the active collection and registry;
- both old and new resources resolve during the handoff;
- old resources stop resolving after acknowledgment;
- acknowledgments start a one-second deadline;
- missing and unexpected acknowledgments are fatal.

This is the kind of behavior worth testing in Pixvitta: it has a defined shape,
crosses process boundaries, and is likely to be accidentally weakened during
future performance or provider work.

## What went well

- Review identified an ownership problem rather than stopping at one observed
  race.
- The provider abstraction gave us a natural deep-module boundary.
- Removing features—revisions, cancellation, queues, returned collections—made
  the protocol easier to reason about.
- Moving `MediaCatalog` and `MediaRegistry` under the library made ownership
  visible in the filesystem as well as in prose.
- The UI now reflects the architectural state instead of creating an
  independent optimistic state machine.
- Focused tests describe the lifecycle of a committed collection and its
  resources.

## What could be improved

- We initially responded to concurrency with stale-request guards. Those guards
  addressed schedules rather than ownership.
- Returning collections through command responses encouraged the renderer to
  participate in activation decisions.
- The resource registry originally lived in the media feature, visually
  obscuring which module owned it.
- The correct invariant emerged through several review rounds. Writing the
  ownership rule before implementing asynchronous source switching would have
  prevented rework.
- The current fatal path is correct for the invariant but not polished as a
  user-facing recovery experience.

## Project principles established by this change

This refactor is an example of the desired design direction for Pixvitta.

### Put authority in one place

If two components must agree on which state is current, first ask whether one
of them can stop deciding. Duplicate freshness checks are not stronger
ownership.

### Prefer impossible states over reconciliation

Serializing one transition and ignoring conflicting commands removed the need
to identify, cancel, reorder, or reconcile competing results.

### Make deep modules own the hard parts

Providers expose a small contract. The media library absorbs provider
selection, loading, activation, registry lifetime, errors, and renderer
propagation. Callers should not reconstruct those rules.

### Keep communication directional

Commands flow into the owner. Authoritative state flows out. The renderer sends
only the minimum signal required to complete resource cleanup.

### Do not add protocol metadata without ambiguity

Revision IDs are useful when multiple operations may coexist. They are noise
when the state machine guarantees exactly one possible referent.

### Fail explicitly when an invariant is broken

A clear crash is preferable to continuing with a renderer and resource owner
that may disagree. Recovery can be designed later without weakening the
contract today.

### Let the UI reveal real system state

The spinner and disabled controls are not cosmetic. They show the phase owned
by main and prevent the interface from promising concurrency the architecture
does not support.

### Test contracts that future work could weaken

Tests belong around ownership, handoff, lifetime, and failure behavior. They
should make architectural regressions obvious without coupling every small UI
choice to a test.

## Follow-up questions

These are intentionally left outside the current design:

- Should slow providers eventually support explicit cancellation?
- Should renderer failure trigger a controlled window reload instead of a full
  app exit?
- Should startup restore the last stable collection after a fatal renderer
  failure?
- Should source-changing native menu items reflect the loading state rather
  than relying on main to ignore them?
- If Pixvitta ever has multiple viewer windows, should each window own an
  independent library session or should one application-level collection still
  be authoritative?

Each question changes a current invariant. None should be answered by quietly
adding a queue, revision, retry, or second owner.

## Summary

The immediate bug was a possible mismatch between the collection shown by
React and the registry active in Electron's main process.

The lasting fix was an ownership decision:

> The main-process media library owns the collection completely. It accepts one
> transition at a time, commits atomically, publishes state in one direction,
> and waits for one generic renderer-stable acknowledgment before releasing the
> previous resources.

That decision made the system stricter, smaller, and easier to reason about. It
is the model Pixvitta should follow when future features cross providers,
processes, or asynchronous boundaries.
