import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createUpdateState,
  onCheckFailure,
  onCheckStart,
  onDownloaded,
  onDownloadFailure,
  onDownloadProgress,
  onDownloadStart,
  onInstallFailure,
  onNoUpdate,
  onUpdateAvailable,
  resolveUpdateAction,
  type UpdateState
} from "../../shared/updates";
import { appBuildInfo } from "../app/buildInfo";
import { getUpdateChannel, getUpdatesUnavailableReason } from "./updateStatus";

/*
 * App updates come from GitHub Releases through electron-updater. Stable builds
 * follow the "latest" channel and Nightly builds follow "nightly", each reading
 * its own metadata file from its own releases.
 *
 * Nothing downloads on its own. Main checks in the background and keeps the one
 * update state; the Settings modal shows it with a single button that checks,
 * downloads, then restarts to install. A downloaded update also installs when
 * the app quits.
 *
 * Each check fetches the releases feed and one metadata file from GitHub, so
 * background checks stay hours apart.
 *
 * Importing this module registers its IPC, like the other main features.
 */

const STARTUP_CHECK_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

let state = createUpdateState(
  app.getVersion(),
  getUpdateChannel(appBuildInfo.flavor),
  getUpdatesUnavailableReason({
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImagePath: process.env.APPIMAGE,
    packageTypeMarker: readPackageTypeMarker()
  })
);
let initialized = false;
let activeCheck: Promise<void> | null = null;
let isInstalling = false;

function readPackageTypeMarker(): string | undefined {
  if (!app.isPackaged || process.platform !== "linux") return undefined;

  try {
    return readFileSync(path.join(process.resourcesPath, "package-type"), "utf8");
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // electron-updater appends response bodies and stacks; the first line says what failed.
  return message.split("\n", 1)[0] ?? message;
}

function setState(next: UpdateState): void {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("updates:state-changed", state);
  }
}

function initializeUpdater(): void {
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = state.channel === "nightly";
  autoUpdater.channel = state.channel;
  // Setting a channel enables downgrades in electron-updater, so restore the
  // safer policy for both stable and Nightly builds.
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("download-progress", (progress) => {
    setState(onDownloadProgress(state, progress.percent));
  });
  autoUpdater.on("appimage-filename-updated", (updatedPath) => {
    console.info(`${appBuildInfo.name} AppImage updated at ${updatedPath}`);
  });
  autoUpdater.on("error", (error) => {
    console.error(`${appBuildInfo.name} update error`, error);
    // Installers report failures here, after quitAndInstall has returned.
    if (isInstalling) {
      isInstalling = false;
      setState(onInstallFailure(state, errorMessage(error)));
    }
  });
}

// Only a check the user asked for shows "checking" and its errors. A background
// check changes the state only when it finds an update, so being offline does
// not leave an error in Settings. A user check that joins a running background
// check still gets its answer, because the state is then "checking".
function runCheck(requestedByUser: boolean): Promise<void> {
  if (state.status === "unavailable" || state.status === "downloading" || state.status === "downloaded") {
    return Promise.resolve();
  }
  initializeUpdater();
  if (requestedByUser) setState(onCheckStart(state));
  if (activeCheck) return activeCheck;

  activeCheck = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable) setState(onUpdateAvailable(state, result.updateInfo.version));
      else if (state.status === "checking") setState(onNoUpdate(state));
    } catch (error: unknown) {
      console.error(`${appBuildInfo.name} update check failed`, error);
      if (state.status === "checking") setState(onCheckFailure(state, errorMessage(error)));
    } finally {
      activeCheck = null;
    }
  })();
  return activeCheck;
}

async function checkForUpdates(): Promise<UpdateState> {
  await runCheck(true);
  return state;
}

async function downloadUpdate(): Promise<UpdateState> {
  const version = state.availableVersion;
  if (resolveUpdateAction(state) !== "download" || !version) return state;

  setState(onDownloadStart(state));
  try {
    await autoUpdater.downloadUpdate();
    setState(onDownloaded(state, version));
  } catch (error: unknown) {
    console.error(`${appBuildInfo.name} update download failed`, error);
    setState(onDownloadFailure(state, errorMessage(error)));
  }
  return state;
}

function installUpdate(): void {
  if (resolveUpdateAction(state) !== "install") return;
  isInstalling = true;
  try {
    autoUpdater.quitAndInstall();
  } catch (error: unknown) {
    isInstalling = false;
    console.error(`${appBuildInfo.name} update install failed`, error);
    setState(onInstallFailure(state, errorMessage(error)));
  }
}

export function startAutomaticUpdates(): void {
  if (state.status === "unavailable") return;

  const startupTimer = setTimeout(() => void runCheck(false), STARTUP_CHECK_DELAY_MS);
  startupTimer.unref();

  const interval = setInterval(() => void runCheck(false), UPDATE_CHECK_INTERVAL_MS);
  interval.unref();
}

ipcMain.handle("updates:get-state", () => state);
ipcMain.handle("updates:check", () => checkForUpdates());
ipcMain.handle("updates:download", () => downloadUpdate());
ipcMain.handle("updates:install", () => installUpdate());
