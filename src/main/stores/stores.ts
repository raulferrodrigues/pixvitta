import { app } from "electron";
import path from "node:path";
import type { RecentFolder } from "../../shared/recentFolders";
import type { AppSettings } from "../../shared/settings";
import { RecentFoldersStore } from "./recentFolders";
import { SettingsStore } from "./settings";

/*
 * Stores is the persistence box for main-process features.
 *
 * Callers should ask for persisted app data through four plain verbs:
 * getSettings, saveSettings, getRecentFolders, and saveRecentFolder. They should
 * not know which JSON files exist, where userData lives, when data is first
 * loaded, or which store class performs sanitization.
 *
 * The concrete store classes remain in sibling files because they are useful
 * units to test directly, but the rest of main should enter through this file.
 */

let settingsStore: SettingsStore | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;

let recentFoldersStore: RecentFoldersStore | null = null;
let recentFoldersLoadPromise: Promise<RecentFolder[]> | null = null;

function getSettingsStore(): SettingsStore {
  // Resolve userData at first use. Tests can redirect app paths after imports,
  // so store construction must not happen while modules are evaluated.
  settingsStore ??= new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  return settingsStore;
}

async function ensureSettingsLoaded(): Promise<AppSettings> {
  settingsLoadPromise ??= getSettingsStore().load();
  return settingsLoadPromise;
}

function getRecentFoldersStore(): RecentFoldersStore {
  // Same lazy path rule as settings. Recent folders are userData-backed and
  // should follow Electron's final app path.
  recentFoldersStore ??= new RecentFoldersStore(path.join(app.getPath("userData"), "recent-folders.json"));
  return recentFoldersStore;
}

async function ensureRecentFoldersLoaded(): Promise<RecentFolder[]> {
  recentFoldersLoadPromise ??= getRecentFoldersStore().load();
  return recentFoldersLoadPromise;
}

export async function getSettings(): Promise<AppSettings> {
  await ensureSettingsLoaded();
  return getSettingsStore().get();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  await ensureSettingsLoaded();
  return getSettingsStore().save(settings);
}

export async function getRecentFolders(): Promise<RecentFolder[]> {
  await ensureRecentFoldersLoaded();
  return getRecentFoldersStore().get();
}

export async function saveRecentFolder(folderPath: string): Promise<void> {
  await ensureRecentFoldersLoaded();
  await getRecentFoldersStore().add(folderPath);
}

export async function removeRecentFolder(folderPath: string): Promise<RecentFolder[]> {
  await ensureRecentFoldersLoaded();
  return getRecentFoldersStore().remove(folderPath);
}
