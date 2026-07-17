import { app, BrowserWindow, ipcMain, protocol } from "electron";
import path from "node:path";
import type { Folder, MediaItem } from "../../shared/media";
import { isSupportedMediaPath } from "../utils/mediaTypes";
import { showNativeMediaContextMenu } from "./mediaContextMenu";
import { MediaRegistry } from "./mediaRegistry";
import { createMediaFileResponse } from "./mediaResponses";
import {
  scanFolder as scanMediaFolder,
  type FolderScanResult as MediaFileScanResult,
  type MediaFileRecord,
  type ScanOptions
} from "./mediaScanner";

/*
 * This file is the public feature boundary for main-process media behavior.
 *
 * The rest of the app should see media as a tiny set of capabilities: open a
 * folder and open a file. The rest of the media machinery is intentionally
 * hidden here: the current
 * ID-to-path registry, protocol serving, media-specific IPC, supported-file
 * checks, and native media menus.
 *
 * A few operations below are registered as import-time side effects. That is
 * deliberate. Electron custom protocol privileges must be registered before
 * app.whenReady(), and the renderer should not need main.ts to manually wire
 * media-specific IPC channels. Importing "./media" means "the media feature is
 * present in this process."
 *
 * The expensive/runtime-sensitive thumbnail work lives behind "../thumbnailer".
 * Media asks for thumbnail URLs while scanning, but thumbnail generation,
 * caching, and thumbnail protocol handling are not part of media's surface.
 */

// The registry is the core hidden state of the media feature. Scanning a folder
// replaces it with the files from the current media set. Later, protocol and IPC
// handlers resolve renderer-visible media IDs back through this registry. No
// renderer-facing API receives real filesystem paths.
const registry = new MediaRegistry();

function toPublicMediaItem(record: MediaFileRecord): MediaItem {
  // Scanner records contain absolutePath so the main process can register and
  // compare real files. The renderer contract must not include it. Stripping it
  // here keeps the "pathful" and "path-free" shapes separated at the media
  // boundary instead of relying on every caller to remember what is safe.
  const { absolutePath: _absolutePath, ...item } = record;
  return item;
}

function toPublicFolder(result: MediaFileScanResult, selectedId = result.items[0]?.id ?? null): Folder {
  // Folder paths are still returned because recent-folder UI and rescans are
  // folder-level app concepts. Individual file paths are not returned; media
  // items are identified by opaque IDs and custom app URLs. The folder also
  // carries the app's current selection so every caller receives one complete
  // domain object rather than a scan plus a separate "opened file" payload.
  const items = result.items.map(toPublicMediaItem);
  return {
    folderPath: result.folderPath,
    items,
    selectedId
  };
}

function normalizeSupportedOpenFilePath(filePath: unknown): string | null {
  // Open-file events and IPC payloads are external input, so treat the value as
  // unknown until checked. Unsupported paths are represented as null and are
  // silently ignored by the caller. That matches the app's current behavior for
  // files Pixvitta cannot view.
  if (typeof filePath !== "string" || filePath.length === 0) return null;

  // Resolve before checking support so the rest of the media pipeline works with
  // one canonical absolute path when comparing a directly opened file to the
  // scanned parent-folder entries.
  const absolutePath = path.resolve(filePath);
  return isSupportedMediaPath(absolutePath) ? absolutePath : null;
}

async function createMediaResponse(request: Request): Promise<Response> {
  // pixvitta-media:// URLs contain opaque media IDs, not real file paths. The
  // registry only resolves IDs from the current scan, so old IDs and invented
  // IDs fail closed with 404.
  const mediaPath = registry.resolveUrl(request.url);
  if (!mediaPath) return new Response(null, { status: 404 });

  try {
    // createMediaFileResponse owns the HTTP-like details: content type, content
    // length, CORS headers, and byte ranges for video seeking.
    return await createMediaFileResponse(mediaPath, request.headers);
  } catch (error) {
    // Protocol handlers should always return a Response rather than throwing
    // through Electron's protocol layer. Log for diagnostics, then give Chromium
    // a normal server-style failure.
    console.error(error);
    return new Response(null, { status: 500 });
  }
}

function showMediaContextMenu(window: BrowserWindow, mediaId: unknown): boolean {
  // The renderer asks for a menu by media ID. The real path is resolved only
  // here, in main, and only if the ID belongs to the current scan.
  if (typeof mediaId !== "string") return false;

  const filePath = registry.resolveId(mediaId);
  if (!filePath) return false;

  // Native menu construction is media-specific UI, so it stays inside this deep
  // module alongside the authorization step that turns a renderer ID into a real
  // file path.
  showNativeMediaContextMenu(window, filePath);
  return true;
}

function registerMediaProtocolSchemes(): void {
  // Electron requires privileged custom protocols to be declared before
  // app.whenReady(). Registering this on module import lets main.ts import the
  // media feature without learning protocol details or lifecycle requirements.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pixvitta-media",
      privileges: {
        // "standard" and "secure" make these URLs behave more like normal web
        // origins in Chromium, which is important when assigning them to
        // img/video src attributes.
        standard: true,
        secure: true,
        // The protocol handlers below return Fetch Response objects. These
        // privileges make fetch-compatible handling, CORS, and streaming media
        // behavior available to the renderer.
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

function registerMediaIpcHandlers(): void {
  // These IPC channels are media-specific, so they are registered by the media
  // feature rather than by the generic ipcHandlers module. That keeps the
  // generic IPC file from needing to know about registry resolution, JPEG
  // validation, or native media menus.
  ipcMain.handle("media:show-context-menu", (event, mediaId: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    return showMediaContextMenu(window, mediaId);
  });
}

function registerMediaProtocolHandlers(): void {
  // The protocol schemes are declared at import time, but handlers can only be
  // attached once Electron is ready. These handlers turn renderer URLs into
  // private filesystem reads through the current registry.
  protocol.handle("pixvitta-media", createMediaResponse);
}

// Importing this module registers the media feature's Electron plumbing. This is
// intentional: main.ts should not need to remember to call a registration
// function for every piece of media infrastructure. The public exports below are
// only the app-level operations other modules need to invoke directly.
registerMediaProtocolSchemes();
registerMediaIpcHandlers();
void app.whenReady().then(registerMediaProtocolHandlers);

export async function openMediaFolder(folderPath: string, options: ScanOptions = {}): Promise<Folder> {
  // Opening a folder is the operation that defines the current media set. The
  // scanner reads the filesystem, filters unsupported files, creates opaque IDs
  // and custom URLs, and returns internal records that still include paths.
  const result = await scanMediaFolder(folderPath, options);

  // Replace the registry as a unit. IDs from any previous folder immediately
  // stop resolving, which prevents stale renderer URLs from reading old files.
  registry.setItems(result.items);

  // Only renderer-safe data crosses the media boundary.
  return toPublicFolder(result);
}

export async function openMediaFile(filePath: unknown, options: ScanOptions = {}): Promise<Folder | null> {
  // Direct file opens come from macOS open-file events and should be treated as
  // external input. Unsupported or malformed values simply do not produce an
  // opened-file payload.
  const absolutePath = normalizeSupportedOpenFilePath(filePath);
  if (!absolutePath) return null;

  // Opening a file in a viewer app should open its parent folder, then select
  // the requested file. Hidden files are included for this scan when the user
  // directly opened that hidden file, even if the normal hidden-files setting is
  // off.
  const result = await scanMediaFolder(path.dirname(absolutePath), {
    ...options,
    includeHidden: options.includeHidden || path.basename(absolutePath).startsWith(".")
  });

  // Compare by internal absolute path before stripping paths from the public
  // result. The renderer receives only selectedId.
  const selectedItem = result.items.find((item) => item.absolutePath === absolutePath);
  if (!selectedItem) return null;

  // The opened file's folder becomes the current media set just like an explicit
  // folder open.
  registry.setItems(result.items);
  return toPublicFolder(result, selectedItem.id);
}
