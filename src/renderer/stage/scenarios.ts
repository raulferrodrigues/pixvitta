import type { DownloadActivitySnapshot, MediaCollection, MediaItem, MediaSourceCapabilities, OpenSourceError } from "../../shared/media";
import type { StageControls } from "./stageApi";

/*
 * Named states the UI can start in: /stage.html?scenario=<name>. Add one when a
 * state is hard to reach by hand or a test needs it, and it becomes reachable
 * from a preview tab and from Playwright alike.
 */

const STAGE_ACCOUNT = {
  id: "exhentai",
  label: "ExHentai",
  description: "Opens ExHentai galleries with your E-Hentai forums account.",
  status: "signed-out"
} as const;

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
    source: { id: title, title, capabilities },
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

  /** Settings open on the provider accounts, one in each status. */
  accounts(stage) {
    stage.deliverCollection(sampleFolder());
    stage.setAccounts([
      { ...STAGE_ACCOUNT, status: "signed-in" },
      { id: "stage-provider", label: "Stage provider", description: "Opens stage galleries with your stage account.", status: "signed-out" },
      { id: "stage-pending", label: "Pending provider", description: "Opens pending galleries with your pending account.", status: "signing-in" }
    ]);
    stage.sendCommand("open-settings");
  },

  /** A folder of images and a video, ready to browse. */
  folder(stage) {
    stage.deliverCollection(sampleFolder());
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
    if (error === "authentication-required") {
      stage.setAccounts([STAGE_ACCOUNT]);
      stage.showSourceError(error, STAGE_ACCOUNT.id);
    } else {
      stage.showSourceError(error);
    }
  };
}

export const scenarioNames = Object.keys(scenarios);

export function runScenario(name: string, stage: StageControls): void {
  (scenarios[name] ?? scenarios.folder)(stage);
}
