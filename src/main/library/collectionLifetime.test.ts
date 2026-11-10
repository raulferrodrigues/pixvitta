import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../../shared/settings";
import type { MediaCollection } from "../../shared/media";
import { MediaLibrary } from "./mediaLibrary";
import { ProviderRegistry } from "./providers/providerRegistry";
import type { ProviderCollection } from "./providers/provider";
import { ProviderError } from "./providers/provider";

test("selection uses provider keys and only a committed replacement deactivates viewing demand", async () => {
  const selected: string[] = [];
  const deactivated: string[] = [];
  const published: MediaCollection[] = [];
  const provider = {
    id: "trial", sourceKind: "web" as const, matches: () => true,
    async load({ location }: { location: string }): Promise<ProviderCollection> {
      if (location === "failure") throw new ProviderError("unavailable", "Cannot load.");
      return {
        canonicalLocation: location, title: location, capabilities: { canRefresh: true, canSort: false, canDownload: false, canDownloadCollection: false }, remember: false,
        selectedKey: "page:1",
        viewing: { select: (key) => { selected.push(`${location}:${key}`); }, standBy() {}, deactivate: () => { deactivated.push(location); } },
        items: [{ key: "page:1", name: "Page 1", kind: "image", sizeBytes: 1, lastOpenedMs: 0, addedMs: 0, modifiedMs: 0, createdMs: 0,
          media: { respond: async () => new Response("image") }, thumbnail: { kind: "none" } }]
      };
    }
  };
  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]), getSettings: async () => defaultSettings,
    remember: async () => {}, publishCollection: (collection, delivered) => { published.push(collection); delivered(); },
    publishLoading() {}, publishError() {}, fatal: (message): never => { throw new Error(message); },
    setAcknowledgementTimer: () => 1, clearAcknowledgementTimer() {}, createCollectionId: (() => { let id = 0; return () => String(++id); })()
  });
  assert.equal(await library.openLocation("first"), true);
  library.acknowledgeRenderer();
  const firstId = published[0].items[0].id;
  library.selectMedia(firstId);
  library.selectMedia("unknown");
  assert.deepEqual(selected, ["first:page:1", "first:page:1"]);
  assert.equal(await library.openLocation("failure"), false);
  assert.deepEqual(deactivated, []);
  assert.equal(await library.openLocation("second"), true);
  assert.deepEqual(deactivated, ["first"]);
  assert.ok(library.resolveMediaId(firstId), "Previous resources survive the renderer handoff.");
  library.selectMedia(firstId);
  assert.deepEqual(selected, ["first:page:1", "first:page:1", "second:page:1"]);
  library.acknowledgeRenderer();
  assert.equal(library.resolveMediaId(firstId), null);
  assert.equal(await library.refresh(), true);
  assert.equal(published[2].items[0].id, published[1].items[0].id);
  assert.deepEqual(deactivated, ["first", "second"]);
  assert.equal(selected.at(-1), "second:page:1");
  assert.equal(selected.length, 4, "Refresh establishes selection even when IDs are unchanged.");
  library.acknowledgeRenderer();
});

test("adding a source keeps the loaded members active; only members a commit drops are deactivated", async () => {
  const log: string[] = [];
  const failing = new Set<string>();
  const loads = new Map<string, number>();
  const provider = {
    id: "trial", sourceKind: "web" as const, matches: () => true,
    async load({ location }: { location: string }): Promise<ProviderCollection> {
      if (failing.has(location)) throw new ProviderError("unavailable", "Cannot load.");
      const load = `${location}#${(loads.get(location) ?? 0) + 1}`;
      loads.set(location, (loads.get(location) ?? 0) + 1);
      return {
        canonicalLocation: location, title: location, remember: false, selectedKey: "page:1",
        // "fixed" stands for a source that cannot refresh, so a refresh reuses it.
        capabilities: { canRefresh: location !== "fixed", canSort: false, canDownload: false, canDownloadCollection: false },
        viewing: {
          select: (key) => { log.push(`${load} select ${key}`); },
          standBy: (key) => { log.push(`${load} stand by ${key}`); },
          deactivate: () => { log.push(`${load} deactivate`); }
        },
        items: [{ key: "page:1", name: `${location} 1`, kind: "image", sizeBytes: 1, lastOpenedMs: 0, addedMs: 0, modifiedMs: 0, createdMs: 0,
          media: { respond: async () => new Response("image") }, thumbnail: { kind: "none" } }]
      };
    }
  };
  const published: MediaCollection[] = [];
  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]), getSettings: async () => defaultSettings,
    remember: async () => {}, publishCollection: (collection, delivered) => { published.push(collection); delivered(); },
    publishLoading() {}, publishError() {}, fatal: (message): never => { throw new Error(message); },
    setAcknowledgementTimer: () => 1, clearAcknowledgementTimer() {}
  });
  const deactivated = () => log.filter((entry) => entry.endsWith("deactivate")).map((entry) => entry.split(" ")[0]);

  await library.openLocation("a");
  library.acknowledgeRenderer();
  assert.equal(await library.addLocation("fixed"), "added");
  assert.deepEqual(deactivated(), [], "The catalog an add replaces does not take its members down with it.");
  const firstId = published[0].items[0].id;
  assert.ok(library.resolveMediaId(firstId));
  library.acknowledgeRenderer();

  // Selecting the added member's item puts it on screen; the first stands by,
  // keeping its prefetch window for the next step back into it.
  log.length = 0;
  library.selectMedia(published[1].items[1].id);
  assert.deepEqual(log, ["fixed#1 select page:1", "a#1 stand by page:1"]);

  assert.equal(await library.refresh(), true);
  assert.deepEqual(deactivated(), ["a#1"], "Refresh deactivates the members it reloaded and keeps the ones it reused.");
  library.acknowledgeRenderer();

  failing.add("fixed");
  assert.equal(await library.addLocation("b"), "added");
  library.acknowledgeRenderer();
  failing.add("b");
  assert.equal(await library.refresh(), true);
  assert.deepEqual(deactivated(), ["a#1", "a#2"], "A member that fails to refresh stays as it was, and keeps its viewing.");
  library.acknowledgeRenderer();

  failing.clear();
  assert.equal(await library.openLocation("c"), true);
  assert.deepEqual(deactivated(), ["a#1", "a#2", "a#3", "fixed#1", "b#1"], "Opening a source replaces every member.");
  library.acknowledgeRenderer();
});
