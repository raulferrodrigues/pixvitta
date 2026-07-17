import { createHash, randomBytes } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { FileOrder } from "../../shared/settings";
import { getMediaFileType, type MediaKind } from "../utils/mediaTypes";
import type { MediaItem as PublicMediaItem } from "../../shared/media";
import { getThumbnail } from "../thumbnailer";

/*
 * Folder scanning is main-process work because it reads the user's filesystem.
 * The output is intentionally renderer-friendly: display names, timestamps,
 * media kind, and app URLs. The absolutePath stays on the internal record so
 * the media service can register IDs and then strip paths before renderer IPC.
 */

export type { MediaKind } from "../utils/mediaTypes";

export type MediaFileRecord = PublicMediaItem & {
  absolutePath: string;
};

// Compatibility alias for current internal callers. The public renderer-safe
// MediaItem lives in src/shared/media and deliberately does not include paths.
export type MediaItem = MediaFileRecord;

export type FolderScanResult = {
  folderPath: string;
  items: MediaFileRecord[];
};

export type ScanOptions = {
  fileOrder?: FileOrder;
  includeHidden?: boolean;
  randomSeed?: string;
};

// Intl.Collator gives Finder-like natural sorting, so "2.jpg" sorts before
// "10.jpg" and case differences do not create surprising order.
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

// IDs are derived from absolute paths so they are stable during a session and do
// not expose the path to the renderer URL. The short hash is enough for a local
// folder-sized registry without making URLs enormous.
export function createMediaId(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex").slice(0, 32);
}

// The full media URL is what the renderer assigns to img.src or video.src. The
// custom protocol handler later resolves the ID back to a file path.
export function createMediaUrl(id: string): string {
  return `pixvitta-media://media/${id}`;
}

// Sorting happens after every scan so the renderer receives data in display
// order. The renderer can then keep navigation and filmstrip rendering simple.
function sortMediaItems(
  items: MediaFileRecord[],
  fileOrder: NonNullable<ScanOptions["fileOrder"]>,
  randomSeed?: string
): MediaFileRecord[] {
  const compareNames = (a: MediaFileRecord, b: MediaFileRecord) => collator.compare(a.name, b.name);
  const compareNewest = (a: MediaFileRecord, b: MediaFileRecord, key: "lastOpenedMs" | "addedMs" | "modifiedMs" | "createdMs") =>
    b[key] - a[key] || compareNames(a, b);
  const effectiveRandomSeed = fileOrder === "random" ? (randomSeed ?? randomBytes(16).toString("hex")) : null;
  const randomRanks =
    effectiveRandomSeed !== null
      ? new Map(
          items.map((item) => [
            item.id,
            createHash("sha256").update(effectiveRandomSeed).update(item.id).digest("hex")
          ])
        )
      : null;

  return items.sort((a, b) => {
    if (randomRanks) {
      const aRank = randomRanks.get(a.id) ?? "";
      const bRank = randomRanks.get(b.id) ?? "";
      return (aRank < bRank ? -1 : aRank > bRank ? 1 : 0) || compareNames(a, b);
    }
    if (fileOrder === "kind") {
      return collator.compare(a.kind, b.kind) || collator.compare(path.extname(a.name), path.extname(b.name)) || compareNames(a, b);
    }
    if (fileOrder === "last-opened") return compareNewest(a, b, "lastOpenedMs");
    if (fileOrder === "date-added") return compareNewest(a, b, "addedMs");
    if (fileOrder === "modified") return compareNewest(a, b, "modifiedMs");
    if (fileOrder === "created") return compareNewest(a, b, "createdMs");
    if (fileOrder === "size") return b.sizeBytes - a.sizeBytes || compareNames(a, b);
    return compareNames(a, b);
  });
}

// This is the main "folder to media list" function. It reads only the top level
// of the folder, filters to supported files, stats each file for metadata, and
// produces the custom URLs that the renderer can safely load.
export async function scanFolder(folderPath: string, options: ScanOptions = {}): Promise<FolderScanResult> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const mediaEntries = entries.flatMap((entry) => {
    if (!entry.isFile()) return [];
    if (!options.includeHidden && entry.name.startsWith(".")) return [];

    const fileType = getMediaFileType(entry.name);
    return fileType ? [{ entry, fileType }] : [];
  });

  const items = await Promise.all(
    mediaEntries.map(async ({ entry, fileType }) => {
      const absolutePath = path.join(folderPath, entry.name);
      const details = await stat(absolutePath);
      const id = createMediaId(absolutePath);
      const thumbnail = getThumbnail({
        filePath: absolutePath,
        sizeBytes: details.size,
        modifiedMs: details.mtimeMs
      });
      return {
        id,
        name: entry.name,
        absolutePath,
        url: createMediaUrl(id),
        thumbnailUrl: thumbnail.url,
        kind: fileType.kind,
        sizeBytes: details.size,
        lastOpenedMs: details.atimeMs,
        addedMs: details.ctimeMs,
        modifiedMs: details.mtimeMs,
        createdMs: details.birthtimeMs
      };
    })
  );
  sortMediaItems(items, options.fileOrder ?? "name", options.randomSeed);

  return {
    folderPath,
    items
  };
}
