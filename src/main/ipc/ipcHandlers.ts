import { BrowserWindow, ipcMain } from "electron";

/*
 * IPC is the renderer's request/response API into the main process. In a browser
 * app, React might fetch from an HTTP server. In this Electron app, React calls
 * window.pixvitta.*, preload.ts forwards that to ipcRenderer.invoke(), and these
 * ipcMain.handle() functions answer the request with privileged desktop work.
 *
 * Keep the handlers boring and explicit. Every channel is an app capability the
 * web UI is allowed to use, so this file is also a useful security audit surface.
 */

type IpcHandlerOptions = {
  createPreferencesWindow(): void;
};

export function registerIpcHandlers(options: IpcHandlerOptions): void {
  // Fullscreen is native BrowserWindow state. React asks for the action, but the
  // actual state change belongs here.
  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.setFullScreen(!window.isFullScreen());
  });

  // Escape handling and UI controls both use this channel to guarantee the
  // window leaves fullscreen even if renderer state is stale.
  ipcMain.handle("window:exit-fullscreen", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.setFullScreen(false);
  });

  // Preferences are a separate native BrowserWindow, not a modal drawn inside
  // the viewer, because that matches macOS app conventions.
  ipcMain.handle("window:open-preferences", () => {
    options.createPreferencesWindow();
  });

  // The renderer draws custom chrome, so it needs a read-only snapshot of the
  // native zoom/fullscreen state to keep its controls in sync.
  ipcMain.handle("window:get-chrome-state", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return {
      zoomFactor: window?.webContents.getZoomFactor() ?? 1,
      isFullScreen: window?.isFullScreen() ?? false,
      hasMacTrafficLights: process.platform === "darwin"
    };
  });
}
