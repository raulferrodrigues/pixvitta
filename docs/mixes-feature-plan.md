# Mixes: Feature Plan

## Status

PR 1 (text-field keys), PR 2 (mixing), and PR 3 (saved mixes) are built; each
is stacked on the one before. The shipped behaviour of saved mixes is in
[Recent sources](recent-sources.md). The experiment log is reduced to its
decisions in [merged-sources-plan.md](merged-sources-plan.md), and the shipped
design is in [Media Provider Architecture](media-provider-architecture.md) and
the [provider runtime](../src/main/providerRuntime/README.md).

## What ships

A **mix** is one collection made of several sources, interleaved in zipper
order. The user builds it in the sources panel, and it is saved automatically
so it can be reopened later.

Decided with the user:

- Zipper is the only order in this feature. Other orders get their own PRs;
  nothing here should make them harder.
- Replacing a mix needs confirmation.
- Mixes are saved. The session is the save (see below).
- Saved mixes appear in the same list as recent sources, not a separate one.
- A mix can be pinned, and a pinned mix can be renamed. Unpinned mixes age
  out like recents.
- Reopening a mix with a dead source opens the rest and says which failed.
- No pt-BR translation work.
- Review happens after the PR is built, with Fable 5.2 at medium effort.

## Pull requests

1. **Text-field keys.** Arrows, J, K and L type in text fields. Independent
   bug fix, already built in the experiment; lift it out on its own branch
   from dev.
2. **Mixing.** The merge, the sources panel, the fixes under "Must fix", the
   replace confirmation, and the doc rewrite.
3. **Saved mixes.** The session save, mixes in recents, pin and rename,
   reopening. Stacked on 2, because it changes the recents store.

Each goes into dev through the Validate workflow. Never touch the version.

## Must fix (PR 2)

### A failed source must not break the mix

Today a refresh fails as a whole if any member fails, so one dead thread
makes a mix unrefreshable. New rule, shared by refresh and by reopening a
saved mix:

- Each member loads on its own. A member that fails keeps what it had (on
  refresh) or is present with no items (on reopen), and is marked failed with
  its error.
- The collection commits if at least one member that did not fail has items.
  If none does, the operation fails as it does today. (A failed member keeps
  its old items on refresh, but they do not count, or a refresh in which
  every source failed would still commit.)
- The panel shows a failed member in place, with its error and its remove
  button. A later refresh retries it.
- A single-source collection keeps today's behaviour: a failed refresh
  leaves it untouched and shows the error. This follows from the rule above.

This needs a per-member status published with the collection.

Built: `MediaLibrary.loadMembers` applies the rule to a list of member loads,
each with the member to keep if it fails, so reopening can pass empty members.
`MediaSourceMember.error` carries the status; the panel shows the error in
full on the member's row, and the sources button's count turns red while a
member has failed, so a failure is visible with the panel closed.

### Priority of a source the user moved away from

Each source keeps its last selection so its prefetch survives a step into
another source. Its selected item therefore stays at high priority, and can
delay the item now on screen when both use the same request policy. The
provider runtime needs a way to keep a source's place and prefetch window
while lowering it below the source that owns the selected item. No request
may bypass the broker and no request policy changes.

Built: `standBy` on the runtime and on each provider's viewing handle. A
source standing by keeps its place and window, with its selected item at
normal priority instead of high, so the item on screen is the only
high-priority demand.

Found while building it: the broker serves a policy's normal lane newest
first, so two prefetch windows in one policy do not alternate; the one that
submitted last can run several items ahead. The item on screen is not
affected. Fairness between windows would be a broker change, left for later.

### A new source starts cold

A source that was just added or reloaded has no prefetch until the user
first lands on one of its items. Give it a window at the item the zipper will
reach first, at prefetch priority.

Built: a source with no selection stands by at the item the zipper reaches
first from the current selection.

### Replace confirmation

Opening a source when the collection has two or more sources asks first.
The message says what will be replaced and, once PR 3 lands, that the mix
stays in recents. It covers every way to open from inside the app: folder,
web, a recent, and the menu. Opens that come from the operating system (a
file passed to a second launch) replace without asking; with PR 3 the mix is
saved anyway.

Built: main decides. An in-app open that would replace two or more sources
comes back as a question with the request; the renderer asks ("Replace the
mix?", Enter replaces, Escape keeps it) and sends the request back confirmed.
Today a recent can only be opened from the first-run screen, where nothing is
open, so that entry point first matters with PR 3's mix rows; it goes through
the same check.

### Checks only the user can do

Real providers, macOS, ExHentai sign-in during an add, and downloading a
merged collection have not been exercised. These need a manual pass before
merge. Tests and agents never contact a real provider.

## Saved mixes (PR 3)

### The session is the save

- A session starts when a second source is added. That creates one saved
  mix with its own ID.
- Every add, remove, and (later) reorder in that session rewrites that same
  saved mix. Only its latest state exists.
- A session ends when the mix is replaced or the app quits. The saved mix
  stays as it was.
- Reopening a saved mix resumes its session: changes update the same saved
  mix.
- Building the same sources by hand in a new session creates a new saved
  mix. No matching on the set of sources.
- Going down to one source removes the saved mix from the list. Adding a
  source again in the same session brings the same one back, keeping its
  name and pin.
- The save is written on each change, after the renderer acknowledges the
  collection, the same point recents are written today.

### In the recents list

- One list holds sources and mixes, newest first. A mix shows its name or its
  automatic title ("a + b", "a + 2 more"), its number of sources, and a
  distinct icon.
- Pinned mixes sort first and do not count toward the cap of ten. Only mixes
  can be pinned. Only pinned mixes can be renamed; unpinning keeps the name.
- On the first-run screen, clicking a mix opens it.
- In the sources panel, a source row adds to the current collection, as now.
  A mix row opens that mix, replacing the current collection, with the
  replace confirmation when it applies. The two actions must look different.
- The mix being viewed is not listed under Recent in the panel.
- Removing a mix from the list deletes the saved mix. Its sources stay in
  recents as their own entries.
- Each source added to a mix is still remembered on its own, as today.
- A source whose provider does not ask to be remembered is left out of the
  saved mix. A mix with fewer than two rememberable sources is not saved.

### Stored shape

`recent-sources.json` entries become a union: a source (today's shape) or a
mix (`id`, optional `name`, `pinned`, the member sources in order, and
`openedMs`). Old files are read as sources. Sources deduplicate by location,
mixes by ID.

### Reopening

Main loads every member through the usual providers and the request broker,
then commits one collection, under the failed-source rule above. A failed
member stays in the saved mix until the user removes it.

### Built (PR 3)

- The library keeps the session as a saved-mix ID on the active collection
  and, after each acknowledged add or remove, writes the mix's remembered
  members; the recents store applies the list rules. A mix that goes down to
  one source is held in memory with its name and pin until the session saves
  it again; after a restart it is gone.
- Entries are a union on `kind`: a mix has `kind: "mix"`, which sources never
  had, so old files read as sources.
- Pin, rename, and remove are in a native menu on mix rows (right-click, the
  menu key, Shift+F10), with F2 to rename; the first-run screen also shows a
  pin button. The panel's mix rows end in "Open" where source rows end in "+".
- Unpinning puts the mix at the front of the unpinned entries, so it does not
  drop off a full list at once.
- Reopening a mix moves the mix to the front, not its sources.
- The mix being viewed is not listed under Recent, so its pin sits at the end
  of the "In the mix" heading while it is saved, and once pinned its name
  shows there and renames in place.
- A member that failed because it needs sign-in (ExHentai) offers it on its
  row; signing in refreshes the collection, which retries the member.

## Docs (PR 2 and 3)

- `media-provider-architecture.md`: the collection can have several member
  sources; viewing demand belongs to members; the failed-member rule.
- `recent-sources.md`: mixes, pinning, the stored shape.
- `providerRuntime/README.md`: the priority rule.
- README: the feature and the shortcut.
- Reduce `merged-sources-plan.md` to a short record of the decisions.

## Later, not in these PRs

Other orders (one after another, shuffle), drag to reorder, recursive
folders, preview thumbnails per source, per-item downloads in mixed
collections, a source marker in the filmstrip.

## Open

- The panel shortcut (`Ctrl/Cmd + B`) and the wording "In the mix".
