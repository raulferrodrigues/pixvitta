import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mixTitle,
  type RecentEntry,
  type RecentSource,
  type RecentSourceInput,
  type SavedMix,
  type SavedMixInput
} from "../../shared/recentSources";

/*
 * Recents are a provider-neutral main-process JSON store of sources and saved
 * mixes. The renderer shows the list, but main validates provider metadata,
 * deduplicates sources by location and mixes by ID, orders and caps the list,
 * and persists it under userData.
 */

// Unpinned entries kept, sources and mixes together. Pinned mixes do not count.
export const maxRecentSources = 10;
const maxMixNameLength = 120;

type StoredEntry = RecentSource | SavedMix;

// What a session mix that went down to one source keeps, so the session can
// bring it back as it was.
type MixLabel = { name?: string; pinned: boolean };

function isMix(entry: StoredEntry): entry is SavedMix {
  return entry.kind === "mix";
}

function isPinned(entry: StoredEntry): boolean {
  return isMix(entry) && entry.pinned;
}

function entryTitle(entry: StoredEntry): string {
  return isMix(entry) ? entry.name ?? mixTitle(entry.members.map((member) => member.title)) : entry.title;
}

function validOpenedMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function validSourceInput(value: unknown): RecentSourceInput | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<RecentSourceInput>;
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
  return { location, title, providerId, kind: source.kind };
}

function validMixName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, maxMixNameLength).trim();
  return name || undefined;
}

// A mix's members in order, valid ones only, each location once.
function validMembers(value: unknown): RecentSourceInput[] {
  const members: RecentSourceInput[] = [];
  for (const rawMember of Array.isArray(value) ? value : []) {
    const member = validSourceInput(rawMember);
    if (member && !members.some((kept) => kept.location === member.location)) {
      members.push(member);
    }
  }
  return members;
}

function createMix(
  id: string,
  members: RecentSourceInput[],
  label: MixLabel,
  openedMs: number
): SavedMix {
  return {
    kind: "mix",
    id,
    ...(label.name ? { name: label.name } : {}),
    pinned: label.pinned,
    members,
    openedMs
  };
}

function validMix(value: Partial<SavedMix>): SavedMix | null {
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const members = validMembers(value.members);
  // A mix of one source is not a mix.
  if (!id || members.length < 2) return null;
  return createMix(
    id,
    members,
    { name: validMixName(value.name), pinned: value.pinned === true },
    validOpenedMs(value.openedMs)
  );
}

// Entries written before mixes existed have no "mix" kind and read as sources.
function validEntry(value: unknown): StoredEntry | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { kind?: unknown }).kind === "mix") return validMix(value as Partial<SavedMix>);
  const source = validSourceInput(value);
  return source
    ? { ...source, openedMs: validOpenedMs((value as { openedMs?: unknown }).openedMs) }
    : null;
}

function entryKey(entry: StoredEntry): string {
  return isMix(entry) ? `mix:${entry.id}` : `source:${entry.location}`;
}

// Pinned mixes first, then everything else; each group newest first, and the
// unpinned group capped. The sort is stable, so an entry just put at the
// front stays ahead of one opened in the same millisecond.
function arrange(entries: StoredEntry[]): StoredEntry[] {
  const sorted = [...entries].sort(
    (a, b) => Number(isPinned(b)) - Number(isPinned(a)) || b.openedMs - a.openedMs
  );
  const pinned = sorted.filter(isPinned);
  const unpinned = sorted.filter((entry) => !isPinned(entry));
  return [...pinned, ...unpinned.slice(0, maxRecentSources)];
}

// Recents JSON is recoverable user data, not trusted program state. Invalid
// entries are skipped and duplicates collapse to the newest: sources by
// location, mixes by ID.
export function sanitizeRecentEntries(value: unknown): StoredEntry[] {
  const rawItems = Array.isArray(value) ? value : [];
  const newestByKey = new Map<string, StoredEntry>();

  for (const rawItem of rawItems) {
    const item = validEntry(rawItem);
    if (!item) continue;
    const key = entryKey(item);
    const current = newestByKey.get(key);
    if (!current || item.openedMs > current.openedMs) {
      newestByKey.set(key, item);
    }
  }

  return arrange(
    [...newestByKey.values()].sort(
      (a, b) => b.openedMs - a.openedMs || entryTitle(a).localeCompare(entryTitle(b))
    )
  );
}

export function addRecentSource(
  items: StoredEntry[],
  source: RecentSourceInput,
  openedMs = Date.now()
): StoredEntry[] {
  const nextItem: RecentSource = { ...source, openedMs };
  return arrange([
    nextItem,
    ...items.filter((item) => isMix(item) || item.location !== nextItem.location)
  ]);
}

// What the renderer is given: each mix with the title it goes by.
function listed(items: StoredEntry[]): RecentEntry[] {
  return items.map((item) => (isMix(item) ? { ...item, title: entryTitle(item) } : item));
}

function migrateRecentFolders(value: unknown): StoredEntry[] {
  const rawItems = Array.isArray(value) ? value : [];
  return sanitizeRecentEntries(
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
  private items: StoredEntry[] = [];
  // Mixes their session took down to one source this run: out of the list,
  // but their name and pin come back if the session adds a source again.
  private readonly setAside = new Map<string, MixLabel>();
  private persistence: Promise<void> = Promise.resolve();

  constructor(
    private readonly recentSourcesPath: string,
    private readonly legacyRecentFoldersPath: string,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<RecentEntry[]> {
    try {
      const contents = await readFile(this.recentSourcesPath, "utf8");
      this.items = sanitizeRecentEntries(JSON.parse(contents));
      return this.get();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.items = [];
        return this.get();
      }
    }

    try {
      const legacy = await readFile(this.legacyRecentFoldersPath, "utf8");
      this.items = migrateRecentFolders(JSON.parse(legacy));
    } catch {
      this.items = [];
      return this.get();
    }
    await this.persist().catch(() => undefined);
    return this.get();
  }

  get(): RecentEntry[] {
    return listed(this.items);
  }

  async add(source: RecentSourceInput): Promise<RecentEntry[]> {
    this.items = addRecentSource(this.items, source, this.stamp());
    return this.save();
  }

  /** Removes a source. Mixes that hold it keep it. */
  async remove(location: string): Promise<RecentEntry[]> {
    this.items = this.items.filter((item) => isMix(item) || item.location !== location);
    return this.save();
  }

  getMix(id: string): SavedMixInput | null {
    const mix = this.findMix(id);
    return mix ? { id: mix.id, members: mix.members } : null;
  }

  /**
   * Writes a session's mix as it now is, at the front of the list. With fewer
   * than two members it is not a mix: it leaves the list, and its name and pin
   * are set aside until the session saves it again.
   */
  async saveMix(input: SavedMixInput): Promise<RecentEntry[]> {
    const members = validMembers(input.members);
    const current = this.findMix(input.id);
    if (members.length < 2) {
      if (!current) return this.get();
      this.setAside.set(input.id, { name: current.name, pinned: current.pinned });
      this.items = this.items.filter((item) => item !== current);
      return this.save();
    }
    const label = current ?? this.setAside.get(input.id) ?? { pinned: false };
    this.setAside.delete(input.id);
    this.items = arrange([
      createMix(input.id, members, label, this.stamp()),
      ...this.items.filter((item) => item !== current)
    ]);
    return this.save();
  }

  /** Deletes a saved mix. Its sources stay as entries of their own. */
  async removeMix(id: string): Promise<RecentEntry[]> {
    this.setAside.delete(id);
    this.items = this.items.filter((item) => !isMix(item) || item.id !== id);
    return this.save();
  }

  /**
   * Pins or unpins a mix. Unpinning keeps its name and puts it at the front
   * of the rest, as if just opened, so it does not drop off the list at once.
   */
  async pinMix(id: string, pinned: boolean): Promise<RecentEntry[]> {
    const mix = this.findMix(id);
    if (!mix || mix.pinned === pinned) return this.get();
    const next = { ...mix, pinned, ...(pinned ? {} : { openedMs: this.stamp() }) };
    this.items = arrange([next, ...this.items.filter((item) => item !== mix)]);
    return this.save();
  }

  /** Names a pinned mix; an empty name goes back to its automatic title. */
  async renameMix(id: string, name: string): Promise<RecentEntry[]> {
    const mix = this.findMix(id);
    if (!mix?.pinned) return this.get();
    const nextName = validMixName(name);
    const { name: previousName, ...rest } = mix;
    if (nextName === previousName) return this.get();
    const next: SavedMix = nextName ? { ...rest, name: nextName } : rest;
    this.items = this.items.map((item) => (item === mix ? next : item));
    return this.save();
  }

  // When an entry is opened: now, but always after every other entry, so two
  // written in the same millisecond, as a source and the mix it was added to,
  // keep their order when the list is read again.
  private stamp(): number {
    const newest = Math.max(0, ...this.items.map((item) => item.openedMs));
    return Math.max(this.now(), newest + 1);
  }

  private findMix(id: string): SavedMix | undefined {
    return this.items.find((item): item is SavedMix => isMix(item) && item.id === id);
  }

  private async save(): Promise<RecentEntry[]> {
    await this.persist();
    return this.get();
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
