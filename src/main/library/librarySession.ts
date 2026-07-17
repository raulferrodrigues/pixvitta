import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Folder } from "../../shared/media";
import type { FileOrder } from "../../shared/settings";
import type { RecentFolder } from "../../shared/recentFolders";
import { parseDialogResponses } from "../app";
import { openMediaFile, openMediaFolder } from "../media";
import { getSettings } from "../settings";
import { getRecentFolders as getStoredRecentFolders, removeRecentFolder as removeStoredRecentFolder, saveRecentFolder } from "../stores";

/*
 * Library/session is the app-level folder-opening feature. It composes deeper
 * modules: media knows how to scan files, settings knows the user's scan
 * preferences, and this module owns folder dialogs plus recent-folder behavior.
 *
 * This is intentionally the boundary above those lower-level pieces. The
 * renderer and the rest of main should be able to ask for "open folder",
 * "rescan this folder", or "open that recent folder" without learning where the
 * recent-folder JSON lives, how dialog modality is selected, or which scan
 * options media needs.
 *
 * Recent-folder persistence lives behind "../stores". This module decides when
 * a folder becomes recent: only after the library has successfully opened or
 * selected media in that folder.
 *
 * Like mediaFeature.ts, this module self-registers its IPC at import time. That
 * keeps main.ts focused on assembling features: importing "../library" means the
 * library feature is present, including its renderer channels.
 */

// Dialog test fixtures are read once with the module, while production falls
// through to Electron's native dialog. The queue stays private so only this
// feature decides what counts as a folder selection.
let dialogResponses = parseDialogResponses();
let randomOrderSession: { folderPath: string; seed: string } | null = null;

function getRandomOrderSeed(folderPath: string, fileOrder: FileOrder, reuseExisting: boolean): string | undefined {
  if (fileOrder !== "random") {
    randomOrderSession = null;
    return undefined;
  }

  const normalizedFolderPath = path.resolve(folderPath);
  if (reuseExisting && randomOrderSession?.folderPath === normalizedFolderPath) return randomOrderSession.seed;

  const seed = randomBytes(16).toString("hex");
  randomOrderSession = { folderPath: normalizedFolderPath, seed };
  return seed;
}

async function chooseFolder(parentWindow?: BrowserWindow | null): Promise<string | null> {
  if (dialogResponses) {
    const nextResponse = dialogResponses.shift();
    return nextResponse === undefined ? null : nextResponse;
  }

  const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };

  // Dialog parenting is internal to the library feature because it is a native
  // UI detail, not part of the public folder-opening contract. Prefer the window
  // that initiated the IPC request, fall back to the focused window for direct
  // main-process calls, and only show an unparented dialog when no safe parent
  // exists.
  const window = parentWindow && !parentWindow.isDestroyed() ? parentWindow : BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

async function openFolderPath(
  folderPath: string,
  options: { remember?: boolean; reuseRandomOrder?: boolean } = {}
): Promise<Folder> {
  // Settings are loaded on demand at the moment a scan needs them. Importing the
  // library feature should register behavior, not perform disk reads or lock in a
  // settings path before Electron has settled.
  const settings = await getSettings();
  const result = await openMediaFolder(folderPath, {
    fileOrder: settings.fileOrder,
    includeHidden: settings.includeHidden,
    randomSeed: getRandomOrderSeed(folderPath, settings.fileOrder, options.reuseRandomOrder ?? false)
  });

  if (options.remember) {
    // Remember only the normalized folder path returned by media after a
    // successful scan. Failed opens and canceled dialogs should not mutate the
    // recent-folder list.
    await saveRecentFolder(result.folderPath);
  }

  return result;
}

async function openFolderForWindow(window?: BrowserWindow | null): Promise<Folder | null> {
  const folderPath = await chooseFolder(window);
  if (!folderPath) return null;
  return openFolderPath(folderPath, { remember: true });
}

export async function openFolder(): Promise<Folder | null> {
  return openFolderForWindow();
}

export async function openRecentFolder(folderPath: string): Promise<Folder> {
  return openFolderPath(folderPath, { remember: true });
}

export async function rescanFolder(folderPath: string): Promise<Folder> {
  return openFolderPath(folderPath, { reuseRandomOrder: true });
}

export async function openFileAsFolder(filePath: string): Promise<Folder | null> {
  // Direct file opens still enter through the library session. Media resolves
  // the parent folder and selected item, while this layer applies user scan
  // preferences and remembers the folder without exposing RecentFoldersStore.
  const settings = await getSettings();
  const folder = await openMediaFile(filePath, {
    fileOrder: settings.fileOrder,
    includeHidden: settings.includeHidden,
    randomSeed: getRandomOrderSeed(path.dirname(path.resolve(filePath)), settings.fileOrder, false)
  });

  if (folder) {
    await saveRecentFolder(folder.folderPath);
  }

  return folder;
}

export async function getRecentFolders(): Promise<RecentFolder[]> {
  return getStoredRecentFolders();
}

export async function removeRecentFolder(folderPath: string): Promise<RecentFolder[]> {
  return removeStoredRecentFolder(folderPath);
}

/*
 * These handlers are registered by the feature module itself instead of a
 * generic IPC registry. The channel names are library/session concepts, and the
 * implementation needs private access to dialog parenting, recent folders, and
 * settings-aware scan helpers. Keeping the registration here prevents those
 * details from leaking into main.ts or a broad ipcHandlers module.
 */
ipcMain.handle("folder:open", (event) => {
  return openFolderForWindow(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle("folder:open-recent", (_event, folderPath: string) => {
  return openRecentFolder(folderPath);
});

ipcMain.handle("folder:rescan", (_event, folderPath: string) => {
  return rescanFolder(folderPath);
});

ipcMain.handle("recent-folders:get", () => {
  return getRecentFolders();
});

ipcMain.handle("recent-folders:remove", (_event, folderPath: string) => {
  return removeRecentFolder(folderPath);
});
