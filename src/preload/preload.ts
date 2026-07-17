import { contextBridge, ipcRenderer } from "electron";
import type { Folder } from "../shared/media";
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
  // Folder actions are request/response IPC calls. From React's point of view
  // these behave like async API calls; from Electron's point of view they cross
  // into ipcMain handlers that can open dialogs and read the filesystem.
  openFolder: (): Promise<Folder | null> => ipcRenderer.invoke("folder:open"),
  openRecentFolder: (folderPath: string): Promise<Folder> =>
    ipcRenderer.invoke("folder:open-recent", folderPath),
  rescanFolder: (folderPath: string): Promise<Folder> =>
    ipcRenderer.invoke("folder:rescan", folderPath),

  // Persistent app data also goes through main. The renderer gets plain objects,
  // not direct access to JSON files under Electron's userData directory.
  getRecentFolders: (): Promise<RecentFolder[]> => ipcRenderer.invoke("recent-folders:get"),
  removeRecentFolder: (folderPath: string): Promise<RecentFolder[]> =>
    ipcRenderer.invoke("recent-folders:remove", folderPath),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("settings:save", settings),

  // Media actions pass IDs or validated data across the bridge. The main process
  // resolves IDs to paths and decides whether anything should touch disk.
  showMediaContextMenu: (mediaId: string): Promise<boolean> => ipcRenderer.invoke("media:show-context-menu", mediaId),
  saveMediaThumbnail: (mediaId: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke("thumbnail:save-media", mediaId, dataUrl),

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
  onOpenedFile: (callback: (folder: Folder) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, folder: Folder) => callback(folder);
    ipcRenderer.on("file:opened", listener);
    return () => ipcRenderer.removeListener("file:opened", listener);
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  }
} satisfies PixvittaApi;

contextBridge.exposeInMainWorld("pixvitta", pixvittaApi);
