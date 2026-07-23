import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import type {
  MediaCollection,
  OpenSourceRequest,
  OpenSourceResult
} from "../../shared/media";
import type { RecentFolder } from "../../shared/recentFolders";
import { parseDialogResponses } from "../app";
import { activateProviderCollection } from "../media";
import { getSettings } from "../settings";
import {
  getRecentFolders as getStoredRecentFolders,
  removeRecentFolder as removeStoredRecentFolder,
  saveRecentFolder
} from "../stores";
import { MediaLibrary } from "./mediaLibrary";
import { createProviderRegistry, ProviderError } from "./providers";

let dialogResponses = parseDialogResponses();

const mediaLibrary = new MediaLibrary({
  providers: createProviderRegistry(),
  getSettings,
  activate: activateProviderCollection,
  remember: async (location) => {
    await saveRecentFolder(location);
  }
});

function isOpenSourceRequest(value: unknown): value is OpenSourceRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<OpenSourceRequest>;
  if (request.kind === "pick-directory") return true;
  return request.kind === "location" && typeof request.location === "string";
}

async function chooseDirectory(parentWindow?: BrowserWindow | null): Promise<string | null> {
  if (dialogResponses) {
    const nextResponse = dialogResponses.shift();
    return nextResponse === undefined ? null : nextResponse;
  }

  const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
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

function sourceErrorResult(error: unknown): OpenSourceResult {
  if (error instanceof ProviderError) return { ok: false, error: error.code };
  console.error(error);
  return { ok: false, error: "unavailable" };
}

async function openSourceForWindow(
  request: OpenSourceRequest,
  window?: BrowserWindow | null
): Promise<OpenSourceResult> {
  const libraryRequest = mediaLibrary.beginRequest();
  try {
    const location =
      request.kind === "pick-directory"
        ? await chooseDirectory(window)
        : request.location;
    if (location === null) return { ok: true, collection: null };

    return {
      ok: true,
      collection: await libraryRequest.openLocation(location)
    };
  } catch (error) {
    return sourceErrorResult(error);
  }
}

export async function openSource(
  request: OpenSourceRequest
): Promise<OpenSourceResult> {
  return openSourceForWindow(request);
}

export async function refreshSource(sourceId: string): Promise<OpenSourceResult> {
  const libraryRequest = mediaLibrary.beginRequest();
  try {
    return {
      ok: true,
      collection: await libraryRequest.refresh(sourceId)
    };
  } catch (error) {
    return sourceErrorResult(error);
  }
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
): Promise<MediaCollection | null> {
  const libraryRequest = mediaLibrary.beginRequest();
  try {
    return await libraryRequest.openLocation(
      path.resolve(baseDirectory, filePath)
    );
  } catch (error) {
    if (
      error instanceof ProviderError &&
      (error.code === "unsupported-location" || error.code === "not-found")
    ) {
      return null;
    }
    console.error(error);
    return null;
  }
}

export async function getRecentFolders(): Promise<RecentFolder[]> {
  return getStoredRecentFolders();
}

export async function removeRecentFolder(folderPath: string): Promise<RecentFolder[]> {
  return removeStoredRecentFolder(folderPath);
}

ipcMain.handle("source:open", (event, request: unknown) => {
  if (!isOpenSourceRequest(request)) {
    return { ok: false, error: "invalid-location" } satisfies OpenSourceResult;
  }
  return openSourceForWindow(
    request,
    BrowserWindow.fromWebContents(event.sender)
  );
});

ipcMain.handle("source:refresh", (_event, sourceId: unknown) => {
  if (typeof sourceId !== "string") {
    return { ok: false, error: "invalid-location" } satisfies OpenSourceResult;
  }
  return refreshSource(sourceId);
});

ipcMain.handle("source:open-origin", (_event, sourceId: unknown) => {
  return typeof sourceId === "string" ? openSourceOrigin(sourceId) : false;
});

ipcMain.handle("recent-folders:get", () => getRecentFolders());
ipcMain.handle("recent-folders:remove", (_event, folderPath: string) =>
  removeRecentFolder(folderPath)
);
