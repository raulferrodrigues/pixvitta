export type MediaKind = "image" | "video";

export type MediaSourceCapabilities = {
  canRefresh: boolean;
  canSort: boolean;
  canOpenOrigin: boolean;
};

export type MediaSource = {
  id: string;
  title: string;
  originLabel?: string;
  capabilities: MediaSourceCapabilities;
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
};

export type MediaCollection = {
  source: MediaSource;
  items: MediaItem[];
  selectedId: string | null;
};

export type OpenSourceRequest =
  | { kind: "pick-directory" }
  | { kind: "location"; location: string };

export type OpenSourceError =
  | "invalid-location"
  | "unsupported-location"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "invalid-response"
  | "no-supported-media";

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
