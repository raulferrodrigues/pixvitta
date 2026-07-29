import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { CachedFile } from "./types";

type CacheMetadata = {
  contentType: string;
  byteLength: number;
};

type EntryPaths = {
  directory: string;
  file: string;
  metadata: string;
};

function cacheRoot(): string {
  return path.join(app.getPath("userData"), "resource-cache", "v1");
}

const preparation = app.whenReady().then(async () => {
  const root = cacheRoot();
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(path.join(app.getPath("userData"), "media-cache"), {
      recursive: true,
      force: true
    })
  ]);
  await mkdir(root, { recursive: true });
});

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function validateCacheKey(cacheKey: string): void {
  if (!cacheKey) throw new Error("Cache keys must not be empty.");
}

function normalizedContentType(contentType: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (!normalized) throw new Error("Cached files require a content type.");
  return normalized;
}

function entryPaths(cacheKey: string): EntryPaths {
  const hash = createHash("sha256").update(cacheKey).digest("hex");
  const directory = path.join(cacheRoot(), hash);
  return {
    directory,
    file: path.join(directory, "file"),
    metadata: path.join(directory, "metadata.json")
  };
}

function isMetadata(value: unknown): value is CacheMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<CacheMetadata>;
  return (
    typeof metadata.contentType === "string" &&
    metadata.contentType.trim().length > 0 &&
    typeof metadata.byteLength === "number" &&
    Number.isSafeInteger(metadata.byteLength) &&
    metadata.byteLength > 0
  );
}

async function removeEntry(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

async function findCompleted(cacheKey: string): Promise<CachedFile | null> {
  const paths = entryPaths(cacheKey);
  let rawMetadata: string;
  try {
    rawMetadata = await readFile(paths.metadata, "utf8");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await removeEntry(paths.directory);
    return null;
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(rawMetadata);
  } catch {
    await removeEntry(paths.directory);
    return null;
  }
  if (!isMetadata(metadata)) {
    await removeEntry(paths.directory);
    return null;
  }

  let details;
  try {
    details = await stat(paths.file);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await removeEntry(paths.directory);
    return null;
  }
  if (!details.isFile() || details.size !== metadata.byteLength) {
    await removeEntry(paths.directory);
    return null;
  }

  return {
    filePath: paths.file,
    contentType: metadata.contentType,
    byteLength: metadata.byteLength
  };
}

async function commitTemporaryEntry(
  cacheKey: string,
  temporaryDirectory: string,
  contentType: string,
  byteLength: number
): Promise<CachedFile> {
  const paths = entryPaths(cacheKey);
  await writeFile(
    path.join(temporaryDirectory, "metadata.json"),
    JSON.stringify({ contentType, byteLength } satisfies CacheMetadata)
  );

  try {
    await rename(temporaryDirectory, paths.directory);
  } catch (error) {
    if (!isNodeError(error, "EEXIST") && !isNodeError(error, "ENOTEMPTY")) {
      throw error;
    }
    await removeEntry(temporaryDirectory);
    const winner = await findCompleted(cacheKey);
    if (winner) return winner;
    throw error;
  }

  return {
    filePath: paths.file,
    contentType,
    byteLength
  };
}

async function writeEntry(
  cacheKey: string,
  contentType: string,
  writeData: (filePath: string) => Promise<void>
): Promise<CachedFile> {
  validateCacheKey(cacheKey);
  const normalizedType = normalizedContentType(contentType);
  await preparation;

  const hash = createHash("sha256").update(cacheKey).digest("hex");
  const temporaryDirectory = path.join(
    cacheRoot(),
    `.part-${hash}-${process.pid}-${randomUUID()}`
  );
  await mkdir(temporaryDirectory);

  try {
    const temporaryFile = path.join(temporaryDirectory, "file");
    await writeData(temporaryFile);
    const details = await stat(temporaryFile);
    if (!details.isFile() || details.size === 0) {
      throw new Error("Cached files must not be empty.");
    }
    return await commitTemporaryEntry(
      cacheKey,
      temporaryDirectory,
      normalizedType,
      details.size
    );
  } catch (error) {
    await removeEntry(temporaryDirectory);
    throw error;
  }
}

export const cache = {
  /**
   * Finds a completed cache entry without reading its file into memory.
   */
  async find(cacheKey: string): Promise<CachedFile | null> {
    validateCacheKey(cacheKey);
    await preparation;
    return findCompleted(cacheKey);
  },

  /**
   * Streams validated provider bytes into a temporary file and commits it.
   */
  async writeStream(
    cacheKey: string,
    source: {
      contentType: string;
      stream: ReadableStream<Uint8Array>;
    }
  ): Promise<CachedFile> {
    return writeEntry(cacheKey, source.contentType, async (filePath) => {
      await pipeline(
        Readable.fromWeb(
          source.stream as unknown as NodeReadableStream<Uint8Array>
        ),
        createWriteStream(filePath)
      );
    });
  },

  /**
   * Writes complete validated provider bytes and commits the cache entry.
   */
  async writeFile(
    cacheKey: string,
    source: {
      contentType: string;
      bytes: Uint8Array;
    }
  ): Promise<CachedFile> {
    return writeEntry(cacheKey, source.contentType, (filePath) =>
      writeFile(filePath, source.bytes)
    );
  }
};
