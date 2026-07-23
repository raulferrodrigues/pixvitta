import type { AppBuildInfo } from "./appBuild";
import type {
  MediaCollection,
  OpenSourceRequest,
  OpenSourceResult
} from "./media";
import type { RecentFolder } from "./recentFolders";
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
  openSource(request: OpenSourceRequest): Promise<OpenSourceResult>;
  refreshSource(sourceId: string): Promise<OpenSourceResult>;
  openSourceOrigin(sourceId: string): Promise<boolean>;
  getRecentFolders(): Promise<RecentFolder[]>;
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  showMediaContextMenu(mediaId: string): Promise<boolean>;
  saveMediaThumbnail(thumbnailReference: string, dataUrl: string): Promise<boolean>;
  openPreferences(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  getWindowChromeState(): Promise<WindowChromeState>;
  markViewerReady(): Promise<void>;
  onWindowChromeChanged(callback: (state: WindowChromeState) => void): () => void;
  onCommand(callback: (command: PixvittaCommand) => void): () => void;
  onOpenedFile(callback: (collection: MediaCollection) => void): () => void;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
};
