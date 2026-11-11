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
- **Collection**: a loaded snapshot of media items from a source.
- **Resource**: internal behavior capable of returning media or thumbnail bytes.
  The renderer receives only opaque Pixvitta URLs for resources.

“Folder” remains user-facing language for local directories, but it is not the
general application model.

## External interface

The main-process media library is the deep module. Renderer and app callers use
only these source operations:

- open a directory through the native picker;
- open a typed location;
- open an operating-system path;
- refresh an already-open collection;
- open a collection’s origin in the system browser.

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
dynamic provider installation are out of scope.

## Accounts

A provider that signs in declares a `ProviderAccount` (`provider.ts`): an id, a
label, and `isSignedIn`, `signIn`, and `signOut`. The library session lists
every declared account over the `accounts:*` IPC channels and pushes the list
on each change, and Settings shows one row per account. The renderer only ever
names an account by id.

- `isSignedIn` reads what is stored on this machine and never sends a request.
  A sign-in the site has stopped accepting shows up as an
  `authentication-required` error the next time the provider uses it.
- `authentication-required` errors carry the account id, so the error's Sign in
  button runs that account's sign-in and then reopens the source.
- Signing out forgets the account locally. ExHentai clears its session
  partition and invalidates its gallery access, so an open gallery keeps the
  pages it already loaded and fails on the next request.

## Renderer contract

The renderer receives a provider-neutral collection:

- opaque collection ID;
- title and optional origin label;
- capabilities such as refresh, sort, and opening the origin;
- opaque media IDs and `pixvitta-media://` resource URLs.

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
- Recents store any source whose provider asks to be remembered; see
  [Recent sources](recent-sources.md).
- A 4chan board catalog is not implemented yet. A future browsing result may
  add child sources without changing how media collections are viewed.

## Verification

Focused tests use injected dependencies and synthetic responses; none make
live requests:

- collection lifetime: selection by provider key and deactivation only when a
  replacement commits;
- request broker scheduling, cancellation, pacing, and the 429 halt;
- provider runtime ownership, sharing, prefetch order, and refresh lifetime;
- E-Hentai and ExHentai parsing, authentication generations, session behavior,
  and image limits;
- nhentai URL, gallery, and CDN configuration validation;
- resource cache eviction order.

`pnpm validate` runs the tests, type checking, and a production build.
