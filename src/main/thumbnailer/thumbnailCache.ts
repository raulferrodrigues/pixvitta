import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/*
 * Thumbnailer work is intentionally centralized in the main process. It is
 * CPU and disk heavy, uses Electron nativeImage, and writes cache files under
 * userData. The renderer asks for pixvitta-thumb:// URLs; this cache decides
 * whether that URL can be served from disk, needs generation, or is unavailable.
 */

// Bump this when the cache file format or generation strategy changes. Old
// thumbnails then live under a different directory and stop being reused.
export const THUMBNAIL_CACHE_VERSION = "v3";
export const THUMBNAIL_SIZE_PX = 512;
export const THUMBNAIL_JPEG_QUALITY = 90;
export const THUMBNAIL_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
export const THUMBNAIL_CACHE_TARGET_BYTES = 900 * 1024 * 1024;

// Thumbnailing many large images at once can make the app feel hung. A tiny
// queue keeps the UI responsive while still letting a couple of thumbnails build
// in parallel.
const DEFAULT_THUMBNAIL_CONCURRENCY = 2;
const DEFAULT_PRUNE_DELAY_MS = 30_000;

type ThumbnailSize = {
  width: number;
  height: number;
};

type GeneratedThumbnail = {
  isEmpty(): boolean;
  toJPEG(quality: number): Buffer;
};

export type CreateThumbnail = (filePath: string, size: ThumbnailSize) => Promise<GeneratedThumbnail>;

export type ThumbnailCacheStats = {
  fileCount: number;
  totalBytes: number;
};

type ThumbnailCacheOptions = {
  cacheDir: string;
  createThumbnail: CreateThumbnail;
  thumbnailSizePx?: number;
  jpegQuality?: number;
  maxBytes?: number;
  targetBytes?: number;
  concurrency?: number;
  pruneDelayMs?: number;
  debug?: boolean;
};

type QueueEntry<T> = {
  run(): Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

// A minimal async work queue. It exists so thumbnail generation does not spawn
// unbounded nativeImage work when the filmstrip requests many thumbnails at once.
class AsyncQueue {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private readonly idleResolvers: Array<() => void> = [];
  private activeCount = 0;
  private isClosed = false;

  constructor(private readonly concurrency: number) {}

  // Add returns the eventual result of the queued job. Callers do not need to
  // know whether their work starts immediately or waits behind older requests.
  add<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.isClosed) {
        reject(new Error("Thumbnail queue is closed."));
        return;
      }
      this.queue.push({ run, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  // Closing rejects jobs that never started. Active jobs are allowed to finish,
  // which is important during app quit because they may be midway through a file
  // write.
  close(): void {
    this.isClosed = true;
    while (this.queue.length > 0) {
      this.queue.shift()?.reject(new Error("Thumbnail queue is closed."));
    }
    this.notifyIdle();
  }

  // dispose() waits on this so app quit can pause briefly for in-flight thumbnail
  // writes instead of tearing the process down instantly.
  onIdle(): Promise<void> {
    if (this.activeCount === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  // Start as much queued work as the concurrency limit allows. Each completion
  // recursively drains the next queued item.
  private drain(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.activeCount += 1;
      void entry
        .run()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
          this.notifyIdle();
        });
    }
  }

  // Resolve every waiter exactly once when the queue becomes completely empty.
  private notifyIdle(): void {
    if (this.activeCount > 0 || this.queue.length > 0) return;
    while (this.idleResolvers.length > 0) {
      this.idleResolvers.shift()?.();
    }
  }
}

// A cache key must change when the source file changes or when thumbnail output
// settings change. Including the path keeps two different files with identical
// size/mtime from sharing a thumbnail.
function cacheKeyFor(filePath: string, sizeBytes: number, modifiedMs: number, thumbnailSizePx: number, jpegQuality: number): string {
  return createHash("sha256")
    .update(THUMBNAIL_CACHE_VERSION)
    .update("\0")
    .update(filePath)
    .update("\0")
    .update(String(sizeBytes))
    .update("\0")
    .update(String(Math.round(modifiedMs)))
    .update("\0")
    .update(String(thumbnailSizePx))
    .update("\0")
    .update(String(jpegQuality))
    .digest("hex");
}

// Missing files are normal here: the whole point of the cache is to check
// whether a thumbnail has already been generated.
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export class ThumbnailCache {
  private readonly createThumbnail: CreateThumbnail;
  private readonly thumbnailSizePx: number;
  private readonly jpegQuality: number;
  private readonly maxBytes: number;
  private readonly targetBytes: number;
  private readonly pruneDelayMs: number;
  private readonly queue: AsyncQueue;
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private pruneTimer: NodeJS.Timeout | null = null;
  private isPruning = false;

  constructor(private readonly options: ThumbnailCacheOptions) {
    // The constructor normalizes all tunable values once, so the hot path can
    // avoid repeating defaulting logic for every thumbnail request.
    this.createThumbnail = options.createThumbnail;
    this.thumbnailSizePx = options.thumbnailSizePx ?? THUMBNAIL_SIZE_PX;
    this.jpegQuality = options.jpegQuality ?? THUMBNAIL_JPEG_QUALITY;
    this.maxBytes = options.maxBytes ?? THUMBNAIL_CACHE_MAX_BYTES;
    this.targetBytes = Math.min(options.targetBytes ?? THUMBNAIL_CACHE_TARGET_BYTES, this.maxBytes);
    this.pruneDelayMs = options.pruneDelayMs ?? DEFAULT_PRUNE_DELAY_MS;
    this.queue = new AsyncQueue(Math.max(1, options.concurrency ?? DEFAULT_THUMBNAIL_CONCURRENCY));
  }

  // Debug logging is intentionally opt-in because thumbnail requests happen a
  // lot while scrolling the filmstrip.
  private debug(message: string, details?: unknown): void {
    if (!this.options.debug) return;
    if (details === undefined) {
      console.info(`[thumbnail-cache] ${message}`);
      return;
    }
    console.info(`[thumbnail-cache] ${message}`, details);
  }

  // The path calculation stats the source file first so the cache key reflects
  // its current size and modified time. Edited files naturally point at new
  // cached JPEG names.
  private async getCachedPathForSource(filePath: string): Promise<string> {
    const details = await stat(filePath);
    const key = cacheKeyFor(filePath, details.size, details.mtimeMs, this.thumbnailSizePx, this.jpegQuality);
    return path.join(this.options.cacheDir, `${key}.jpg`);
  }

  // Some callers, especially WebM handling, only want an already-existing
  // thumbnail and should not kick off main-process generation.
  async getCachedThumbnailPath(filePath: string): Promise<string | null> {
    const cachedPath = await this.getCachedPathForSource(filePath);

    if (!(await fileExists(cachedPath))) return null;

    // Touch the file on access so pruning can behave like an LRU cache.
    this.debug("cache hit", { filePath, cachedPath });
    const now = new Date();
    void utimes(cachedPath, now, now).catch(() => undefined);
    return cachedPath;
  }

  // This is the main cache lookup. It returns an existing thumbnail, joins an
  // identical in-flight generation task, or queues a new generation job.
  async getThumbnailPath(filePath: string): Promise<string | null> {
    const cachedPath = await this.getCachedPathForSource(filePath);

    if (await fileExists(cachedPath)) {
      this.debug("cache hit", { filePath, cachedPath });
      const now = new Date();
      void utimes(cachedPath, now, now).catch(() => undefined);
      return cachedPath;
    }

    const inFlight = this.inFlight.get(cachedPath);
    if (inFlight) {
      this.debug("joining in-flight thumbnail", { filePath, cachedPath });
      return inFlight;
    }

    // inFlight deduplicates concurrent requests for the same cache path. Without
    // it, a fast-scrolling filmstrip could generate the same JPEG several times.
    const task = this.queue
      .add(() => this.generateThumbnail(filePath, cachedPath))
      .finally(() => {
        this.inFlight.delete(cachedPath);
      });
    this.inFlight.set(cachedPath, task);
    return task;
  }

  // Renderer-captured media frames enter the same cache through this method. The
  // caller has already validated the buffer shape, and this method handles the
  // filesystem write using the same atomic pattern as generated thumbnails.
  async writeThumbnail(filePath: string, jpeg: Buffer): Promise<string | null> {
    if (jpeg.length === 0) return null;

    const cachedPath = await this.getCachedPathForSource(filePath);
    if (await fileExists(cachedPath)) return cachedPath;

    this.debug("writing external thumbnail", { filePath, cachedPath, sizeBytes: jpeg.length });
    await mkdir(this.options.cacheDir, { recursive: true });
    const tempPath = `${cachedPath}.${process.pid}.${process.hrtime.bigint()}.tmp`;
    try {
      await writeFile(tempPath, jpeg);
      // Rename is effectively atomic on the same filesystem. Readers either see
      // the old missing file or the complete JPEG, never a half-written file.
      await rename(tempPath, cachedPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    this.schedulePrune();
    return cachedPath;
  }

  async getStats(): Promise<ThumbnailCacheStats> {
    const entries = await readdir(this.options.cacheDir, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jpg"))
        .map((entry) => stat(path.join(this.options.cacheDir, entry.name)))
    );
    return {
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0)
    };
  }

  async clearCache(): Promise<void> {
    if (this.pruneTimer) {
      clearTimeout(this.pruneTimer);
      this.pruneTimer = null;
    }
    await this.queue.onIdle();
    await rm(this.options.cacheDir, { recursive: true, force: true });
    await mkdir(this.options.cacheDir, { recursive: true });
    this.debug("cache cleared");
  }

  // Pruning keeps the cache bounded. It removes the oldest touched files until
  // the cache drops below targetBytes, leaving recently viewed thumbnails alone.
  async pruneCache(): Promise<void> {
    if (this.isPruning) return;
    this.isPruning = true;
    try {
      const entries = await readdir(this.options.cacheDir, { withFileTypes: true }).catch(() => []);
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jpg"))
          .map(async (entry) => {
            const filePath = path.join(this.options.cacheDir, entry.name);
            const details = await stat(filePath);
            return {
              filePath,
              sizeBytes: details.size,
              modifiedMs: details.mtimeMs
            };
          })
      );

      let totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
      if (totalBytes <= this.maxBytes) return;

      files.sort((a, b) => a.modifiedMs - b.modifiedMs);
      for (const file of files) {
        if (totalBytes <= this.targetBytes) break;
        await rm(file.filePath, { force: true });
        totalBytes -= file.sizeBytes;
      }
    } finally {
      this.isPruning = false;
    }
  }

  // Called during app quit. It stops new work, waits for active work to settle,
  // and caps that wait so a stuck thumbnail cannot block quitting forever.
  async dispose(timeoutMs = 5_000): Promise<void> {
    if (this.pruneTimer) {
      clearTimeout(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.queue.close();
    await Promise.race([
      this.queue.onIdle(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      })
    ]);
  }

  // Generate a JPEG thumbnail and commit it to the cache. Empty images are
  // treated as a miss so the protocol handler can fall back or return 404.
  private async generateThumbnail(filePath: string, cachedPath: string): Promise<string | null> {
    if (await fileExists(cachedPath)) return cachedPath;

    this.debug("generating thumbnail", { filePath, cachedPath });
    await mkdir(this.options.cacheDir, { recursive: true });
    const image = await this.createThumbnail(filePath, {
      width: this.thumbnailSizePx,
      height: this.thumbnailSizePx
    });
    if (image.isEmpty()) {
      this.debug("thumbnail generation returned an empty image", { filePath });
      return null;
    }

    const jpeg = image.toJPEG(this.jpegQuality);
    if (jpeg.length === 0) {
      this.debug("thumbnail jpeg encoding returned an empty buffer", { filePath });
      return null;
    }

    const tempPath = `${cachedPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, jpeg);
      // As above, write to a temp file first so protocol responses never stream
      // a partially written JPEG.
      await rename(tempPath, cachedPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    this.schedulePrune();
    this.debug("thumbnail cached", { filePath, cachedPath, sizeBytes: jpeg.length });
    return cachedPath;
  }

  // Pruning is delayed and coalesced because many thumbnails may be generated in
  // a burst. One timer after the burst is cheaper than scanning the cache after
  // every single JPEG write.
  private schedulePrune(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setTimeout(() => {
      this.pruneTimer = null;
      void this.pruneCache().catch((error) => console.error(error));
    }, this.pruneDelayMs);
    this.pruneTimer.unref?.();
  }
}

// The thumbnail protocol serves cached JPEGs with long immutable caching. The
// URL itself contains the revision, so if the source changes the renderer will
// request a different URL instead of needing to revalidate this one.
export async function createThumbnailFileResponse(filePath: string): Promise<Response> {
  const details = await stat(filePath);
  return new Response(Readable.toWeb(createReadStream(filePath)) as BodyInit, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(details.size),
      "Content-Type": "image/jpeg"
    }
  });
}
