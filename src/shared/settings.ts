export type FileOrder = "name" | "kind" | "last-opened" | "date-added" | "modified" | "created" | "size" | "random";

export type MediaScaleMode = "native-or-smaller" | "fit-window";

export type AppSettings = {
  videoAutoplay: boolean;
  videoLoopByDefault: boolean;
  fileOrder: FileOrder;
  wrapNavigation: boolean;
  includeHidden: boolean;
  showVideoControls: boolean;
  unobtrusiveViewerControls: boolean;
  mediaScaleMode: MediaScaleMode;
};

export const defaultSettings: AppSettings = {
  videoAutoplay: false,
  videoLoopByDefault: true,
  fileOrder: "name",
  wrapNavigation: true,
  includeHidden: false,
  showVideoControls: true,
  unobtrusiveViewerControls: false,
  mediaScaleMode: "native-or-smaller"
};
