import type { BrowserWindow } from "electron";

// Menus and low-level keyboard hooks report raw input events, not DOM Keyboard
// events. This helper keeps the app's Command/Ctrl shortcuts aligned with the
// shared hotkey constants used elsewhere.
export function isCommandShortcut(input: Electron.Input, accelerator: string): boolean {
  const key = accelerator.replace("CommandOrControl+", "").toLowerCase();
  return (input.meta || input.control) && input.key.toLowerCase() === key;
}

// The renderer needs to know when native chrome state changes so custom controls
// can mirror fullscreen and zoom. The actual source of truth stays on the native
// BrowserWindow.
export function notifyWindowChromeChanged(window: BrowserWindow): void {
  window.webContents.send("window:chrome-changed", {
    zoomFactor: window.webContents.getZoomFactor(),
    isFullScreen: window.isFullScreen(),
    hasMacTrafficLights: process.platform === "darwin"
  });
}
