import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { getMediaFileType, mediaFileTypes } from "../utils/mediaTypes";

const MAX_FILENAME_ATTEMPTS = 10_000;

export function safeDownloadName(name: string): string {
  const leafName = path.basename(name.replace(/\\/g, "/"));
  const sanitized = leafName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "");
  return sanitized && sanitized !== "." && sanitized !== ".."
    ? sanitized
    : "media";
}

export function safeDownloadDirectoryName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "");
  return sanitized && sanitized !== "." && sanitized !== ".."
    ? sanitized
    : "Pixvitta Collection";
}

function numberedName(fileName: string, attempt: number): string {
  if (attempt === 0) return fileName;
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  return `${stem} (${attempt})${extension}`;
}

function responseDownloadName(name: string, response: Response): string {
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const responseType = mediaFileTypes.find(
    (fileType) => fileType.mimeType === contentType
  );
  if (!responseType) return name;

  const namedType = getMediaFileType(name);
  if (namedType?.mimeType === responseType.mimeType) return name;

  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return `${stem}${responseType.extension}`;
}

export async function writeMediaDownload(
  downloadsDirectory: string,
  name: string,
  response: Response
): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Media download returned HTTP ${response.status}.`);
  }

  await mkdir(downloadsDirectory, { recursive: true });
  const fileName = safeDownloadName(responseDownloadName(name, response));
  const temporaryPath = path.join(
    downloadsDirectory,
    `.pixvitta-download-${process.pid}-${randomUUID()}.part`
  );

  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as NodeReadableStream<Uint8Array>
      ),
      createWriteStream(temporaryPath, { flags: "wx" })
    );

    for (let attempt = 0; attempt < MAX_FILENAME_ATTEMPTS; attempt += 1) {
      const downloadPath = path.join(
        downloadsDirectory,
        numberedName(fileName, attempt)
      );
      try {
        await link(temporaryPath, downloadPath);
        return downloadPath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error("Could not reserve a unique download filename.");
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
