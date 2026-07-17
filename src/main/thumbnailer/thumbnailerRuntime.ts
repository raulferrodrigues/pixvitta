import { app, ipcMain, nativeImage, protocol } from "electron";
import path from "node:path";
import {
  getMediaFileType,
  isImageMediaPath,
  isVideoMediaPath
} from "../utils/mediaTypes";
import {
  resolveThumbnailReference,
  resolveThumbnailUrl
} from "./thumbnailer";
import {
  createThumbnailFileResponse,
  ThumbnailCache,
  THUMBNAIL_CACHE_VERSION
} from "./thumbnailCache";

/*
 * This runtime is loaded only in Electron. It owns every operational detail
 * behind pixvitta-thumb:// URLs: privileged protocol registration, native
 * thumbnail generation, cache reads and writes, renderer-assisted video frames,
 * response headers, and quit-time queue draining.
 *
 * The important boundary is that none of this is visible to media or main.ts.
 * They ask thumbnailer.ts for a thumbnail URL; Chromium later asks this runtime
 * to make that URL real.
 */

const MAX_RENDERER_THUMBNAIL_BYTES = 5 * 1024 * 1024;

// Images use Chromium so thumbnail decoding matches the viewer on every OS.
// WebM also needs renderer assistance; other videos retain the native fast path
// where Electron exposes it and fall back to renderer capture on a cache miss.
const rendererAssistedThumbnailExtensions = new Set([".webm"]);

let thumbnailCache: ThumbnailCache | null = null;
let isFinishingThumbnailWorkBeforeQuit = false;

function needsRendererThumbnail(filePath: string): boolean {
  const fileType = getMediaFileType(filePath);
  return isImageMediaPath(filePath) || (!!fileType && rendererAssistedThumbnailExtensions.has(fileType.extension));
}

function debugThumbnails(): boolean {
  return process.env.PIXVITTA_DEBUG_THUMBNAILS === "1";
}

function getThumbnailCache(): ThumbnailCache {
  // The cache is lazy because app.getPath("userData") can be redirected by
  // tests before first use. Importing thumbnailer should register behavior, not
  // lock in a storage path too early.
  thumbnailCache ??= new ThumbnailCache({
    cacheDir: path.join(app.getPath("userData"), "thumbnail-cache", THUMBNAIL_CACHE_VERSION),
    createThumbnail: async (filePath, size) => {
      // This API is available on macOS and Windows but absent on Linux. Feature
      // detection keeps non-WebM video thumbnails opportunistic and portable.
      if (typeof nativeImage.createThumbnailFromPath === "function") {
        return nativeImage.createThumbnailFromPath(filePath, size);
      }

      return nativeImage.createEmpty();
    },
    debug: debugThumbnails()
  });
  return thumbnailCache;
}

function decodeRendererJpegDataUrl(dataUrl: string): Buffer | null {
  // Renderer assistance is allowed to provide only a small JPEG data URL. The
  // thumbnailer accepts pixels, not arbitrary files or unbounded byte strings.
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;

  const jpeg = Buffer.from(match[1], "base64");
  if (jpeg.length === 0 || jpeg.length > MAX_RENDERER_THUMBNAIL_BYTES) return null;

  // This magic-byte check is deliberately cheap. It is not a full JPEG parser;
  // it just rejects accidental or malicious non-JPEG buffers before they enter
  // the thumbnail cache.
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
    return null;
  }

  return jpeg;
}

async function makeThumbnailResponse(filePath: string): Promise<Response | null> {
  // One request path handles cache hits, native generation, renderer-assisted
  // waiting, and fallback. Callers do not get to choose the strategy.
  const cache = getThumbnailCache();

  if (needsRendererThumbnail(filePath)) {
    const thumbnailPath = await cache.getCachedThumbnailPath(filePath);
    if (thumbnailPath) return createThumbnailFileResponse(thumbnailPath);

    if (debugThumbnails()) {
      console.info("[thumbnailer] waiting for renderer thumbnail", { filePath });
    }
    return null;
  }

  const thumbnailPath = await cache.getThumbnailPath(filePath);
  if (debugThumbnails()) {
    console.info("[thumbnailer] thumbnail response", {
      filePath,
      thumbnailPath
    });
  }
  if (thumbnailPath) return createThumbnailFileResponse(thumbnailPath);

  return null;
}

async function createThumbnailResponse(request: Request): Promise<Response> {
  // Protocol handlers receive untrusted URL strings from Chromium. Resolve only
  // URLs that thumbnailer previously minted during scanning.
  const file = resolveThumbnailUrl(request.url);
  if (!file) {
    if (debugThumbnails()) console.info("[thumbnailer] unresolved thumbnail url", request.url);
    return new Response(null, { status: 404 });
  }

  try {
    return (await makeThumbnailResponse(file.filePath)) ?? new Response(null, { status: 404 });
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }
}

async function finishThumbnailFromRenderer(reference: unknown, dataUrl: unknown): Promise<boolean> {
  // This IPC endpoint accepts pixels only for files registered by thumbnailer.
  // The renderer never supplies a path or chooses a cache location.
  const file = resolveThumbnailReference(reference);
  if (!file || (!isImageMediaPath(file.filePath) && !isVideoMediaPath(file.filePath)) || typeof dataUrl !== "string") return false;

  const jpeg = decodeRendererJpegDataUrl(dataUrl);
  if (!jpeg) return false;

  try {
    await getThumbnailCache().writeThumbnail(file.filePath, jpeg);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function registerThumbnailProtocolScheme(): void {
  // Electron requires privileged schemes to be declared before app.whenReady().
  // Doing this on module import lets "thumbnailer is present" mean the protocol
  // is ready without a public setup function.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pixvitta-thumb",
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

function registerThumbnailIpcHandlers(): void {
  // The renderer does not know about cache files. It can only send captured
  // image data for a thumbnailer-created reference, and this runtime decides
  // whether that data is useful.
  ipcMain.handle("thumbnail:save-media", (_event, reference: unknown, dataUrl: unknown) => {
    return finishThumbnailFromRenderer(reference, dataUrl);
  });
}

function registerThumbnailProtocolHandler(): void {
  protocol.handle("pixvitta-thumb", createThumbnailResponse);
}

function registerThumbnailQuitHandler(): void {
  // Thumbnail writes can still be active when the app quits. The thumbnailer
  // owns that queue, so it also owns the short quit delay needed to finish or
  // close it cleanly.
  app.on("before-quit", (event) => {
    if (isFinishingThumbnailWorkBeforeQuit || !thumbnailCache) return;

    event.preventDefault();
    isFinishingThumbnailWorkBeforeQuit = true;
    void thumbnailCache
      .dispose()
      .catch((error) => console.error(error))
      .finally(() => app.quit());
  });
}

registerThumbnailProtocolScheme();
registerThumbnailIpcHandlers();
registerThumbnailQuitHandler();
void app.whenReady().then(registerThumbnailProtocolHandler);
