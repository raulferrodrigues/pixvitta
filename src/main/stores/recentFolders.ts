import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecentFolder } from "../../shared/recentFolders";

/*
 * Recent folders are another tiny main-process JSON store. The renderer shows
 * the list, but the main process normalizes paths, deduplicates entries, and
 * persists them under userData.
 */

export const maxRecentFolders = 10;

// Normalize the path before storing it so the same folder does not appear twice
// with slightly different spellings. The display name falls back to the full
// path for roots where basename can be empty.
function createRecentFolder(folderPath: string, openedMs = Date.now()): RecentFolder {
  const normalizedPath = path.resolve(folderPath);
  return {
    folderPath: normalizedPath,
    name: path.basename(normalizedPath) || normalizedPath,
    openedMs
  };
}

// Recent-folder JSON is treated as recoverable user data, not trusted program
// state. Invalid entries are skipped, duplicates collapse to the newest entry,
// and the list is capped to keep the menu/home UI small.
export function sanitizeRecentFolders(value: unknown): RecentFolder[] {
  const rawItems = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const items: RecentFolder[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const { folderPath, openedMs } = rawItem as Partial<RecentFolder>;
    if (typeof folderPath !== "string" || folderPath.length === 0) continue;

    const item = createRecentFolder(folderPath, typeof openedMs === "number" ? openedMs : 0);
    if (seen.has(item.folderPath)) continue;
    seen.add(item.folderPath);
    items.push(item);
  }

  return items
    .sort((a, b) => b.openedMs - a.openedMs || a.name.localeCompare(b.name))
    .slice(0, maxRecentFolders);
}

// Adding a recent folder moves it to the front. This is the same behavior users
// expect from a native app's "Open Recent" style list.
export function addRecentFolder(items: RecentFolder[], folderPath: string, openedMs = Date.now()): RecentFolder[] {
  const nextItem = createRecentFolder(folderPath, openedMs);
  return [nextItem, ...items.filter((item) => item.folderPath !== nextItem.folderPath)].slice(0, maxRecentFolders);
}

export class RecentFoldersStore {
  private items: RecentFolder[] = [];

  constructor(private readonly recentFoldersPath: string) {}

  // Missing or invalid recents should never stop the app from launching. At
  // worst, the user sees an empty recent list.
  async load(): Promise<RecentFolder[]> {
    try {
      const contents = await readFile(this.recentFoldersPath, "utf8");
      this.items = sanitizeRecentFolders(JSON.parse(contents));
    } catch {
      this.items = [];
    }
    return this.items;
  }

  // Return the in-memory list that was already sanitized during load/add.
  get(): RecentFolder[] {
    return this.items;
  }

  // Persist immediately when a folder is opened so a crash later in the session
  // does not lose the recents update.
  async add(folderPath: string): Promise<RecentFolder[]> {
    this.items = addRecentFolder(this.items, folderPath);
    await this.persist();
    return this.items;
  }

  async remove(folderPath: string): Promise<RecentFolder[]> {
    const normalizedPath = path.resolve(folderPath);
    this.items = this.items.filter((item) => item.folderPath !== normalizedPath);
    await this.persist();
    return this.items;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.recentFoldersPath), { recursive: true });
    await writeFile(this.recentFoldersPath, `${JSON.stringify(this.items, null, 2)}\n`);
  }
}
