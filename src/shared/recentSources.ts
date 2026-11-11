export type RecentSourceKind = "folder" | "web";

export type RecentSourceInput = {
  location: string;
  title: string;
  providerId: string;
  kind: RecentSourceKind;
};

export type RecentSource = RecentSourceInput & {
  openedMs: number;
};

// A mix as main saves it: its member sources in zipper order, and the ID of
// the session that built it. Each change in that session rewrites it.
export type SavedMixInput = {
  id: string;
  members: RecentSourceInput[];
};

export type SavedMix = SavedMixInput & {
  kind: "mix";
  // Set by renaming a pinned mix; it outlives unpinning. Absent, the mix
  // goes by its automatic title.
  name?: string;
  pinned: boolean;
  openedMs: number;
};

// A saved mix as recents list it, with the title main gives it: its name, or
// one made from its sources' titles.
export type RecentMix = SavedMix & { title: string };

// One entry of the recents list: a source, or a mix of sources. Pinned mixes
// come first, then everything else newest first.
export type RecentEntry = RecentSource | RecentMix;

export function isRecentMix(entry: RecentEntry): entry is RecentMix {
  return entry.kind === "mix";
}

// "a" alone, "a + b" for two, "a + 2 more" beyond.
export function mixTitle(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  if (titles.length === 2) return `${titles[0]} + ${titles[1]}`;
  return `${titles[0]} + ${titles.length - 1} more`;
}
