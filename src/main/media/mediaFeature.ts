import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { resolveMediaId, resolveMediaUrl } from "../library";
import {
  showLocalMediaContextMenu,
  showRemoteMediaContextMenu
} from "./mediaContextMenu";
import type { RequestPriority } from "../requestBroker";
import { publishMainWindowDownloadActivity } from "../windows";
import { DownloadManager } from "./downloadManager";

const downloadManager = new DownloadManager({
  downloadsDirectory: () =>
    process.env.PIXVITTA_TEST_DOWNLOADS_PATH ?? app.getPath("downloads"),
  publish: publishMainWindowDownloadActivity
});

function priorityFor(request: Request): RequestPriority {
  const url = new URL(request.url);
  if (url.hostname === "thumbnail") return "normal";
  return url.searchParams.get("intent") === "prefetch" ? "normal" : "high";
}

async function createMediaResponse(request: Request): Promise<Response> {
  const resource =
    resolveMediaUrl(request.url) ??
    downloadManager.resolveRetainedUrl(request.url);
  if (!resource) return new Response(null, { status: 404 });

  try {
    return await resource.respond(request, priorityFor(request));
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }
}

function showMediaContextMenu(window: BrowserWindow, mediaId: unknown): boolean {
  if (typeof mediaId !== "string") return false;

  const item = resolveMediaId(mediaId);
  if (!item) return false;
  if (item.localPath) {
    showLocalMediaContextMenu(window, item.localPath);
    return true;
  }
  if (item.externalUrl) {
    showRemoteMediaContextMenu(window, item.externalUrl, () => {
      if (!downloadManager.start(item)) {
        throw new Error("Pixvitta could not start this download.");
      }
    });
    return true;
  }
  return false;
}

function downloadMedia(mediaId: unknown): boolean {
  if (typeof mediaId !== "string") return false;
  const item = resolveMediaId(mediaId);
  return item ? downloadManager.start(item) : false;
}

function downloadCollection(
  collectionName: unknown,
  mediaIds: unknown
): boolean {
  if (
    typeof collectionName !== "string" ||
    !collectionName.trim() ||
    !Array.isArray(mediaIds) ||
    mediaIds.length === 0
  ) {
    return false;
  }
  const items = mediaIds.flatMap((mediaId) => {
    if (typeof mediaId !== "string") return [];
    const item = resolveMediaId(mediaId);
    return item ? [item] : [];
  });
  return downloadManager.startCollection(collectionName, items);
}

function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pixvitta-media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

function registerMediaIpcHandler(): void {
  ipcMain.handle("media:show-context-menu", (event, mediaId: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? showMediaContextMenu(window, mediaId) : false;
  });
  ipcMain.handle("media:download", (event, mediaId: unknown) => {
    void event;
    return downloadMedia(mediaId);
  });
  ipcMain.handle(
    "media:download-collection",
    (event, collectionName: unknown, mediaIds: unknown) => {
      void event;
      return downloadCollection(collectionName, mediaIds);
    }
  );
  ipcMain.handle("media:get-download-activity", (event) => {
    void event;
    return downloadManager.getSnapshot();
  });
}

function registerMediaProtocolHandler(): void {
  protocol.handle("pixvitta-media", createMediaResponse);
}

registerMediaProtocolScheme();
registerMediaIpcHandler();
void app.whenReady().then(registerMediaProtocolHandler);
