import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DownloadActivitySnapshot, MediaCollection, MediaItem, OpenSourceError } from "../../shared/media";
import { type AppSettings, defaultSettings } from "../../shared/settings";
import { MediaLibrary } from "../library/mediaLibrary";
import { FourChanProvider } from "../library/providers/fourChan";
import { LocalFolderProvider } from "../library/providers/localFolder";
import { NHentaiProvider } from "../library/providers/nhentai";
import { ProviderRegistry } from "../library/providers/providerRegistry";
import { DownloadManager } from "../media/downloadManager";
import { FakeWeb } from "./fakeWeb";
import { brokerControl } from "./testBroker";

/*
 * The flow layer: the real library, providers, acquisitions, scheduler, disk
 * cache, and download manager wired as in the app, with only the outside world
 * faked. The harness plays the two neighbors the library talks to:
 *
 * - the web, through FakeWeb
 * - the renderer, by acknowledging collections and asking for media URLs
 *
 * Reach for this when behavior spans modules: "what goes over the wire, in what
 * order, and what does the user get when a source opens, refreshes, or fails".
 */

// What each upstream allows, written from the provider docs and their published
// limits. A flow fails if a request asks for less delay than its upstream's
// entry, or goes to a host with no entry. Lowering a number here is a decision
// about how hard Pixvitta hits a real service, so make it deliberately.
const UPSTREAM_MINIMUM_DELAY_MS: ReadonlyArray<readonly [RegExp, number]> = [
  // "No more than one request per second" across the 4chan API.
  [/^https:\/\/a\.4cdn\.org\//, 1_000],
  [/^https:\/\/i\.4cdn\.org\/.*s\.jpg$/, 200],
  [/^https:\/\/i\.4cdn\.org\//, 1_000],
  // The anonymous gallery-detail limit is 20 requests per minute per IP.
  [/^https:\/\/nhentai\.net\/api\//, 3_000],
  [/^https:\/\/t\d*\.nhentai\.net\//, 200],
  [/^https:\/\/i\d*\.nhentai\.net\//, 1_000]
];

function assertUpstreamLimitsHonored(): void {
  for (const { url, policy } of brokerControl.submitted) {
    const limit = UPSTREAM_MINIMUM_DELAY_MS.find(([pattern]) => pattern.test(url));
    assert.ok(limit, `No upstream limit is recorded for ${url}. Check its rate limits and add it.`);
    assert.ok(
      policy.delayMs >= limit[1],
      `${url} uses policy ${policy.id} at ${policy.delayMs}ms, below the ${limit[1]}ms this upstream allows.`
    );
  }
}

export type LibraryHarness = Awaited<ReturnType<typeof createLibraryHarness>>;

/** Pass the test context so the harness can run its end-of-test checks. */
export async function createLibraryHarness(context: { after(callback: () => void): void }) {
  const web = new FakeWeb();
  brokerControl.reset(web.fetch);

  const collections: MediaCollection[] = [];
  const errors: OpenSourceError[] = [];
  const loadingStates: boolean[] = [];
  const remembered: string[] = [];
  let settledDownloads: Array<() => void> = [];
  let settings: AppSettings = defaultSettings;

  const library = new MediaLibrary({
    providers: new ProviderRegistry([new FourChanProvider(), new NHentaiProvider(), new LocalFolderProvider()]),
    getSettings: async () => settings,
    remember: async (source) => { remembered.push(source.location); },
    saveMix: async () => {},
    savedMix: async () => null,
    publishCollection: (collection, onDelivered) => {
      collections.push(collection);
      onDelivered();
    },
    publishLoading: (isLoading) => { loadingStates.push(isLoading); },
    publishError: (error) => { errors.push(error); },
    fatal: (message): never => { throw new Error(`Library protocol violation: ${message}`); },
    // The renderer acknowledges synchronously here, so the timeout never matters.
    setAcknowledgementTimer: () => 1,
    clearAcknowledgementTimer() {}
  });

  const downloadsDirectory = await mkdtemp(path.join(os.tmpdir(), "pixvitta-downloads-"));
  const downloads = new DownloadManager({
    downloadsDirectory: () => downloadsDirectory,
    publish(snapshot: DownloadActivitySnapshot) {
      if (snapshot.collectionActive) return;
      if (snapshot.rows.some((row) => row.state === "queued" || row.state === "active")) return;
      const waiting = settledDownloads;
      settledDownloads = [];
      for (const resolve of waiting) resolve();
    }
  });

  context.after(() => {
    // Ends viewing demand, so this test's prefetch stops instead of running on
    // into the next test.
    library.selectMedia(null);
    assert.deepEqual(web.unexpected, [], "A flow requested URLs the fake web does not define.");
    assertUpstreamLimitsHonored();
  });

  return {
    web,
    library,
    downloads,
    downloadsDirectory,
    errors,
    loadingStates,
    remembered,
    get collection(): MediaCollection {
      const collection = collections.at(-1);
      assert.ok(collection, "No collection has been published yet.");
      return collection;
    },
    get publishedCount(): number {
      return collections.length;
    },

    /** Opens a source the way a person does; the renderer acknowledges on success. */
    async open(location: string): Promise<boolean> {
      const opened = await library.openLocation(location);
      if (opened) library.acknowledgeRenderer();
      return opened;
    },

    /** Changes settings the way the settings view does; refresh to apply source ones. */
    changeSettings(changes: Partial<AppSettings>): void {
      settings = { ...settings, ...changes };
    },

    async refresh(): Promise<boolean> {
      const refreshed = await library.refresh();
      if (refreshed) library.acknowledgeRenderer();
      return refreshed;
    },

    /**
     * Shows an item the way the renderer does: selects it, then asks for its URL.
     * High-priority media waits for that selection by contract, so requesting an
     * unselected item at high priority would wait forever, here and in the app.
     */
    async view(item: MediaItem, { range }: { range?: string } = {}): Promise<Response> {
      library.selectMedia(item.id);
      const resource = library.resolveMediaUrl(item.url);
      assert.ok(resource, `${item.name} no longer resolves in the library.`);
      return resource.respond(
        new Request(item.url, range ? { headers: { Range: range } } : undefined),
        "high"
      );
    },

    /** Resolves once no download is queued or running. */
    downloadsSettled(): Promise<void> {
      return new Promise((resolve) => { settledDownloads.push(resolve); });
    },

    rateLimitHalts(): number {
      return brokerControl.rateLimitHalts;
    }
  };
}
