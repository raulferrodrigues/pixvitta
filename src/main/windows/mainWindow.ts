import { BrowserWindow } from "electron";
import path from "node:path";
import { HOTKEYS } from "../../shared/hotkeys";
import { appBuildInfo } from "../app/buildInfo";
import { installTextEditingContextMenu } from "./textEditingContextMenu";
import { isCommandShortcut, notifyWindowChromeChanged } from "./windowChrome";
import { getWindowIcon } from "./windowIcon";

type MainWindowOptions = {
  rendererUrl(): string;
  onClosed(window: BrowserWindow): void;
  onDocumentReplaced(window: BrowserWindow): void;
  onCloseShortcut(window: BrowserWindow): void;
};

// BrowserWindow is the native shell around a renderer page. This function owns
// the main viewer window: dimensions, macOS title-bar behavior, security
// settings, preload script, keyboard shortcuts, and the URL that loads React.
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const autoHideMenuBar = process.platform !== "darwin";

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    title: appBuildInfo.name,
    icon: getWindowIcon(),
    backgroundColor: "#101214",
    autoHideMenuBar,
    ...(process.platform !== "darwin"
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

  installTextEditingContextMenu(window);
  window.on("closed", () => options.onClosed(window));
  // Fires when a new document commits, including reloads, and not for a
  // navigation that never commits, such as one that becomes a download.
  window.webContents.on("did-navigate", () => options.onDocumentReplaced(window));
  window.on("enter-full-screen", () => notifyWindowChromeChanged(window));
  window.on("leave-full-screen", () => notifyWindowChromeChanged(window));

  // Shortcuts that must win over Chromium's native controls are handled before
  // input reaches the page. The renderer still owns the resulting app actions.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.key === "ArrowLeft" || input.key === "ArrowRight")) {
      // Handle navigation before Chromium dispatches the key to focused native
      // video controls, which otherwise reinterpret arrows as timeline seeking.
      event.preventDefault();
      window.webContents.send("menu:command", input.key === "ArrowRight" ? "next-media" : "previous-media");
      return;
    }
    const key = input.key.toLowerCase();
    if (input.type === "keyDown" && !input.meta && !input.control && !input.alt && (key === "j" || key === "k" || key === "l")) {
      event.preventDefault();
      window.webContents.send(
        "menu:command",
        key === "j" ? "seek-video-backward" : key === "l" ? "seek-video-forward" : "toggle-video-playback"
      );
      return;
    }
    if (isCommandShortcut(input, HOTKEYS.closeWindow)) {
      event.preventDefault();
      options.onCloseShortcut(window);
      return;
    }
    if (input.type === "keyDown" && (input.meta || input.control) && (input.key === "," || input.key === "Comma")) {
      // Settings is a modal inside the viewer, so the shortcut becomes a viewer
      // command. Handling it here keeps Ctrl+, working on Linux, where the
      // menu bar (and its accelerator) is hidden.
      event.preventDefault();
      window.webContents.send("menu:command", "open-settings");
      return;
    }
    if (input.key === "Escape" && window.isFullScreen()) {
      window.setFullScreen(false);
    }
  });

  // loadURL points at Vite during development and at dist/index.html in packaged
  // builds. Pending events wait for React's viewer:ready signal, not this load.
  // Reloading while the first load runs also rejects this promise.
  void window.loadURL(options.rendererUrl()).catch((error) => {
    console.error("Could not finish loading the viewer.", error);
  });

  return window;
}
