import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import type { AddSourceResult, OpenSourceRequest } from "../../shared/media";
import type { RecentSource } from "../../shared/recentSources";
import { parseDialogResponses } from "../app";
import { getSettings } from "../settings";
import {
  getRecentSources as getStoredRecentSources,
  removeRecentSource as removeStoredRecentSource,
  saveRecentSource
} from "../stores";
import {
  isMainWindow,
  publishMainWindowCollection,
  publishMainWindowLoading,
  publishMainWindowRecentSources,
  publishMainWindowSourceError
} from "../windows";
import { MediaLibrary } from "./mediaLibrary";
import type { RegisteredMediaItem } from "./mediaRegistry";
import {
  createProviderRegistry,
  type MediaResource
} from "./providers";
import { openExHentaiSignIn } from "./providers/exHentai/auth";

let dialogResponses = parseDialogResponses();

const mediaLibrary = new MediaLibrary({
  providers: createProviderRegistry(),
  getSettings,
  remember: async (source) => {
    const sources = await saveRecentSource(source);
    publishMainWindowRecentSources(sources);
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

// Electron dialogs open in Downloads unless given a defaultPath, so the picker
// reopens where the last chosen folder lives, as the OS dialogs used to.
let pickerStartDirectory: string | undefined;

async function chooseDirectory(
  parentWindow?: BrowserWindow | null
): Promise<string | null> {
  if (dialogResponses) {
    const nextResponse = dialogResponses.shift();
    return nextResponse === undefined ? null : nextResponse;
  }

  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory"],
    defaultPath: pickerStartDirectory
  };
  const window =
    parentWindow && !parentWindow.isDestroyed()
      ? parentWindow
      : BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) return null;
  pickerStartDirectory = path.dirname(result.filePaths[0]);
  return result.filePaths[0];
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

async function addSourceForWindow(
  request: OpenSourceRequest,
  window?: BrowserWindow | null
): Promise<AddSourceResult> {
  return request.kind === "pick-directory"
    ? mediaLibrary.addPickedLocation(() => chooseDirectory(window))
    : mediaLibrary.addLocation(request.location);
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

export function canDownloadCollection(): boolean {
  return mediaLibrary.canDownloadCollection();
}

export function resolveMediaId(
  mediaId: string
): RegisteredMediaItem | null {
  return mediaLibrary.resolveMediaId(mediaId);
}

export function resolveMediaUrl(url: string): MediaResource | null {
  return mediaLibrary.resolveMediaUrl(url);
}

export async function getRecentSources(): Promise<RecentSource[]> {
  return getStoredRecentSources();
}

export async function removeRecentSource(
  location: string
): Promise<RecentSource[]> {
  return removeStoredRecentSource(location);
}

ipcMain.on("source:open", (event, request: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!isMainWindow(window) || !isOpenSourceRequest(request)) return;
  void openSourceForWindow(request, window);
});

ipcMain.handle("source:add", async (event, request: unknown): Promise<AddSourceResult> => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!isMainWindow(window) || !isOpenSourceRequest(request)) return "not-added";
  return addSourceForWindow(request, window);
});

ipcMain.on("source:remove", (event, memberId: unknown) => {
  if (!isMainWindow(BrowserWindow.fromWebContents(event.sender))) return;
  if (typeof memberId === "string") void mediaLibrary.removeSource(memberId);
});

ipcMain.on("library:select-media", (event, mediaId: unknown) => {
  if (!isMainWindow(BrowserWindow.fromWebContents(event.sender))) return;
  if (mediaId === null || typeof mediaId === "string") mediaLibrary.selectMedia(mediaId);
});

ipcMain.on("source:refresh", (event) => {
  if (!isMainWindow(BrowserWindow.fromWebContents(event.sender))) return;
  void refreshSource();
});

ipcMain.handle("source:open-origin", (_event, sourceId: unknown) => {
  return typeof sourceId === "string" ? openSourceOrigin(sourceId) : false;
});

ipcMain.handle("exhentai:sign-in", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return isMainWindow(window) ? openExHentaiSignIn(window) : false;
});

ipcMain.on("library:renderer-stable", (event) => {
  if (!isMainWindow(BrowserWindow.fromWebContents(event.sender))) return;
  mediaLibrary.acknowledgeRenderer();
});

ipcMain.handle("recent-sources:get", () => getRecentSources());
ipcMain.handle("recent-sources:remove", (_event, location: unknown) =>
  typeof location === "string"
    ? removeRecentSource(location)
    : getRecentSources()
);
