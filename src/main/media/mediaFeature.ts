import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { resolveMediaId, resolveMediaUrl } from "../library";
import {
  showLocalMediaContextMenu,
  showRemoteMediaContextMenu
} from "./mediaContextMenu";
import type { RequestPriority } from "../requestBroker";

function priorityFor(request: Request): RequestPriority {
  const url = new URL(request.url);
  if (url.hostname === "thumbnail") return "normal";
  return url.searchParams.get("intent") === "prefetch" ? "low" : "high";
}

async function createMediaResponse(request: Request): Promise<Response> {
  const resource = resolveMediaUrl(request.url);
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
    showRemoteMediaContextMenu(window, item.externalUrl);
    return true;
  }
  return false;
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
}

function registerMediaProtocolHandler(): void {
  protocol.handle("pixvitta-media", createMediaResponse);
}

registerMediaProtocolScheme();
registerMediaIpcHandler();
void app.whenReady().then(registerMediaProtocolHandler);
