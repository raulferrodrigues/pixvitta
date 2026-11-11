# Merged Sources: Decisions

The experiment that became mixes. The shipped design is described in
[Media Provider Architecture](media-provider-architecture.md) and the
[provider runtime](../src/main/providerRuntime/README.md); the plan and what is
still to come are in [Mixes: Feature Plan](mixes-feature-plan.md). This file
keeps the decisions worth remembering and why they were made.

## The merge lives in the media library, not in a provider

`MediaLibrary` keeps the member sources and a pure function zips them into one
provider collection, which goes through the existing catalog, registry, and
handoff. A composite provider was rejected: adding a source would reload every
member, costing remote requests for sources already loaded. The library stays
the sole authority: one collection, one catalog, one handoff state machine
([post-mortem](authoritative-media-library-postmortem.md)).

## Zipper order, stable keys

Items are taken one per member in turn, in the order members were added; a
member that runs out drops out of the rotation. Each member keeps its own
provider order. Keys are namespaced by the member's canonical location even for
a single source, so items keep their public media IDs when a source is added or
removed. One member comes out exactly as its provider gave it.

## Adding and removing

- Adding loads only the new source and keeps the collection ID and the
  selection. A source that is already a member is main's call, reported as
  "already added" rather than as an error; the renderer never guesses
  membership. Each added source is remembered in recents on its own.
- Removing reloads nothing and deactivates only the removed member. A
  selection that belonged to it moves to the next remaining item in the old
  order, else the previous one. A lone source cannot be removed.
- The `source:add` reply is not ordered against main's loading and collection
  messages in Electron, so the "already added" notice is not tied to them.

## Viewing demand belongs to members

A commit deactivates only the members the new collection no longer holds. The
first version released every non-owning member's selection on each step, which
discarded prefetch on every step through a zipper; members now keep their
selection and stand by at prefetch priority, and a new member starts with a
window at the item the zipper reaches first.

## Where the sources are managed

A popover on the add button was tried first and rejected: managing sources is
core to the feature, not a menu. A modal was rejected too. The sources panel is
a column on the left of both layouts, so the media stays visible while sources
change, and it can be open with the downloads panel on the right. It holds an
add field (URL or path, with a folder button), the members in order, and the
recent sources not already in the mix. Its look was tuned with the owner over
several passes; option "C", a strip of preview thumbnails per source, was left
for later.

## Capabilities of a mix

Refresh and sort if any member can; download only if every member can (no
per-item capabilities yet); no origin. The title is "a + b" for two sources,
"a + N more" beyond. Each item carries its source's title, shown beside its
name.

## Known limitations accepted

- Downloading a whole mix uses the mix title as the folder name.
- Folders keep one random-order seed each, so refreshing a mix of folders in
  random order keeps each folder's order.
