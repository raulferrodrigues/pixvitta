import { BrowserWindow } from "electron";
import path from "node:path";
import { HOTKEYS } from "../../shared/hotkeys";
import { isCommandShortcut, notifyWindowChromeChanged } from "./windowChrome";
import { getWindowIcon } from "./windowIcon";

type MainWindowOptions = {
  rendererUrl(hash?: string): string;
  onClosed(window: BrowserWindow): void;
  onLoaded(window: BrowserWindow): void;
  onCloseShortcut(window: BrowserWindow): void;
  onOpenPreferences(): void;
};

// BrowserWindow is the native shell around a renderer page. This function owns
// the main viewer window: dimensions, macOS title-bar behavior, security
// settings, preload script, keyboard shortcuts, and the URL that loads React.
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const startHash = process.env.PIXVITTA_TEST_START_HASH;
  const isPreferencesRoute = startHash === "preferences";
  const autoHideMenuBar = !isPreferencesRoute && process.platform !== "darwin";

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    title: "Pixvitta",
    icon: getWindowIcon(),
    backgroundColor: "#101214",
    autoHideMenuBar,
    ...(isPreferencesRoute || process.platform !== "darwin"
      ? {}
      : {
        // The viewer draws custom controls into the title-bar area, so the
        // native macOS traffic lights are inset while the rest of the title
        // bar is hidden.
        titleBarStyle: "hiddenInset" as const,
        trafficLightPosition: { x: 16, y: 14 }
      }),
    webPreferences: {
      // The preload script is the narrow bridge between trusted main-process
      // capabilities and untrusted-ish web UI code. Keeping contextIsolation on
      // and nodeIntegration off means React cannot import fs, shell, or ipcMain.
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (autoHideMenuBar) {
    window.setMenuBarVisibility(false);
  }

  window.on("closed", () => options.onClosed(window));
  window.on("enter-full-screen", () => notifyWindowChromeChanged(window));
  window.on("leave-full-screen", () => notifyWindowChromeChanged(window));

  // Some shortcuts need main-process handling because they control native window
  // state instead of renderer state. The rest of the viewer's keyboard behavior
  // can remain in React where normal web event handling is easier.
  window.webContents.on("before-input-event", (event, input) => {
    if (isCommandShortcut(input, HOTKEYS.closeWindow)) {
      event.preventDefault();
      options.onCloseShortcut(window);
      return;
    }
    if ((input.meta || input.control) && (input.key === "," || input.key === "Comma")) {
      options.onOpenPreferences();
      return;
    }
    if (input.key === "Escape" && window.isFullScreen()) {
      window.setFullScreen(false);
    }
  });

  // loadURL points at Vite during development and at dist/index.html in packaged
  // builds. Once the page itself has loaded, pending macOS file-open requests can
  // move to the next queue, which waits for React's viewer:ready signal.
  void window.loadURL(options.rendererUrl(startHash)).then(() => {
    if (window.isDestroyed()) return;
    options.onLoaded(window);
  });

  return window;
}
