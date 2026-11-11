import type { RecentSourceKind } from "./recentSources";

export type MediaKind = "image" | "video";

export type MediaSourceCapabilities = {
  canRefresh: boolean;
  canSort: boolean;
  canDownload: boolean;
  canDownloadCollection: boolean;
  canOpenOrigin: boolean;
};

// One of the sources a collection is made of. The ID is opaque and only
// meaningful to removeSource while this collection is open.
export type MediaSourceMember = {
  id: string;
  title: string;
  // The same kind recent sources carry, so both lists can share an icon.
  kind: RecentSourceKind;
  // How many items the source contributes to the collection.
  itemCount: number;
  // A short name for the site a web source comes from, such as "4chan", from
  // its provider. Absent for a folder.
  siteName?: string;
  // The location of the recent source this member is remembered as, matching
  // RecentSource.location. Absent for a source that is not remembered.
  recentLocation?: string;
  // Why the source's last load failed. It still shows what it had before, and
  // the next refresh tries it again. Absent when it loaded.
  error?: OpenSourceError;
};

export type MediaSource = {
  id: string;
  title: string;
  originLabel?: string;
  capabilities: MediaSourceCapabilities;
  // In the order their items interleave; a single source has one member.
  members: MediaSourceMember[];
};

export type MediaItem = {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  kind: MediaKind;
  sizeBytes: number;
  lastOpenedMs: number;
  addedMs: number;
  modifiedMs: number;
  createdMs: number;
  // The title of the source an item came from, set only when the collection
  // merges several sources.
  sourceLabel?: string;
};

export type MediaCollection = {
  source: MediaSource;
  items: MediaItem[];
  selectedId: string | null;
};

export type OpenSourceRequest =
  | { kind: "pick-directory" }
  | { kind: "location"; location: string };

// Main's question before an open from inside the app replaces a mix of two or
// more sources: what the open would replace, and the request to send again,
// marked as confirmed, if the user goes ahead.
export type ReplaceConfirmation = {
  request: OpenSourceRequest;
  title: string;
  sourceCount: number;
};

export type OpenSourceError =
  | "invalid-location"
  | "unsupported-location"
  | "not-found"
  | "authentication-required"
  | "rate-limited"
  | "unavailable"
  | "invalid-response"
  | "no-supported-media";

// What became of a request to add a source. A failure is also reported through
// the source error, like any other; a cancelled pick or a request made while
// another source operation runs is "not-added" with nothing to show.
export type AddSourceResult = "added" | "already-added" | "not-added";

export type DownloadActivityState =
  | "queued"
  | "active"
  | "complete"
  | "failed";

export type DownloadActivityRow = {
  id: string;
  mediaId: string;
  name: string;
  thumbnailUrl: string | null;
  state: DownloadActivityState;
};

export type DownloadActivitySnapshot = {
  revision: number;
  rows: DownloadActivityRow[];
  itemStates: Record<string, DownloadActivityState>;
  collectionActive: boolean;
};
