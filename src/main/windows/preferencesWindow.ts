import { BrowserWindow } from "electron";
import path from "node:path";
import { HOTKEYS } from "../../shared/hotkeys";
import { appBuildInfo } from "../app/buildInfo";
import { isCommandShortcut } from "./windowChrome";
import { getWindowIcon } from "./windowIcon";

type PreferencesWindowOptions = {
  rendererUrl(hash?: string): string;
  onClosed(): void;
  onCloseShortcut(): void;
};

// Settings are presented in a separate native window. It still loads the same
// renderer bundle, but the URL hash tells React to render the preferences route
// instead of the viewer.
export function createPreferencesBrowserWindow(options: PreferencesWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 520,
    height: 620,
    minWidth: 460,
    minHeight: 520,
    title: `${appBuildInfo.name} Settings`,
    icon: getWindowIcon(),
    backgroundColor: "#101214",
    resizable: true,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      // The preferences UI needs the same safe API surface as the viewer:
      // settings IPC, window controls, and no direct Node access.
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.on("closed", options.onClosed);

  window.webContents.on("before-input-event", (event, input) => {
    if (!isCommandShortcut(input, HOTKEYS.closeWindow)) return;
    event.preventDefault();
    options.onCloseShortcut();
  });

  void window.loadURL(options.rendererUrl("preferences"));

  return window;
}
