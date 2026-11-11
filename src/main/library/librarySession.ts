import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import type { AddSourceRequest, AddSourceResult, OpenSourceRequest } from "../../shared/media";
import { isRecentMix, type RecentEntry, type RecentMix } from "../../shared/recentSources";
import { parseDialogResponses } from "../app";
import { getSettings } from "../settings";
import {
  getRecentSources as getStoredRecentSources,
  getSavedMix,
  pinSavedMix,
  removeRecentSource as removeStoredRecentSource,
  removeSavedMix,
  renameSavedMix,
  saveMix,
  saveRecentSource
} from "../stores";
import {
  isMainWindow,
  publishMainWindowCollection,
  publishMainWindowLoading,
  publishMainWindowRecentSources,
  publishMainWindowReplaceConfirmation,
  publishMainWindowSavedMixRename,
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
    publishMainWindowRecentSources(await saveRecentSource(source));
  },
  saveMix: async (mix) => {
    publishMainWindowRecentSources(await saveMix(mix));
  },
  savedMix: getSavedMix,
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

function isAddSourceRequest(value: unknown): value is AddSourceRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<AddSourceRequest>;
  if (request.kind === "pick-directory") return true;
  return request.kind === "location" && typeof request.location === "string";
}

function isOpenSourceRequest(value: unknown): value is OpenSourceRequest {
  if (isAddSourceRequest(value)) return true;
  const request = value as Partial<OpenSourceRequest> | null;
  return request?.kind === "saved-mix" && typeof request.id === "string";
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
  if (request.kind === "saved-mix") return mediaLibrary.openSavedMix(request.id);
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
  request: AddSourceRequest,
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

export async function getRecentSources(): Promise<RecentEntry[]> {
  return getStoredRecentSources();
}

export async function removeRecentSource(
  location: string
): Promise<RecentEntry[]> {
  return removeStoredRecentSource(location);
}

// A saved mix's native menu: pin or unpin, rename once pinned, and remove.
// Main carries out what it can and publishes the list; renaming needs a text
// field, so main asks the renderer to show one.
async function showSavedMixMenu(
  window: BrowserWindow,
  id: string,
  position: { x: number; y: number } | null
): Promise<void> {
  const mix = (await getStoredRecentSources()).find(
    (entry): entry is RecentMix => isRecentMix(entry) && entry.id === id
  );
  if (!mix || window.isDestroyed()) return;
  const publishAfter = (change: Promise<RecentEntry[]>) => {
    void change.then(publishMainWindowRecentSources, (error: unknown) => {
      console.error("Could not change the saved mix.", error);
    });
  };
  Menu.buildFromTemplate([
    {
      label: mix.pinned ? "Unpin" : "Pin",
      click: () => publishAfter(pinSavedMix(id, !mix.pinned))
    },
    {
      label: "Rename…",
      enabled: mix.pinned,
      click: () => publishMainWindowSavedMixRename(id)
    },
    { type: "separator" },
    {
      label: "Remove from Recents",
      click: () => publishAfter(removeSavedMix(id))
    }
  ]).popup({
    window,
    ...(position ? { x: Math.round(position.x), y: Math.round(position.y) } : {})
  });
}

function isMenuPosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

// Opening from inside the app asks before it replaces a mix, and goes ahead
// only once the request comes back confirmed. Opens from the operating system
// do not come through here and replace without asking.
ipcMain.on("source:open", (event, request: unknown, options: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!isMainWindow(window) || !isOpenSourceRequest(request)) return;
  const confirmed =
    typeof options === "object" &&
    options !== null &&
    (options as { replaceConfirmed?: unknown }).replaceConfirmed === true;
  const replaces = confirmed ? null : mediaLibrary.replaceConfirmation();
  if (replaces) {
    publishMainWindowReplaceConfirmation({ request, ...replaces });
    return;
  }
  void openSourceForWindow(request, window);
});

ipcMain.handle("source:add", async (event, request: unknown): Promise<AddSourceResult> => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!isMainWindow(window) || !isAddSourceRequest(request)) return "not-added";
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
ipcMain.handle("saved-mixes:remove", (event, id: unknown) => {
  void event;
  return typeof id === "string" ? removeSavedMix(id) : getRecentSources();
});
ipcMain.handle("saved-mixes:pin", (event, id: unknown, pinned: unknown) => {
  void event;
  return typeof id === "string" && typeof pinned === "boolean"
    ? pinSavedMix(id, pinned)
    : getRecentSources();
});
ipcMain.handle("saved-mixes:rename", (event, id: unknown, name: unknown) => {
  void event;
  return typeof id === "string" && typeof name === "string"
    ? renameSavedMix(id, name)
    : getRecentSources();
});
ipcMain.on("saved-mixes:show-menu", (event, id: unknown, position: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !isMainWindow(window) || typeof id !== "string") return;
  void showSavedMixMenu(window, id, isMenuPosition(position) ? position : null);
});
