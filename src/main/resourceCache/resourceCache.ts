import type { CachedFile } from "./types";

export const cache = {
  /**
   * Finds a completed cache entry without reading its file into memory.
   */
  find(cacheKey: string): Promise<CachedFile | null> {
    throw new Error("The resource cache has not been implemented.");
  },

  /**
   * Streams validated provider bytes into a temporary file and commits it.
   */
  writeStream(
    cacheKey: string,
    source: {
      contentType: string;
      stream: ReadableStream<Uint8Array>;
    }
  ): Promise<CachedFile> {
    throw new Error("The resource cache has not been implemented.");
  },

  /**
   * Writes complete validated provider bytes and commits the cache entry.
   */
  writeFile(
    cacheKey: string,
    source: {
      contentType: string;
      bytes: Uint8Array;
    }
  ): Promise<CachedFile> {
    throw new Error("The resource cache has not been implemented.");
  }
};
