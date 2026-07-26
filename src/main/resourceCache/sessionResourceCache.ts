import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const preparedDirectories = new Map<string, Promise<void>>();

export function sessionResourceCacheDirectory(
  userDataDirectory: string
): string {
  if (!userDataDirectory.trim()) {
    throw new Error("Cannot prepare a session cache without a userData directory.");
  }
  return path.join(path.resolve(userDataDirectory), "media-cache", "v1");
}

/**
 * Clears the media cache once per main-process session. Every source-opening
 * entry point awaits the same promise, so no provider can race startup cleanup.
 */
export function prepareSessionResourceCache(
  userDataDirectory: string
): Promise<void> {
  const cacheDirectory = sessionResourceCacheDirectory(userDataDirectory);
  const existing = preparedDirectories.get(cacheDirectory);
  if (existing) return existing;

  const preparation = rm(cacheDirectory, {
    recursive: true,
    force: true
  }).then(() => mkdir(cacheDirectory, { recursive: true }).then(() => undefined));
  preparedDirectories.set(cacheDirectory, preparation);
  return preparation;
}
