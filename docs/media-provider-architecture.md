# Media Provider Architecture

This document tracks the refactor from a filesystem viewer with a special
4chan path into a provider-based media library.

## Goal

Pixvitta treats every media location as a source loaded by a provider. Local
directories, 4chan threads, and E-Hentai, ExHentai, and nhentai galleries are
the current providers. Adding another URL-based provider should normally require
one provider implementation and one registry entry, without adding provider
checks throughout IPC or React.

## Domain language

- **Provider**: loads a supported location and hides its filesystem or network
  behavior.
- **Source**: the canonical place a provider loads, such as a directory or a
  thread URL.
- **Collection**: a loaded snapshot of media items from one or more sources.
- **Mix**: a collection made of several sources, its *members*, interleaved
  in zipper order.
- **Resource**: internal behavior capable of returning media or thumbnail bytes.
  The renderer receives only opaque Pixvitta URLs for resources.

“Folder” remains user-facing language for local directories, but it is not the
general application model.

## External interface

The main-process media library is the deep module. Renderer and app callers use
only these source operations:

- open a directory through the native picker;
- open a typed location;
- open a saved mix from recents;
- open an operating-system path;
- add a source to the open collection, by picker or location;
- remove one member source from a mix;
- refresh an already-open collection;
- open a collection’s origin in the system browser.

Opening replaces the collection. An open from inside the app that would
replace a mix of two or more sources is not carried out: main answers with a
question (`library:confirm-replace`) carrying the request, and opens only
when the renderer sends that request back marked as confirmed. Main decides
when to ask, and says whether the mix is saved, so the question can say it
stays in recents; the renderer only shows the question. Opens from the
operating system replace without asking; the mix is saved either way.

Provider matching, canonical locations, rate limits, remote request headers,
resource delivery, local path authorization, recents policy, and error mapping
remain behind this interface.

The library is also the sole authority for the active collection and its media
registry. The renderer holds only the latest projection it was given; it never
decides which asynchronous load wins or activates resources itself.

Download-capable providers expose that behavior as a source capability. The
renderer passes only the opaque media ID back to the media library; the provider
resource is streamed into the operating system’s Downloads directory with a
safe, collision-free filename.

## Provider seam

Providers are compile-time adapters registered under
`src/main/library/providers/`. Each provider:

1. decides whether it accepts an input location;
2. loads that location into a provider collection;
3. returns internal resources for media and thumbnails;
4. declares presentation data and behavioral capabilities.

The providers are:

- `localFolder/`: directory scanning, sorting, thumbnails, and local file
  resources;
- `fourChan/`: thread URL parsing, API policy, attachment mapping, and CDN
  resources;
- `eHentai/`: gallery URL parsing, metadata, index and image-page parsing,
  sprite thumbnails, and image viewing limits;
- `exHentai/`: the E-Hentai gallery engine with an authenticated session and
  forum sign-in;
- `nhentai/`: gallery URL parsing, the documented v2 API, CDN server
  configuration, and path validation. See [nhentai provider](nhentai-provider.md).

This is intentionally not a runtime plugin system. Provider-owned React UI and
dynamic provider installation are out of scope. ExHentai sign-in is currently
wired specifically through IPC and the renderer; making authentication
provider-neutral is recorded in [Future Work](future-work.md).

## Several sources in one collection

The library keeps the list of member sources behind the active collection,
each with its provider and loaded provider collection. A pure function
(`mergedSources.ts`) zips them into one provider collection, one item from
each member in turn, in the order they were added, which then goes through
the usual catalog, registry, and handoff. There is still one collection, one
catalog, and one handoff state machine.

- Item keys are namespaced by the member's canonical location, so items keep
  their public media IDs when a source is added or removed.
- Adding loads only the new source and keeps the collection ID and the
  selection. A source that is already a member is reported, not reloaded.
  Removing reloads nothing.
- A mix refreshes and sorts if any member can, downloads only if every member
  can, and has no origin. One member is presented exactly as its provider
  gave it.
- Viewing demand belongs to members, not to a catalog. A commit deactivates
  only the members the new collection no longer holds: an add carries every
  loaded member over, a refresh deactivates the members it reloaded, and a
  removal deactivates only the removed one. The member that owns the selected
  item takes it on screen; the others stand by with their place and prefetch
  window (see the [provider runtime](../src/main/providerRuntime/README.md)).

### A failed source does not break the mix

Each member loads on its own. A member that fails keeps what it had and is
marked with its error, which is published with the collection
(`MediaSourceMember.error`) and shown on its row in the sources panel; the
next refresh retries it. The result commits if at least one member that did
not fail has items; otherwise the operation fails as a whole, the active
collection is untouched, and the error is published as usual. A single
source therefore fails exactly as it did before mixes. Reopening a saved mix
uses the same rule: every member loads through its provider, and one that
fails is present with no items, marked with its error, and stays in the saved
mix until the user removes it. A saved source no installed provider takes any
more is a failed member too.

### Saved mixes

The session is the save. The library gives a collection a saved-mix ID when
its second source is added, or the saved mix's own ID when it is reopened, and
keeps it for as long as the collection lives: adds and removes keep the
collection, so they keep the session, and only another open ends it. After
each add or remove, once the renderer acknowledges the collection, the library
writes the saved mix as it now is: its members in order, leaving out any whose
provider does not ask to be remembered. A refresh writes nothing. Recents
decide what that means for the list (see [Recent sources](recent-sources.md)):
fewer than two members take the mix out of the list, and the next write in
the same session brings it back with its name and pin.

## Renderer contract

The renderer receives a provider-neutral collection:

- opaque collection ID;
- title and optional origin label;
- capabilities such as refresh, sort, and opening the origin;
- its members in zipper order: an opaque ID, title, kind, item count, site
  name, the recent location it is remembered under, and the error of a failed
  load, but no provider IDs;
- the ID of the saved mix the collection's session writes, so the sources
  panel can leave that mix out of its recents;
- opaque media IDs and `pixvitta-media://` resource URLs, each item carrying
  its source's title in a mix.

React must not branch on provider IDs. It renders presentation fields and
capabilities.

## Authoritative collection handoff

Collection changes use one main-owned state machine:

1. `idle`: the library may accept one open or refresh command.
2. `loading`: the selected provider builds a candidate collection. This may
   take as long as the provider needs, and the renderer displays loading state.
3. `awaiting-renderer`: main atomically activates the candidate and publishes
   the provider-neutral collection. Other collection-changing commands are
   ignored.

The renderer applies every published collection unconditionally, completes the
React commit, and sends one generic `library:renderer-stable` acknowledgement.
There are no cross-process revisions, result races, cancellation rules, or
command queues: only one collection transition can exist, so the
acknowledgement necessarily belongs to it.

After delivery, main allows one second for the acknowledgement. A missing,
duplicate, or otherwise unexpected acknowledgement is treated as a fatal
protocol failure and exits the app. This is deliberately strict while the
handoff is expected to complete effectively instantly.

Provider failures occur before commit and leave the active collection and
registry untouched. During the committed handoff, main retains the previous
catalog alongside the new one so media already rendered on screen remains
resolvable. The previous catalog is discarded only after the renderer reports
that it is stable.

## Resource delivery

Both local and remote content are served through Pixvitta’s custom protocols.
The resource registry maps opaque IDs to internal response functions:

- local resources support MIME types and byte ranges from disk;
- remote resources proxy approved provider URLs and provider-specific headers;
- resources from the previous collection remain available through the atomic
  renderer handoff and stop resolving after its acknowledgement.

This removes raw CDN URLs and 4chan referrer behavior from the renderer and
window layer.

Remote providers acquire media and thumbnails through the shared
[provider runtime](../src/main/providerRuntime/README.md). It owns selection,
prefetch, sharing of in-flight work, and cancellation. Every remote request
goes through the process-wide request broker, which paces each provider policy
and halts all provider requests on HTTP 429. Fetched files are stored in a
session resource cache that is cleared on launch and evicts least recently
used entries above 2 GB.

## Deliberate limits

- The existing folder picker layout remains; its URL field becomes
  provider-neutral.
- Recents store any source whose provider asks to be remembered, and saved
  mixes of such sources; see [Recent sources](recent-sources.md).
- A 4chan board catalog is not implemented yet. A future browsing result may
  add child sources without changing how media collections are viewed.

## Verification

Focused tests use injected dependencies and synthetic responses; none make
live requests:

- collection lifetime: selection by provider key and deactivation only when a
  replacement commits, including which members of a mix a commit releases;
- mixes: zipper order, key stability, capabilities, adding, removing, the
  selection rules, and the failed-member rule;
- saved mixes: one saved mix per session rewritten on each change after the
  acknowledgement, reopening and resuming a session, and a failed member
  kept; the recents store's shape, migration, ordering, cap, and pins;
- request broker scheduling, cancellation, pacing, and the 429 halt;
- provider runtime ownership, sharing, prefetch order, refresh lifetime,
  standing by, and the cold start of a new source;
- E-Hentai and ExHentai parsing, authentication generations, session behavior,
  and image limits;
- nhentai URL, gallery, and CDN configuration validation;
- resource cache eviction order.

`pnpm validate` runs the tests, type checking, and a production build.
