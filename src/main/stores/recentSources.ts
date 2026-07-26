import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RecentSource,
  RecentSourceInput
} from "../../shared/recentSources";

/*
 * Recent sources are a provider-neutral main-process JSON store. The renderer
 * shows the list, but main validates provider metadata, deduplicates canonical
 * locations, and persists them under userData.
 */

export const maxRecentSources = 10;

function createRecentSource(
  source: RecentSourceInput,
  openedMs = Date.now()
): RecentSource {
  return {
    location: source.location,
    title: source.title,
    providerId: source.providerId,
    kind: source.kind,
    openedMs
  };
}

function validSource(value: unknown): RecentSource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<RecentSource>;
  const location =
    typeof source.location === "string" ? source.location.trim() : "";
  const title = typeof source.title === "string" ? source.title.trim() : "";
  const providerId =
    typeof source.providerId === "string" ? source.providerId.trim() : "";
  if (
    !location ||
    !title ||
    !/^[a-z0-9][a-z0-9-]*$/.test(providerId) ||
    (source.kind !== "folder" && source.kind !== "web")
  ) {
    return null;
  }
  return createRecentSource(
    { location, title, providerId, kind: source.kind },
    typeof source.openedMs === "number" &&
      Number.isFinite(source.openedMs) &&
      source.openedMs >= 0
      ? source.openedMs
      : 0
  );
}

// Recent-source JSON is recoverable user data, not trusted program state.
// Invalid entries are skipped and duplicate locations collapse to the newest.
export function sanitizeRecentSources(value: unknown): RecentSource[] {
  const rawItems = Array.isArray(value) ? value : [];
  const newestByLocation = new Map<string, RecentSource>();

  for (const rawItem of rawItems) {
    const item = validSource(rawItem);
    if (!item) continue;
    const current = newestByLocation.get(item.location);
    if (!current || item.openedMs > current.openedMs) {
      newestByLocation.set(item.location, item);
    }
  }

  return [...newestByLocation.values()]
    .sort(
      (a, b) =>
        b.openedMs - a.openedMs || a.title.localeCompare(b.title)
    )
    .slice(0, maxRecentSources);
}

export function addRecentSource(
  items: RecentSource[],
  source: RecentSourceInput,
  openedMs = Date.now()
): RecentSource[] {
  const nextItem = createRecentSource(source, openedMs);
  return [
    nextItem,
    ...items.filter((item) => item.location !== nextItem.location)
  ].slice(0, maxRecentSources);
}

function migrateRecentFolders(value: unknown): RecentSource[] {
  const rawItems = Array.isArray(value) ? value : [];
  return sanitizeRecentSources(
    rawItems.flatMap((rawItem) => {
      if (!rawItem || typeof rawItem !== "object") return [];
      const legacy = rawItem as {
        folderPath?: unknown;
        openedMs?: unknown;
      };
      if (
        typeof legacy.folderPath !== "string" ||
        !legacy.folderPath
      ) {
        return [];
      }
      const location = path.resolve(legacy.folderPath);
      return [{
        location,
        title: path.basename(location) || location,
        providerId: "local-folder",
        kind: "folder",
        openedMs: legacy.openedMs
      }];
    })
  );
}

export class RecentSourcesStore {
  private items: RecentSource[] = [];
  private persistence: Promise<void> = Promise.resolve();

  constructor(
    private readonly recentSourcesPath: string,
    private readonly legacyRecentFoldersPath: string
  ) {}

  async load(): Promise<RecentSource[]> {
    try {
      const contents = await readFile(this.recentSourcesPath, "utf8");
      this.items = sanitizeRecentSources(JSON.parse(contents));
      return this.items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.items = [];
        return this.items;
      }
    }

    try {
      const legacy = await readFile(this.legacyRecentFoldersPath, "utf8");
      this.items = migrateRecentFolders(JSON.parse(legacy));
    } catch {
      this.items = [];
      return this.items;
    }
    await this.persist().catch(() => undefined);
    return this.items;
  }

  get(): RecentSource[] {
    return this.items;
  }

  async add(source: RecentSourceInput): Promise<RecentSource[]> {
    this.items = addRecentSource(this.items, source);
    await this.persist();
    return this.items;
  }

  async remove(location: string): Promise<RecentSource[]> {
    this.items = this.items.filter((item) => item.location !== location);
    await this.persist();
    return this.items;
  }

  private async persist(): Promise<void> {
    const contents = `${JSON.stringify(this.items, null, 2)}\n`;
    const write = async () => {
      await mkdir(path.dirname(this.recentSourcesPath), { recursive: true });
      await writeFile(this.recentSourcesPath, contents);
    };
    this.persistence = this.persistence.then(write, write);
    return this.persistence;
  }
}
