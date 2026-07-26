import { app } from "electron";
import path from "node:path";
import type {
  RecentSource,
  RecentSourceInput
} from "../../shared/recentSources";
import type { AppSettings } from "../../shared/settings";
import { RecentSourcesStore } from "./recentSources";
import { SettingsStore } from "./settings";

/*
 * Stores is the persistence box for main-process features.
 *
 * Callers should ask for persisted app data through four plain verbs:
 * getSettings, saveSettings, getRecentSources, and saveRecentSource. They should
 * not know which JSON files exist, where userData lives, when data is first
 * loaded, or which store class performs sanitization.
 *
 * The concrete store classes remain in sibling files because they are useful
 * units to test directly, but the rest of main should enter through this file.
 */

let settingsStore: SettingsStore | null = null;
let settingsLoadPromise: Promise<AppSettings> | null = null;

let recentSourcesStore: RecentSourcesStore | null = null;
let recentSourcesLoadPromise: Promise<RecentSource[]> | null = null;

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

function getRecentSourcesStore(): RecentSourcesStore {
  // Same lazy path rule as settings. Recent sources are userData-backed and
  // should follow Electron's final app path.
  const userData = app.getPath("userData");
  recentSourcesStore ??= new RecentSourcesStore(
    path.join(userData, "recent-sources.json"),
    path.join(userData, "recent-folders.json")
  );
  return recentSourcesStore;
}

async function ensureRecentSourcesLoaded(): Promise<RecentSource[]> {
  recentSourcesLoadPromise ??= getRecentSourcesStore().load();
  return recentSourcesLoadPromise;
}

export async function getSettings(): Promise<AppSettings> {
  await ensureSettingsLoaded();
  return getSettingsStore().get();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  await ensureSettingsLoaded();
  return getSettingsStore().save(settings);
}

export async function getRecentSources(): Promise<RecentSource[]> {
  await ensureRecentSourcesLoaded();
  return getRecentSourcesStore().get();
}

export async function saveRecentSource(
  source: RecentSourceInput
): Promise<RecentSource[]> {
  await ensureRecentSourcesLoaded();
  return getRecentSourcesStore().add(source);
}

export async function removeRecentSource(
  location: string
): Promise<RecentSource[]> {
  await ensureRecentSourcesLoaded();
  return getRecentSourcesStore().remove(location);
}
