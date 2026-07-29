import type { AppBuildInfo } from "./appBuild";
import type {
  MediaCollection,
  OpenSourceError,
  OpenSourceRequest
} from "./media";
import type { RecentSource } from "./recentSources";
import type { AppSettings } from "./settings";

export type PixvittaCommand =
  | "open-folder"
  | "refresh-source"
  | "open-preferences"
  | "previous-media"
  | "next-media"
  | "seek-video-backward"
  | "seek-video-forward"
  | "toggle-video-playback";

export type WindowChromeState = {
  zoomFactor: number;
  isFullScreen: boolean;
  hasMacTrafficLights: boolean;
};

export type PixvittaApi = {
  getBuildInfo(): Promise<AppBuildInfo>;
  openSource(request: OpenSourceRequest): void;
  refreshSource(): void;
  openSourceOrigin(sourceId: string): Promise<boolean>;
  getRecentSources(): Promise<RecentSource[]>;
  removeRecentSource(location: string): Promise<RecentSource[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  showMediaContextMenu(mediaId: string): Promise<boolean>;
  saveMediaThumbnail(thumbnailReference: string, dataUrl: string): Promise<boolean>;
  openPreferences(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  getWindowChromeState(): Promise<WindowChromeState>;
  markViewerReady(): Promise<void>;
  acknowledgeCollection(): void;
  onWindowChromeChanged(callback: (state: WindowChromeState) => void): () => void;
  onCommand(callback: (command: PixvittaCommand) => void): () => void;
  onCollectionChanged(callback: (collection: MediaCollection) => void): () => void;
  onSourceLoadingChanged(callback: (isLoading: boolean) => void): () => void;
  onSourceError(callback: (error: OpenSourceError) => void): () => void;
  onRecentSourcesChanged(callback: (sources: RecentSource[]) => void): () => void;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
};
