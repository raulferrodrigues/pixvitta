import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { RegisteredMediaItem } from "../library/mediaRegistry";
import { writeMediaDownload } from "./mediaDownload";

/*
 * Copying remote media as a file needs a real, properly named file on disk for
 * the clipboard to point at. Each copy gets its own folder under the temp
 * directory, and older copies are removed because only the newest can still be
 * on the clipboard.
 */
export async function saveMediaForClipboard(item: RegisteredMediaItem): Promise<string> {
  // Normal priority reuses the cached file for media already loaded, and unlike
  // the viewer's high priority it does not wait for the item to be selected.
  const response = await item.media.respond(
    new Request(`pixvitta-media://media/${item.id}?intent=clipboard`),
    "normal"
  );
  const root = path.join(app.getPath("temp"), "pixvitta-clipboard");
  const folder = randomUUID();
  const filePath = await writeMediaDownload(path.join(root, folder), item.name, response);

  for (const entry of await readdir(root)) {
    if (entry !== folder) await rm(path.join(root, entry), { recursive: true, force: true });
  }
  return filePath;
}
