import { BrowserWindow, ipcMain } from "electron";
import type { AppSettings } from "../../shared/settings";
import { getSettings as getStoredSettings, saveSettings as saveStoredSettings } from "../stores";

/*
 * Settings are an app-level main-process capability. Callers should ask for the
 * current settings or save new settings; they should not know where the JSON
 * file lives or how changes are broadcast to renderers.
 *
 * Persistence lives behind "../stores". This module owns the settings feature:
 * the app-level function names, settings IPC, and fan-out to renderer windows
 * after a successful save.
 *
 * Importing the feature also registers its IPC handlers. That mirrors the media
 * and library features: main.ts chooses which features are present by importing
 * them, while each feature owns the channel names and private implementation
 * details for its own renderer contract.
 */

function broadcastSettings(settings: AppSettings): void {
  // Main is the source of truth for saved settings. Once the store accepts a new
  // value, every open renderer gets the same snapshot instead of each window
  // polling or reading the JSON file independently.
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("settings:changed", settings);
  }
}

export async function getSettings(): Promise<AppSettings> {
  return getStoredSettings();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const savedSettings = await saveStoredSettings(settings);
  broadcastSettings(savedSettings);
  return savedSettings;
}

/*
 * Settings IPC is self-registered here because these channels are part of the
 * settings feature, not generic application plumbing. The handlers simply
 * delegate to the public functions above so renderer calls and main-process
 * calls share the same lazy load, persistence, and broadcast behavior.
 */
ipcMain.handle("settings:get", () => {
  return getSettings();
});

ipcMain.handle("settings:save", (_event, settings: AppSettings) => {
  return saveSettings(settings);
});
