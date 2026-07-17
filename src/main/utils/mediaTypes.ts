import path from "node:path";
import type { MediaKind } from "../../shared/media";

export type { MediaKind } from "../../shared/media";

export type MediaFileType = {
  extension: `.${string}`;
  kind: MediaKind;
  mimeType: string;
};

/*
 * Shared main-process media type facts.
 *
 * This is deliberately a utility, not a feature module. Media and thumbnailer
 * both need the same stable extension/kind/MIME answers, but neither should own
 * the table for the other. Feature-specific policy stays out: for example,
 * whether WebM thumbnailing needs renderer help belongs to thumbnailer.
 */
export const mediaFileTypes = [
  { extension: ".jpg", kind: "image", mimeType: "image/jpeg" },
  { extension: ".jpeg", kind: "image", mimeType: "image/jpeg" },
  { extension: ".png", kind: "image", mimeType: "image/png" },
  { extension: ".gif", kind: "image", mimeType: "image/gif" },
  { extension: ".webp", kind: "image", mimeType: "image/webp" },
  { extension: ".bmp", kind: "image", mimeType: "image/bmp" },
  { extension: ".avif", kind: "image", mimeType: "image/avif" },
  { extension: ".svg", kind: "image", mimeType: "image/svg+xml" },
  { extension: ".ico", kind: "image", mimeType: "image/x-icon" },
  { extension: ".mp4", kind: "video", mimeType: "video/mp4" },
  { extension: ".m4v", kind: "video", mimeType: "video/x-m4v" },
  { extension: ".mov", kind: "video", mimeType: "video/quicktime" },
  { extension: ".webm", kind: "video", mimeType: "video/webm" },
  { extension: ".ogv", kind: "video", mimeType: "video/ogg" },
  { extension: ".ogg", kind: "video", mimeType: "video/ogg" }
] as const satisfies readonly MediaFileType[];

const mediaFileTypesByExtension = new Map<string, MediaFileType>(
  mediaFileTypes.map((fileType): [string, MediaFileType] => [fileType.extension, fileType])
);

export function getMediaFileType(filePath: string): MediaFileType | null {
  // Extensions are normalized once at lookup, so callers can pass display names,
  // absolute paths, or mixed-case Finder paths without special handling.
  return mediaFileTypesByExtension.get(path.extname(filePath).toLowerCase()) ?? null;
}

export function getMediaKind(filePath: string): MediaKind | null {
  return getMediaFileType(filePath)?.kind ?? null;
}

export function isSupportedMediaPath(filePath: string): boolean {
  return getMediaFileType(filePath) !== null;
}

export function isImageMediaPath(filePath: string): boolean {
  return getMediaFileType(filePath)?.kind === "image";
}

export function isVideoMediaPath(filePath: string): boolean {
  return getMediaFileType(filePath)?.kind === "video";
}

export function mediaContentTypeFor(filePath: string): string {
  return getMediaFileType(filePath)?.mimeType ?? "application/octet-stream";
}
