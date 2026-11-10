import type { DownloadActivitySnapshot, MediaCollection, MediaItem, MediaSourceCapabilities, OpenSourceError } from "../../shared/media";
import type { StageControls } from "./stageApi";
import type { RecentSource } from "../../shared/recentSources";

/*
 * Named states the UI can start in: /stage.html?scenario=<name>. Add one when a
 * state is hard to reach by hand or a test needs it, and it becomes reachable
 * from a preview tab and from Playwright alike.
 */

const FOLDER_CAPABILITIES: MediaSourceCapabilities = {
  canRefresh: true,
  canSort: true,
  canDownload: false,
  canDownloadCollection: false,
  canOpenOrigin: false
};

const WEB_CAPABILITIES: MediaSourceCapabilities = {
  canRefresh: true,
  canSort: false,
  canDownload: true,
  canDownloadCollection: true,
  canOpenOrigin: true
};

function absolute(path: string): string {
  return new URL(path, window.location.origin).href;
}

function image(id: string, width = 1200, height = 800): MediaItem {
  const url = absolute(`/stage-media/${width}x${height}/${encodeURIComponent(id)}.svg`);
  return {
    id,
    name: `${id}.svg`,
    url,
    thumbnailUrl: url,
    kind: "image",
    sizeBytes: 1_024,
    lastOpenedMs: 0,
    addedMs: 0,
    modifiedMs: 0,
    createdMs: 0
  };
}

function video(id: string): MediaItem {
  return {
    ...image(id),
    name: `${id}.webm`,
    url: absolute("/tests/fixtures/sample.webm"),
    thumbnailUrl: null,
    kind: "video"
  };
}

function brokenImage(id: string, kind: "missing" | "flaky"): MediaItem {
  const url = absolute(`/stage-media/${kind}/${id}.svg`);
  return { ...image(id), url, thumbnailUrl: url };
}

/** Builds a collection whose items' IDs include the source ID, as the real catalog's do. */
export function stageCollection(
  title: string,
  items: MediaItem[],
  capabilities: MediaSourceCapabilities = FOLDER_CAPABILITIES
): MediaCollection {
  return {
    source: {
      id: title,
      title,
      capabilities,
      members: [{
        id: `${title}:source`,
        title,
        kind: capabilities === FOLDER_CAPABILITIES ? "folder" : "web",
        itemCount: items.length
      }]
    },
    items,
    selectedId: items[0]?.id ?? null
  };
}

const sampleFolder = () =>
  stageCollection("Holiday photos", [
    image("beach"),
    image("forest", 800, 1200),
    video("waves"),
    image("harbor", 1600, 600),
    image("market", 640, 480),
    image("sunset")
  ]);

const largeGallery = () =>
  stageCollection(
    "Large gallery",
    Array.from({ length: 5_000 }, (value, index) => image(`page-${String(index + 1).padStart(4, "0")}`, 900, 1300)),
    WEB_CAPABILITIES
  );

const SOURCE_ERRORS: OpenSourceError[] = [
  "invalid-location",
  "unsupported-location",
  "not-found",
  "authentication-required",
  "rate-limited",
  "unavailable",
  "invalid-response",
  "no-supported-media"
];

type StageMergeMember = { title: string; location: string; kind: "folder" | "web"; count: number; siteName?: string };

const MERGE_MEMBERS: StageMergeMember[] = [
  { title: "Holiday photos", location: "/photos/holiday", kind: "folder", count: 214 },
  { title: "Sample thread", location: "https://boards.4chan.org/g/thread/1000", kind: "web", count: 87, siteName: "4chan" },
  { title: "Long-named gallery of architecture sketches from the northern coast", location: "https://e-hentai.org/g/1/abcdef/", kind: "web", count: 1, siteName: "E-Hentai" }
];
const CITY_WALKS: StageMergeMember = {
  title: "City walks",
  location: "/home/someone/Pictures/Archive/Travel/2025/Lisbon and Porto/City walks",
  kind: "folder",
  count: 32
};

// Interleaves a few items of each member as the library's zipper does, with
// the members' real counts on the source.
function mergeStageMembers(members: StageMergeMember[]): MediaCollection {
  const shown = members.map((member) => Math.min(member.count, 4));
  const items: MediaItem[] = [];
  for (let round = 0; round < Math.max(...shown); round += 1) {
    members.forEach((member, index) => {
      if (round < shown[index]) {
        items.push({ ...image(`${member.title.split(" ")[0].toLowerCase()}-${round + 1}`), ...(members.length > 1 ? { sourceLabel: member.title } : {}) });
      }
    });
  }
  const collection = stageCollection(members[0].title, items);
  collection.source.title = members.length === 1
    ? members[0].title
    : members.length === 2 ? `${members[0].title} + ${members[1].title}` : `${members[0].title} + ${members.length - 1} more`;
  collection.source.members = members.map((member, index) => ({
    id: `source-${index + 1}`,
    title: member.title,
    kind: member.kind,
    itemCount: member.count,
    ...(member.siteName ? { siteName: member.siteName } : {}),
    recentLocation: member.location
  }));
  return collection;
}

function mergedSources(stage: StageControls, memberCount: number) {
  const members = MERGE_MEMBERS.slice(0, memberCount);
  const recent = (member: Omit<StageMergeMember, "count">, openedMs: number): RecentSource => ({
    title: member.title,
    location: member.location,
    kind: member.kind,
    providerId: member.kind === "folder" ? "local-folder" : "four-chan",
    openedMs
  });
  stage.defineSource(CITY_WALKS.location, mergeStageMembers([...members, CITY_WALKS]));
  // Adding a member again is main's "already-added"; the others merge in.
  for (const member of MERGE_MEMBERS) {
    stage.defineSource(member.location, members.includes(member) ? "already-added" : mergeStageMembers([...members, member]));
  }
  stage.defineSource("https://boards.4chan.org/g/thread/404", "not-found");
  stage.setRecentSources([
    recent(MERGE_MEMBERS[0], 5),
    recent(CITY_WALKS, 4),
    recent(MERGE_MEMBERS[1], 3),
    recent({ title: "Missing thread", location: "https://boards.4chan.org/g/thread/404", kind: "web" }, 2),
    recent({ title: "Watercolour studies", location: "https://nhentai.net/g/100200/", kind: "web" }, 1)
  ]);
  stage.deliverCollection(mergeStageMembers(members));
}

const scenarios: Record<string, (stage: StageControls) => void> = {
  /** The source picker with nothing open. The folder picker opens the sample folder. */
  empty(stage) {
    stage.defineSource("pick-directory", sampleFolder());
  },

  /** The source picker with a history to choose from. */
  recents(stage) {
    stage.defineSource("/photos/holiday", sampleFolder());
    stage.setRecentSources([
      { location: "/photos/holiday", title: "Holiday photos", providerId: "local-folder", kind: "folder", openedMs: 0 },
      { location: "https://boards.4chan.org/g/thread/1000", title: "Sample thread", providerId: "four-chan", kind: "web", openedMs: 0 }
    ]);
  },

  /** A folder of images and a video, ready to browse. */
  folder(stage) {
    stage.deliverCollection(sampleFolder());
  },

  /**
   * A collection merged from three sources of uneven size, one with a long
   * title, and recents to add from. Two recents are already members and stay
   * out of the list; "City walks" (a long path) adds a fourth source,
   * "Missing thread" fails to load, and pasting a member's location reports
   * that it is already in the mix.
   */
  "merged-sources"(stage) {
    mergedSources(stage, 3);
  },

  /** The same sources and recents with only one source open. */
  "merged-sources-single"(stage) {
    mergedSources(stage, 1);
  },

  /** A web source of 5,000 pages, for virtualization and navigation at scale. */
  "large-gallery"(stage) {
    stage.deliverCollection(largeGallery());
  },

  /** One item that never loads, one that recovers on retry, and one that is fine. */
  "broken-media"(stage) {
    stage.deliverCollection(
      stageCollection("Broken media", [brokenImage("never-loads", "missing"), brokenImage("recovers", "flaky"), image("fine")])
    );
  },

  /** A source is open and a replacement is stuck loading. */
  "loading-replacement"(stage) {
    stage.defineSource("https://boards.4chan.org/g/thread/2000", largeGallery());
    stage.holdOpens();
    stage.deliverCollection(sampleFolder());
  },

  /** A web source mid-download, showing every download state. */
  downloads(stage) {
    const collection = stageCollection("Downloading", [image("one"), image("two"), image("three"), image("four")], WEB_CAPABILITIES);
    const states = ["complete", "active", "queued", "failed"] as const;
    const snapshot: DownloadActivitySnapshot = {
      revision: 1,
      collectionActive: true,
      rows: collection.items.map((item, index) => ({
        id: `download-${item.id}`,
        mediaId: item.id,
        name: item.name,
        thumbnailUrl: item.thumbnailUrl,
        state: states[index]
      })),
      itemStates: Object.fromEntries(collection.items.map((item, index) => [item.id, states[index]]))
    };
    stage.deliverCollection(collection);
    stage.setDownloadActivity(snapshot);
  }
};

// One scenario per way a source can fail to open, shown over an open source.
for (const error of SOURCE_ERRORS) {
  scenarios[`error-${error}`] = (stage) => {
    stage.deliverCollection(sampleFolder());
    stage.showSourceError(error);
  };
}

export const scenarioNames = Object.keys(scenarios);

export function runScenario(name: string, stage: StageControls): void {
  (scenarios[name] ?? scenarios.folder)(stage);
}
