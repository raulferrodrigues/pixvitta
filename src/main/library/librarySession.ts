import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import type { OpenSourceRequest } from "../../shared/media";
import type { RecentFolder } from "../../shared/recentFolders";
import { parseDialogResponses } from "../app";
import { getSettings } from "../settings";
import {
  getRecentFolders as getStoredRecentFolders,
  removeRecentFolder as removeStoredRecentFolder,
  saveRecentFolder
} from "../stores";
import {
  isMainWindow,
  publishMainWindowCollection,
  publishMainWindowLoading,
  publishMainWindowSourceError
} from "../windows";
import { MediaLibrary } from "./mediaLibrary";
import type { RegisteredMediaItem } from "./mediaRegistry";
import {
  createProviderRegistry,
  type MediaResource
} from "./providers";

let dialogResponses = parseDialogResponses();

const mediaLibrary = new MediaLibrary({
  providers: createProviderRegistry(),
  getSettings,
  remember: async (location) => {
    await saveRecentFolder(location);
  },
  publishCollection: publishMainWindowCollection,
  publishLoading: publishMainWindowLoading,
  publishError: publishMainWindowSourceError,
  fatal(message): never {
    console.error(`[fatal library protocol] ${message}`);
    app.exit(1);
    throw new Error(message);
  },
  setAcknowledgementTimer: (callback, timeoutMs) =>
    setTimeout(callback, timeoutMs),
  clearAcknowledgementTimer: (timer) =>
    clearTimeout(timer as ReturnType<typeof setTimeout>)
});

function isOpenSourceRequest(value: unknown): value is OpenSourceRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<OpenSourceRequest>;
  if (request.kind === "pick-directory") return true;
  return request.kind === "location" && typeof request.location === "string";
}

async function chooseDirectory(
  parentWindow?: BrowserWindow | null
): Promise<string | null> {
  if (dialogResponses) {
    const nextResponse = dialogResponses.shift();
    return nextResponse === undefined ? null : nextResponse;
  }

  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory"]
  };
  const window =
    parentWindow && !parentWindow.isDestroyed()
      ? parentWindow
      : BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  return result.canceled || result.filePaths.length === 0
    ? null
    : result.filePaths[0];
}

async function openSourceForWindow(
  request: OpenSourceRequest,
  window?: BrowserWindow | null
): Promise<boolean> {
  return request.kind === "pick-directory"
    ? mediaLibrary.openPickedLocation(() => chooseDirectory(window))
    : mediaLibrary.openLocation(request.location);
}

export async function openSource(
  request: OpenSourceRequest
): Promise<boolean> {
  return openSourceForWindow(request);
}

export async function refreshSource(): Promise<boolean> {
  return mediaLibrary.refresh();
}

export async function openSourceOrigin(sourceId: string): Promise<boolean> {
  const url = mediaLibrary.originUrl(sourceId);
  if (!url) return false;
  await shell.openExternal(url);
  return true;
}

export async function openFileAsCollection(
  filePath: string,
  baseDirectory = process.cwd()
): Promise<boolean> {
  return mediaLibrary.openLocation(path.resolve(baseDirectory, filePath));
}

export function resolveMediaId(
  mediaId: string
): RegisteredMediaItem | null {
  return mediaLibrary.resolveMediaId(mediaId);
}

export function resolveMediaUrl(url: string): MediaResource | null {
  return mediaLibrary.resolveMediaUrl(url);
}

export async function getRecentFolders(): Promise<RecentFolder[]> {
  return getStoredRecentFolders();
}

export async function removeRecentFolder(
  folderPath: string
): Promise<RecentFolder[]> {
  return removeStoredRecentFolder(folderPath);
}

ipcMain.on("source:open", (event, request: unknown) => {
  if (!isOpenSourceRequest(request)) return;
  void openSourceForWindow(
    request,
    BrowserWindow.fromWebContents(event.sender)
  );
});

ipcMain.on("source:refresh", () => {
  void refreshSource();
});

ipcMain.handle("source:open-origin", (_event, sourceId: unknown) => {
  return typeof sourceId === "string" ? openSourceOrigin(sourceId) : false;
});

ipcMain.on("library:renderer-stable", (event) => {
  if (!isMainWindow(BrowserWindow.fromWebContents(event.sender))) return;
  mediaLibrary.acknowledgeRenderer();
});

ipcMain.handle("recent-folders:get", () => getRecentFolders());
ipcMain.handle("recent-folders:remove", (_event, folderPath: string) =>
  removeRecentFolder(folderPath)
);
