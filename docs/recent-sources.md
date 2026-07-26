# Recent sources

## Goal

Replace the filesystem-specific recent-folders feature with a provider-neutral
recent-sources feature. A successfully opened local folder, 4chan thread, or
E-Hentai gallery can be reopened from the onboarding screen using the title
chosen by its provider.

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

## Persisted shape

```ts
type RecentSource = {
  location: string;
  title: string;
  providerId: string;
  kind: "folder" | "web";
  openedMs: number;
};
```

Locations are the deduplication key. Reopening a source moves it to the front
and updates all provider-supplied metadata. The list remains capped at ten.

## Migration

The new store uses `recent-sources.json`. If it does not exist, the old
`recent-folders.json` is read once as migration input. Valid legacy paths become
`local-folder` sources and are written to the new file. The legacy file is left
untouched as a harmless recovery artifact.

Web source URLs are local user data and can reveal browsing history. Providers
must explicitly opt in through `remember`; 4chan and E-Hentai do so for this
feature.
