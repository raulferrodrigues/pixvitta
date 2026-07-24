import { createWriteStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { MediaResource } from "../library/providers/provider";

const MAX_FILENAME_ATTEMPTS = 10_000;

function safeDownloadName(name: string): string {
  const leafName = path.basename(name.replace(/\\/g, "/"));
  const sanitized = leafName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[.\s]+$/g, "");
  return sanitized && sanitized !== "." && sanitized !== ".."
    ? sanitized
    : "media";
}

function numberedName(fileName: string, attempt: number): string {
  if (attempt === 0) return fileName;
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  return `${stem} (${attempt})${extension}`;
}

async function reserveDownloadPath(
  downloadsDirectory: string,
  fileName: string
): Promise<string> {
  await mkdir(downloadsDirectory, { recursive: true });

  for (let attempt = 0; attempt < MAX_FILENAME_ATTEMPTS; attempt += 1) {
    const candidate = path.join(
      downloadsDirectory,
      numberedName(fileName, attempt)
    );
    try {
      const file = await open(candidate, "wx");
      await file.close();
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  throw new Error("Could not reserve a unique download filename.");
}

export async function downloadMediaResource(
  downloadsDirectory: string,
  name: string,
  resource: MediaResource
): Promise<string> {
  const response = await resource.respond(
    new Request("pixvitta-media://media/download")
  );
  if (!response.ok || !response.body) {
    throw new Error(`Media download returned HTTP ${response.status}.`);
  }

  const downloadPath = await reserveDownloadPath(
    downloadsDirectory,
    safeDownloadName(name)
  );
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as NodeReadableStream<Uint8Array>
      ),
      createWriteStream(downloadPath, { flags: "r+" })
    );
    return downloadPath;
  } catch (error) {
    await unlink(downloadPath).catch(() => undefined);
    throw error;
  }
}
