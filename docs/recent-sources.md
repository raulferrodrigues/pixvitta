# Recent sources

## Goal

Replace the filesystem-specific recent-folders feature with a provider-neutral
recent-sources feature. A successfully opened local folder, 4chan thread, or
E-Hentai gallery can be reopened from the onboarding screen using the title
chosen by its provider. Mixes of several sources are saved in the same list
and can be reopened too.

## Ownership

The main-process media library remains the authority for collection changes.
The renderer does not infer or persist recent entries.

1. A provider finishes loading a collection.
2. The media library commits and publishes that collection.
3. The renderer applies it and sends its existing stable acknowledgement.
4. Only then may main persist the recent source.
5. Main publishes the updated recent-source list back to the renderer.

Failed, ignored, or unacknowledged collection changes never alter recents.
Refreshing the active collection does not reorder it.

Each source added to a mix is remembered on its own, as when it is opened. A
saved mix is written at the same point, after the source (see Saved mixes).

## Provider contract

Each provider supplies a stable provider ID and a broad source kind (`folder`
or `web`). Each loaded collection already supplies:

- `canonicalLocation`, the durable value used to reopen it;
- `title`, the human-readable name shown in the viewer and recents;
- `remember`, whether this collection may be persisted.

Provider titles are intentionally provider-specific:

- local folders use the folder basename;
- 4chan uses the thread subject when present and otherwise falls back to the
  board and thread number;
- E-Hentai uses the gallery metadata title.

## Saved mixes

A mix is saved while it is built. The library owns the session; this store owns
the list.

- **The session is the save.** Adding a second source to a collection starts a
  session with a new saved-mix ID. Every add and remove in that session
  rewrites that one saved mix, so only its latest state exists. Another open
  ends the session; quitting does too. Reopening a saved mix resumes its
  session, so later changes rewrite it. Building the same sources by hand in
  a new session is a new saved mix; mixes are never matched by their sources.
- **What is saved.** The members, in zipper order, whose provider asks to be
  remembered. A mix with fewer than two of them is not in the list. A session
  that goes down to one source takes its mix out of the list; adding a source
  again in that session brings the same mix back with its name and pin. The
  name and pin wait in memory for that, not on disk, so after a restart the
  mix is gone.
- **The list.** Sources and mixes share one list, newest first. Pinned mixes
  come first and do not count toward the cap of ten; only mixes can be pinned.
  A mix shows its name, or an automatic title from its sources' titles ("a +
  b", "a + 2 more"), the number of its sources, and their titles.
- **Pin and rename.** Only a pinned mix can be renamed; an empty name goes
  back to the automatic title. Unpinning keeps the name and puts the mix at the
  front of the unpinned entries, as if just opened, so it does not drop off the
  list the moment it is unpinned.
- **Removing.** Removing a mix deletes the saved mix only; its sources stay as
  their own entries. Removing a source leaves the mixes that hold it alone.
- **Reopening.** Main loads every member through its provider and the request
  broker and commits one collection. A member that fails is present with no
  items and its error, and stays in the saved mix until the user removes it.
  If no member loads, the open fails as any open does. Reopening moves the mix
  to the front; it does not move its sources.

### Where it shows

- On the first-run screen, clicking a mix opens it. Its pin shows at the end
  of the row, always when pinned and on hover otherwise, beside the remove
  button.
- In the sources panel, a source row adds to the collection and ends in "+";
  a mix row opens the mix in place of the collection and ends in "Open". The
  replace question asks first when the collection is a mix. The mix being
  viewed, and sources already in it, are not listed.
- The mix being viewed is pinned from the end of the panel's "In the mix"
  heading instead, while it is saved. Once pinned, its name shows in that
  heading, and a click or F2 on it renames it in place.
- Both places give a mix a native menu (right-click, the menu key, or
  Shift+F10) with Pin or Unpin, Rename, and Remove from Recents. F2 renames a
  pinned mix in place; Enter or leaving the field saves, Escape cancels.

Main decides all of it: which entries are mixes, their titles, and which saved
mix the open collection is (`MediaSource.mixId`). React only shows the list.

## Persisted shape

`recent-sources.json` is an array of entries, each a source or a mix:

```ts
type RecentSource = {
  location: string;
  title: string;
  providerId: string;
  kind: "folder" | "web";
  openedMs: number;
};

type SavedMix = {
  kind: "mix";
  id: string;
  name?: string;
  pinned: boolean;
  members: Array<{ location: string; title: string; providerId: string; kind: "folder" | "web" }>;
  openedMs: number;
};
```

Sources deduplicate by location and mixes by ID. Opening a source moves it to
the front and updates all provider-supplied metadata. Each write is stamped
after every other entry, so a source and the mix it was added to, written in
the same millisecond, keep their order when the file is read again.

Entries are validated one by one: an invalid entry is skipped without losing
the rest, a mix keeps only its valid members, each location once, and a mix
left with fewer than two is skipped.

## Migration

Files written before mixes hold only sources, which have no `"mix"` kind, and
load unchanged. A build from before mixes reading a newer file skips the mix
entries and keeps the sources.

The new store uses `recent-sources.json`. If it does not exist, the old
`recent-folders.json` is read once as migration input. Valid legacy paths become
`local-folder` sources and are written to the new file. The legacy file is left
untouched as a harmless recovery artifact.

Web source URLs are local user data and can reveal browsing history. Providers
must explicitly opt in through `remember`; 4chan and E-Hentai do so for this
feature.
