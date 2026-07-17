import { createHash } from "node:crypto";
import path from "node:path";

/*
 * This file is the small public face of thumbnailer.
 *
 * Callers do not ask whether a thumbnail is cached, native-generated, waiting
 * for renderer assistance, or served by a custom protocol. They hand thumbnailer
 * the source-file facts they already have from scanning and get back a
 * renderer-safe URL. Everything behind that URL stays private to this folder.
 *
 * The runtime half of thumbnailer imports this file to resolve those URLs back
 * to real file paths. That parser is intentionally not exported from
 * index.ts because outside modules should not treat thumbnail URLs as a general
 * lookup API.
 */

export type ThumbnailFile = {
  filePath: string;
  sizeBytes: number;
  modifiedMs: number;
};

export type Thumbnail = {
  url: string;
};

export type ResolvedThumbnailFile = ThumbnailFile & {
  id: string;
};

type RegisteredThumbnailFile = ResolvedThumbnailFile & {
  revision: string;
};

const THUMBNAIL_URL_VERSION = "v2";
const THUMBNAIL_FILE_NAME = "512.jpg";

// This private registry is the thumbnail equivalent of media's ID registry. The
// renderer receives only a URL with an opaque ID. When Chromium later asks the
// custom protocol for that URL, thumbnailer resolves the ID back to the file
// that was registered during scanning.
const thumbnailFilesById = new Map<string, RegisteredThumbnailFile>();

function thumbnailIdFor(filePath: string): string {
  // IDs are stable for a path during a process, short enough for URLs, and do
  // not reveal the user's filesystem path to the renderer.
  return createHash("sha256").update(filePath).digest("hex").slice(0, 32);
}

function thumbnailRevisionFor(file: ThumbnailFile): string {
  // The revision becomes part of the URL so browser/protocol caches naturally
  // miss when the source file changes. No separate cache-busting call is needed.
  return `${THUMBNAIL_URL_VERSION}-${Math.round(file.modifiedMs)}-${file.sizeBytes}`;
}

function safelyDecode(rawValue: string): string | null {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return null;
  }
}

function resolveThumbnailId(id: string): RegisteredThumbnailFile | null {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return thumbnailFilesById.get(id) ?? null;
}

export function getThumbnail(file: ThumbnailFile): Thumbnail {
  // Normalize paths before hashing and registering. Scans already use absolute
  // paths, but this makes the thumbnailer boundary robust for future callers.
  const normalizedFile: ThumbnailFile = {
    filePath: path.resolve(file.filePath),
    sizeBytes: file.sizeBytes,
    modifiedMs: file.modifiedMs
  };
  const id = thumbnailIdFor(normalizedFile.filePath);
  const revision = thumbnailRevisionFor(normalizedFile);

  thumbnailFilesById.set(id, {
    ...normalizedFile,
    id,
    revision
  });

  return {
    url: `pixvitta-thumb://thumb/${id}/${revision}/${THUMBNAIL_FILE_NAME}`
  };
}

export function resolveThumbnailUrl(rawUrl: string): ResolvedThumbnailFile | null {
  // Thumbnail URLs are long-cacheable, so the parser is intentionally stricter
  // than "whatever URL parses". Rejecting traversal-ish strings and malformed
  // revisions keeps custom protocol reads bound to files thumbnailer registered.
  const decodedRawUrl = safelyDecode(rawUrl);
  if (!decodedRawUrl) return null;
  if (decodedRawUrl.includes("..") || decodedRawUrl.includes("\\")) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "pixvitta-thumb:" || url.hostname !== "thumb") return null;

  const decodedPath = safelyDecode(url.pathname);
  if (!decodedPath) return null;

  const [id, revision, fileName, ...extra] = decodedPath.replace(/^\/+/, "").split("/");
  if (extra.length > 0 || !id || !revision || fileName !== THUMBNAIL_FILE_NAME) return null;
  if (!/^[a-zA-Z0-9.-]+$/.test(revision)) return null;

  const file = resolveThumbnailId(id);
  if (!file || file.revision !== revision) return null;

  return {
    id: file.id,
    filePath: file.filePath,
    sizeBytes: file.sizeBytes,
    modifiedMs: file.modifiedMs
  };
}

export function resolveThumbnailReference(reference: unknown): ResolvedThumbnailFile | null {
  // The current renderer-assisted thumbnail path still sends a media-looking ID
  // for historical reasons. During this refactor, thumbnail IDs are derived the
  // same way as media IDs, so the runtime can accept either a full thumbnail URL
  // or an ID while keeping the path lookup private to thumbnailer.
  if (typeof reference !== "string" || reference.length === 0) return null;
  if (reference.startsWith("pixvitta-thumb:")) return resolveThumbnailUrl(reference);

  const file = resolveThumbnailId(reference);
  if (!file) return null;

  return {
    id: file.id,
    filePath: file.filePath,
    sizeBytes: file.sizeBytes,
    modifiedMs: file.modifiedMs
  };
}
