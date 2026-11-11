import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import type { AccountState } from "../../shared/accounts";
import type { OpenSourceRequest } from "../../shared/media";
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
  publishMainWindowAccounts,
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

let dialogResponses = parseDialogResponses();

const providers = createProviderRegistry();

const mediaLibrary = new MediaLibrary({
  providers,
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

// Sign-ins in progress. A second request, from Settings or a source error,
// focuses the open sign-in and shares its result.
const signingIn = new Map<string, Promise<boolean>>();
let accountsRevision = 0;

async function getAccounts(): Promise<AccountState[]> {
  return Promise.all(providers.accounts().map(async (account) => ({
    id: account.id,
    label: account.label,
    description: account.description,
    status: signingIn.has(account.id)
      ? "signing-in"
      : await account.isSignedIn() ? "signed-in" : "signed-out"
  })));
}

// Statuses are read asynchronously, so a slower, older read must not be
// published over a newer one.
async function publishAccounts(): Promise<void> {
  const revision = ++accountsRevision;
  const accounts = await getAccounts();
  if (revision === accountsRevision) publishMainWindowAccounts(accounts);
}

function signIn(accountId: string, window: BrowserWindow): Promise<boolean> {
  const account = providers.account(accountId);
  if (!account) return Promise.resolve(false);
  const running = signingIn.get(accountId);
  if (running) {
    account.focusSignIn();
    return running;
  }
  const signingInAccount = (async () => {
    try {
      return await account.signIn(window);
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      signingIn.delete(accountId);
      await publishAccounts();
    }
  })();
  signingIn.set(accountId, signingInAccount);
  void publishAccounts();
  return signingInAccount;
}

async function signOut(accountId: string): Promise<void> {
  const account = providers.account(accountId);
  if (!account) return;
  try {
    await account.signOut();
  } finally {
    await publishAccounts();
  }
}

ipcMain.handle("accounts:get", () => getAccounts());
ipcMain.handle("accounts:sign-in", (event, accountId: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !isMainWindow(window) || typeof accountId !== "string") return false;
  return signIn(accountId, window);
});
ipcMain.handle("accounts:sign-out", (event, accountId: unknown) => {
  if (!isMainWindow(BrowserWindow.fromWebContents(event.sender)) || typeof accountId !== "string") return;
  return signOut(accountId);
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
