import type { Folder } from "./media";
import type { RecentFolder } from "./recentFolders";
import type { AppSettings } from "./settings";

export type PixvittaCommand =
  | "open-folder"
  | "rescan-folder"
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
  openFolder(): Promise<Folder | null>;
  openRecentFolder(folderPath: string): Promise<Folder>;
  rescanFolder(folderPath: string): Promise<Folder>;
  getRecentFolders(): Promise<RecentFolder[]>;
  removeRecentFolder(folderPath: string): Promise<RecentFolder[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  showMediaContextMenu(mediaId: string): Promise<boolean>;
  saveMediaThumbnail(mediaId: string, dataUrl: string): Promise<boolean>;
  openPreferences(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  getWindowChromeState(): Promise<WindowChromeState>;
  markViewerReady(): Promise<void>;
  onWindowChromeChanged(callback: (state: WindowChromeState) => void): () => void;
  onCommand(callback: (command: PixvittaCommand) => void): () => void;
  onOpenedFile(callback: (folder: Folder) => void): () => void;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
};
