import { contextBridge, ipcRenderer } from "electron";
import type { AppBuildInfo } from "../shared/appBuild";
import type {
  DownloadMediaResult,
  MediaCollection,
  OpenSourceError,
  OpenSourceRequest
} from "../shared/media";
import type { PixvittaApi, PixvittaCommand, WindowChromeState } from "../shared/pixvittaApi";
import type { RecentFolder } from "../shared/recentFolders";
import type { AppSettings } from "../shared/settings";

/*
 * The preload script runs in a special Electron context before the renderer's
 * web app starts. It can use ipcRenderer, but React cannot because
 * nodeIntegration is disabled and contextIsolation is enabled. contextBridge
 * exposes a tiny, typed window.pixvitta API that feels like normal browser
 * methods while still routing privileged work to the main process.
 */

const pixvittaApi = {
  getBuildInfo: (): Promise<AppBuildInfo> => ipcRenderer.invoke("app:get-build-info"),
  openSource: (request: OpenSourceRequest): void =>
    ipcRenderer.send("source:open", request),
  refreshSource: (): void =>
    ipcRenderer.send("source:refresh"),
  openSourceOrigin: (sourceId: string): Promise<boolean> =>
    ipcRenderer.invoke("source:open-origin", sourceId),

  // Persistent app data also goes through main. The renderer gets plain objects,
  // not direct access to JSON files under Electron's userData directory.
  getRecentFolders: (): Promise<RecentFolder[]> => ipcRenderer.invoke("recent-folders:get"),
  removeRecentFolder: (folderPath: string): Promise<RecentFolder[]> =>
    ipcRenderer.invoke("recent-folders:remove", folderPath),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("settings:save", settings),

  // Media actions pass IDs or validated data across the bridge. The main process
  // resolves IDs to paths and decides whether anything should touch disk.
  downloadMedia: (mediaId: string): Promise<DownloadMediaResult> =>
    ipcRenderer.invoke("media:download", mediaId),
  showMediaContextMenu: (mediaId: string): Promise<boolean> => ipcRenderer.invoke("media:show-context-menu", mediaId),
  saveMediaThumbnail: (thumbnailReference: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke("thumbnail:save-media", thumbnailReference, dataUrl),

  // Native window state belongs to BrowserWindow in the main process. These
  // methods give React controls without granting direct BrowserWindow access.
  openPreferences: (): Promise<void> => ipcRenderer.invoke("window:open-preferences"),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke("window:toggle-fullscreen"),
  exitFullscreen: (): Promise<void> => ipcRenderer.invoke("window:exit-fullscreen"),
  getWindowChromeState: (): Promise<WindowChromeState> => ipcRenderer.invoke("window:get-chrome-state"),

  // This readiness call tells main that React has mounted and installed the
  // event subscriptions below. It prevents early file-open events from being
  // sent into the void during startup.
  markViewerReady: (): Promise<void> => ipcRenderer.invoke("viewer:ready"),
  acknowledgeCollection: (): void =>
    ipcRenderer.send("library:renderer-stable"),

  // Event subscriptions are push-style messages from main to renderer. Each one
  // returns an unsubscribe function so React effects can clean up listeners.
  onWindowChromeChanged: (callback: (state: WindowChromeState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WindowChromeState) => callback(state);
    ipcRenderer.on("window:chrome-changed", listener);
    return () => ipcRenderer.removeListener("window:chrome-changed", listener);
  },
  onCommand: (callback: (command: PixvittaCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: PixvittaCommand) => callback(command);
    ipcRenderer.on("menu:command", listener);
    return () => ipcRenderer.removeListener("menu:command", listener);
  },
  onCollectionChanged: (callback: (collection: MediaCollection) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, collection: MediaCollection) => callback(collection);
    ipcRenderer.on("library:collection-changed", listener);
    return () => ipcRenderer.removeListener("library:collection-changed", listener);
  },
  onSourceLoadingChanged: (callback: (isLoading: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isLoading: boolean) => callback(isLoading);
    ipcRenderer.on("library:loading-changed", listener);
    return () => ipcRenderer.removeListener("library:loading-changed", listener);
  },
  onSourceError: (callback: (error: OpenSourceError) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: OpenSourceError) => callback(error);
    ipcRenderer.on("library:source-error", listener);
    return () => ipcRenderer.removeListener("library:source-error", listener);
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  }
} satisfies PixvittaApi;

contextBridge.exposeInMainWorld("pixvitta", pixvittaApi);
