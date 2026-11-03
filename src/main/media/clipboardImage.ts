import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ipcMain, type WebContents } from "electron";
import { getMediaFileType } from "../utils/mediaTypes";

/*
 * Copy Image puts PNG data on the clipboard for apps like Discord, which paste
 * image data rather than files. Electron's main process cannot decode WebP or
 * AVIF, so the window's preload script, which has Chromium's image decoders,
 * encodes the PNG.
 */

const ENCODE_TIMEOUT_MS = 15_000;

type PendingEncode = {
  sender: WebContents;
  resolve(png: Uint8Array): void;
  reject(error: Error): void;
};

const pendingEncodes = new Map<string, PendingEncode>();

ipcMain.on("clipboard:encoded-png", (event, reply: unknown) => {
  if (!reply || typeof reply !== "object") return;
  const { id, png, error } = reply as { id?: unknown; png?: unknown; error?: unknown };
  if (typeof id !== "string") return;
  const pending = pendingEncodes.get(id);
  if (!pending || pending.sender !== event.sender) return;
  pendingEncodes.delete(id);
  if (png instanceof Uint8Array) pending.resolve(png);
  else pending.reject(new Error(typeof error === "string" ? error : "The image could not be encoded."));
});

// Resolves to PNG bytes for an image file, or null when the file is not an image.
export async function encodeImageAsPng(webContents: WebContents, filePath: string): Promise<Uint8Array | null> {
  const fileType = getMediaFileType(filePath);
  if (fileType?.kind !== "image") return null;
  const bytes = new Uint8Array(await readFile(filePath));
  if (fileType.mimeType === "image/png") return bytes;

  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingEncodes.delete(id);
      reject(new Error("Encoding the image for the clipboard timed out."));
    }, ENCODE_TIMEOUT_MS);
    pendingEncodes.set(id, {
      sender: webContents,
      resolve: (png) => { clearTimeout(timer); resolve(png); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    webContents.send("clipboard:encode-png", { id, bytes, mimeType: fileType.mimeType });
  });
}
