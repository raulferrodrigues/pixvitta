import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CachedResource = {
  bytes: Uint8Array;
  contentType: string;
};

type CacheMetadata = {
  contentType: string;
  byteLength: number;
};

export interface ResourceCache {
  read(key: string): Promise<CachedResource | null>;
  write(key: string, resource: CachedResource): Promise<void>;
}

function cacheFileName(namespace: string, key: string): string {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(key)
    .digest("hex");
}

function isCacheMetadata(value: unknown): value is CacheMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<CacheMetadata>;
  return (
    typeof metadata.contentType === "string" &&
    metadata.contentType.length > 0 &&
    typeof metadata.byteLength === "number" &&
    Number.isSafeInteger(metadata.byteLength) &&
    metadata.byteLength >= 0
  );
}

/**
 * Small provider-neutral byte cache. Providers retain ownership of network
 * policy and stable cache identities; this module only persists validated
 * resources atomically.
 */
export class DiskResourceCache implements ResourceCache {
  constructor(
    private readonly rootDirectory: () => string,
    private readonly namespace: string
  ) {}

  async read(key: string): Promise<CachedResource | null> {
    const paths = this.pathsFor(key);
    try {
      const [bytes, rawMetadata] = await Promise.all([
        readFile(paths.data),
        readFile(paths.metadata, "utf8")
      ]);
      const metadata: unknown = JSON.parse(rawMetadata);
      if (!isCacheMetadata(metadata) || metadata.byteLength !== bytes.byteLength) {
        await this.remove(paths);
        return null;
      }
      return {
        bytes: new Uint8Array(bytes),
        contentType: metadata.contentType
      };
    } catch {
      return null;
    }
  }

  async write(key: string, resource: CachedResource): Promise<void> {
    const paths = this.pathsFor(key);
    const directory = path.dirname(paths.data);
    const temporarySuffix = `.part-${process.pid}-${randomUUID()}`;
    const temporaryData = `${paths.data}${temporarySuffix}`;
    const temporaryMetadata = `${paths.metadata}${temporarySuffix}`;

    await mkdir(directory, { recursive: true });
    try {
      await Promise.all([
        writeFile(temporaryData, resource.bytes),
        writeFile(
          temporaryMetadata,
          JSON.stringify({
            contentType: resource.contentType,
            byteLength: resource.bytes.byteLength
          } satisfies CacheMetadata)
        )
      ]);
      await rename(temporaryData, paths.data);
      await rename(temporaryMetadata, paths.metadata);
    } catch (error) {
      await Promise.all([
        rm(temporaryData, { force: true }),
        rm(temporaryMetadata, { force: true })
      ]);
      throw error;
    }
  }

  private pathsFor(key: string): { data: string; metadata: string } {
    const fileName = cacheFileName(this.namespace, key);
    const directory = path.join(this.rootDirectory(), this.namespace);
    return {
      data: path.join(directory, `${fileName}.bin`),
      metadata: path.join(directory, `${fileName}.json`)
    };
  }

  private async remove(paths: { data: string; metadata: string }): Promise<void> {
    await Promise.all([
      rm(paths.data, { force: true }),
      rm(paths.metadata, { force: true })
    ]);
  }
}
