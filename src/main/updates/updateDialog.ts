import { app } from "electron";
import { autoUpdater, type UpdateCheckResult, type UpdateInfo } from "electron-updater";
import { readFileSync } from "node:fs";
import path from "node:path";
import { showAppMessageBox } from "../windows";
import { getUpdateChannel, getUpdatesUnavailableMessage } from "./updateStatus";

const UPDATE_CHANNEL = getUpdateChannel(app.getVersion());
const STARTUP_CHECK_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

let initialized = false;
let activeCheck: Promise<UpdateCheckResult | null> | null = null;
let downloadedUpdate: UpdateInfo | null = null;
let lastPromptedVersion: string | null = null;
let restartPrompt: Promise<void> | null = null;

function readPackageTypeMarker(): string | undefined {
  if (!app.isPackaged || process.platform !== "linux") return undefined;

  try {
    return readFileSync(path.join(process.resourcesPath, "package-type"), "utf8");
  } catch {
    return undefined;
  }
}

function updatesUnavailableMessage(): string {
  return getUpdatesUnavailableMessage(app.getVersion(), {
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImagePath: process.env.APPIMAGE,
    packageTypeMarker: readPackageTypeMarker()
  });
}

function canUpdate(): boolean {
  return updatesUnavailableMessage().length === 0;
}

async function showUpdateError(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  await showAppMessageBox({
    type: "error",
    title: "Updates",
    message: "Pixvitta could not check for updates",
    detail,
    buttons: ["OK"]
  });
}

async function promptToRestart(update: UpdateInfo, force = false): Promise<void> {
  if (restartPrompt) return restartPrompt;
  if (!force && lastPromptedVersion === update.version) return;
  lastPromptedVersion = update.version;

  restartPrompt = (async () => {
    const result = await showAppMessageBox({
      type: "info",
      title: "Update Ready",
      message: `Pixvitta ${update.version} is ready to install`,
      detail: "Restart now to apply the update. If you choose Later, Pixvitta will install it when you quit the app.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) autoUpdater.quitAndInstall();
  })();

  try {
    await restartPrompt;
  } finally {
    restartPrompt = null;
  }
}

function initializeUpdater(): void {
  if (initialized || !canUpdate()) return;
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = UPDATE_CHANNEL === "dev";
  autoUpdater.channel = UPDATE_CHANNEL;
  // Setting a channel enables downgrades in electron-updater, so restore the
  // safer policy for both stable and development builds.
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-downloaded", (update) => {
    downloadedUpdate = update;
    void promptToRestart(update);
  });
  autoUpdater.on("appimage-filename-updated", (updatedPath) => {
    console.info(`Pixvitta AppImage updated at ${updatedPath}`);
  });
  autoUpdater.on("error", (error) => {
    console.error("Pixvitta automatic update error", error);
  });
}

async function performCheck(): Promise<UpdateCheckResult | null> {
  initializeUpdater();
  if (activeCheck) return activeCheck;

  activeCheck = autoUpdater.checkForUpdates();
  try {
    return await activeCheck;
  } finally {
    activeCheck = null;
  }
}

export function startAutomaticUpdates(): void {
  if (!canUpdate()) return;
  initializeUpdater();

  const startupTimer = setTimeout(() => {
    void performCheck().catch((error: unknown) => console.error("Pixvitta startup update check failed", error));
  }, STARTUP_CHECK_DELAY_MS);
  startupTimer.unref();

  const interval = setInterval(() => {
    void performCheck().catch((error: unknown) => console.error("Pixvitta scheduled update check failed", error));
  }, UPDATE_CHECK_INTERVAL_MS);
  interval.unref();
}

export async function checkForUpdates(): Promise<void> {
  const unavailableMessage = updatesUnavailableMessage();
  if (unavailableMessage) {
    await showAppMessageBox({
      type: "info",
      title: "Updates",
      message: "Automatic updates are unavailable",
      detail: unavailableMessage,
      buttons: ["OK"]
    });
    return;
  }

  if (downloadedUpdate) {
    await promptToRestart(downloadedUpdate, true);
    return;
  }

  try {
    const result = await performCheck();
    if (downloadedUpdate) {
      await promptToRestart(downloadedUpdate);
      return;
    }
    if (!result?.isUpdateAvailable) {
      await showAppMessageBox({
        type: "info",
        title: "Updates",
        message: "Pixvitta is up to date",
        detail: `You are running Pixvitta ${app.getVersion()} on the ${UPDATE_CHANNEL} channel.`,
        buttons: ["OK"]
      });
      return;
    }

    await showAppMessageBox({
      type: "info",
      title: "Updates",
      message: `Pixvitta ${result.updateInfo.version} is downloading`,
      detail: "You can keep using Pixvitta. The app will ask to restart when the update is ready.",
      buttons: ["OK"]
    });
  } catch (error: unknown) {
    await showUpdateError(error);
  }
}
