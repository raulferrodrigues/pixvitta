export type MediaKind = "image" | "video";

export type MediaItem = {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  kind: MediaKind;
  sizeBytes: number;
  lastOpenedMs: number;
  addedMs: number;
  modifiedMs: number;
  createdMs: number;
};

export type Folder = {
  folderPath: string;
  items: MediaItem[];
  selectedId: string | null;
};
