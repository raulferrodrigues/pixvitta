# Media Providers MVP 2.0

This document tracks the refactor from a filesystem viewer with a special
4chan path into a provider-based media library.

## Goal

Pixvitta treats every media location as a source loaded by a provider. A local
directory and a 4chan thread are the first two providers. Adding another
URL-based provider should normally require one provider implementation and one
registry entry, without adding provider checks throughout IPC or React.

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

## Provider seam

Providers are compile-time adapters registered under
`src/main/library/providers/`. Each provider:

1. decides whether it accepts an input location;
2. loads that location into a provider collection;
3. returns internal resources for media and thumbnails;
4. declares presentation data and behavioral capabilities.

The initial providers are:

- `localFolder.ts`: directory scanning, sorting, thumbnails, and local file
  resources;
- `fourChan.ts`: thread URL parsing, API policy, attachment mapping, and CDN
  resources.

This is intentionally not a runtime plugin system. Authentication flows,
provider-owned React UI, and dynamic provider installation are out of scope.

## Renderer contract

The renderer receives a provider-neutral collection:

- opaque collection ID;
- title and optional origin label;
- capabilities such as refresh, sort, and opening the origin;
- opaque media IDs and `pixvitta-media://` resource URLs.

React must not branch on provider IDs. It renders presentation fields and
capabilities.

## Resource delivery

Both local and remote content are served through Pixvitta’s custom protocols.
The resource registry maps opaque IDs to internal response functions:

- local resources support MIME types and byte ranges from disk;
- remote resources proxy approved provider URLs and provider-specific headers;
- stale resources stop resolving when a new collection becomes active.

This removes raw CDN URLs and 4chan referrer behavior from the renderer and
window layer.

## Deliberate limits

- The existing folder picker layout remains; its URL field becomes
  provider-neutral.
- Only local sources remain in recents for this iteration.
- A 4chan board catalog is not implemented yet. A future browsing result may
  add child sources without changing how media collections are viewed.
- Downloading remote media is deferred.

## Verification

- Provider matching and loading are tested through the media-library interface
  with injected provider/network dependencies.
- Remote resource delivery verifies referrer and byte-range forwarding.
- Existing validation must pass.
- A focused Electron smoke test opens a local directory.
- A focused Electron smoke test opens the known live 4chan thread and confirms
  that full media, not only thumbnails, reaches a playable/loadable state.

