import type { AppBuildInfo } from "./appBuild";
import type {
  AddSourceResult,
  DownloadActivitySnapshot,
  MediaCollection,
  OpenSourceError,
  OpenSourceRequest
} from "./media";
import type { RecentSource } from "./recentSources";
import type { AppSettings } from "./settings";
import type { UpdateState } from "./updates";

export type PixvittaCommand =
  | "open-folder"
  | "add-folder"
  | "refresh-source"
  | "open-settings"
  | "previous-media"
  | "next-media"
  | "seek-video-backward"
  | "seek-video-forward"
  | "toggle-video-playback"
  | "show-shortcuts"
  | "check-for-updates";

export type WindowChromeState = {
  zoomFactor: number;
  isFullScreen: boolean;
  hasMacTrafficLights: boolean;
};

export type PixvittaApi = {
  getBuildInfo(): Promise<AppBuildInfo>;
  openSource(request: OpenSourceRequest): void;
  // Adds a source to the open collection; openSource replaces it. Resolves
  // once main is done with the request, after any collection it produced.
  addSource(request: OpenSourceRequest): Promise<AddSourceResult>;
  // Removes one member source, by its ID in source.members, from the open collection.
  removeSource(memberId: string): void;
  refreshSource(): void;
  openSourceOrigin(sourceId: string): Promise<boolean>;
  signInExHentai(): Promise<boolean>;
  getRecentSources(): Promise<RecentSource[]>;
  removeRecentSource(location: string): Promise<RecentSource[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  downloadMedia(mediaId: string): Promise<boolean>;
  downloadCollection(
    collectionName: string,
    mediaIds: string[]
  ): Promise<boolean>;
  getDownloadActivity(): Promise<DownloadActivitySnapshot>;
  showMediaContextMenu(mediaId: string): Promise<boolean>;
  saveMediaThumbnail(thumbnailReference: string, dataUrl: string): Promise<boolean>;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  getWindowChromeState(): Promise<WindowChromeState>;
  markViewerReady(): Promise<void>;
  acknowledgeCollection(): void;
  setSelectedMedia(mediaId: string | null): void;
  // Tells main whether a text field has focus, so it leaves viewer keys
  // (arrows, J, K, L) to the page while one does.
  setTextEntryFocused(focused: boolean): void;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onWindowChromeChanged(callback: (state: WindowChromeState) => void): () => void;
  onCommand(callback: (command: PixvittaCommand) => void): () => void;
  onCollectionChanged(callback: (collection: MediaCollection) => void): () => void;
  onSourceLoadingChanged(callback: (isLoading: boolean) => void): () => void;
  onSourceError(callback: (error: OpenSourceError) => void): () => void;
  onDownloadActivityChanged(
    callback: (snapshot: DownloadActivitySnapshot) => void
  ): () => void;
  onRecentSourcesChanged(callback: (sources: RecentSource[]) => void): () => void;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
  onUpdateStateChanged(callback: (state: UpdateState) => void): () => void;
};
