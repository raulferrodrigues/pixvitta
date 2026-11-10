import assert from "node:assert/strict";
import test from "node:test";
import type { MediaCollection } from "../../shared/media";
import { defaultSettings } from "../../shared/settings";
import { MediaLibrary } from "./mediaLibrary";
import { mergedItemKey, mergeSources } from "./mergedSources";
import { ProviderRegistry } from "./providers/providerRegistry";
import {
  ProviderError,
  type ProviderCollection,
  type ProviderMediaItem
} from "./providers/provider";

function item(key: string): ProviderMediaItem {
  return {
    key, name: key, kind: "image", sizeBytes: 1, lastOpenedMs: 0, addedMs: 0, modifiedMs: 0, createdMs: 0,
    media: { respond: async () => new Response(key) }, thumbnail: { kind: "none" }
  };
}

function member(
  location: string,
  keys: string[],
  options: Partial<ProviderCollection> = {},
  log: string[] = []
): ProviderCollection {
  return {
    canonicalLocation: location,
    title: location,
    capabilities: { canRefresh: true, canSort: false, canDownload: true, canDownloadCollection: true },
    remember: true,
    items: keys.map(item),
    selectedKey: keys[0] ?? null,
    viewing: {
      select: (key) => { log.push(`${location}:${key}`); },
      deactivate: () => { log.push(`${location}:deactivate`); }
    },
    ...options
  };
}

test("merging zips members in the order they were added, past the shorter ones", () => {
  const merged = mergeSources([
    member("a", ["a1", "a2", "a3", "a4"]),
    member("b", ["b1"]),
    member("c", ["c1", "c2"])
  ]);
  assert.deepEqual(merged.items.map((entry) => entry.name), ["a1", "b1", "c1", "a2", "c2", "a3", "a4"]);
  assert.deepEqual(merged.items.map((entry) => entry.sourceLabel), ["a", "b", "c", "a", "c", "a", "a"]);
  assert.equal(merged.title, "a + 2 more");
  assert.equal(mergeSources([member("a", ["1"]), member("b", ["1"])]).title, "a + b");
});

test("merged keys are unique across members and do not change when a member is added", () => {
  const first = member("a", ["same", "a2"]);
  const alone = mergeSources([first]);
  const merged = mergeSources([first, member("b", ["same"])]);
  assert.equal(new Set(merged.items.map((entry) => entry.key)).size, merged.items.length);
  for (const entry of alone.items) {
    assert.ok(merged.items.some((candidate) => candidate.key === entry.key), `${entry.key} keeps its key.`);
  }
  assert.equal(alone.selectedKey, mergedItemKey("a", "same"));
});

test("a single member keeps its order, presentation and capabilities", () => {
  const source = member("a", ["a1", "a2"], {
    origin: { label: "Origin", url: "https://example.test/a" },
    capabilities: { canRefresh: true, canSort: true, canDownload: false, canDownloadCollection: false }
  });
  const merged = mergeSources([source]);
  assert.deepEqual(merged.items.map((entry) => entry.name), ["a1", "a2"]);
  assert.ok(merged.items.every((entry) => entry.sourceLabel === undefined));
  assert.equal(merged.title, source.title);
  assert.equal(merged.origin, source.origin);
  assert.equal(merged.capabilities, source.capabilities);
  assert.equal(merged.remember, true);
});

test("a merge refreshes and sorts if any member can, downloads only if all can, and has no origin", () => {
  const merged = mergeSources([
    member("a", ["a1"], { origin: { label: "A", url: "https://example.test/a" } }),
    member("b", ["b1"], { capabilities: { canRefresh: false, canSort: true, canDownload: false, canDownloadCollection: false } })
  ]);
  assert.deepEqual(merged.capabilities, { canRefresh: true, canSort: true, canDownload: false, canDownloadCollection: false });
  assert.equal(merged.origin, undefined);
  assert.equal(merged.remember, false);
});

// In a zipper the next step lands in another member, so the others keep their
// selection, and with it their prefetch window, instead of releasing it.
test("selection goes only to the member that owns the item; the others keep theirs", () => {
  const log: string[] = [];
  const merged = mergeSources([member("a", ["a1"], {}, log), member("b", ["b1"], {}, log)]);
  merged.viewing?.select(mergedItemKey("a", "a1"));
  merged.viewing?.select(mergedItemKey("b", "b1"));
  assert.deepEqual(log.splice(0), ["a:a1", "b:b1"]);
  merged.viewing?.select("unknown");
  assert.deepEqual(log.splice(0), []);
  merged.viewing?.select(null);
  assert.deepEqual(log.splice(0), ["a:null", "b:null"]);
  merged.viewing?.deactivate();
  assert.deepEqual(log.splice(0), ["a:deactivate", "b:deactivate"]);
});

// Locations load the keys listed here, and a trailing slash names the same
// source; "broken" members fail once they are marked broken, so a refresh can
// fail after a successful add. Sources listed in unremembered do not ask to be
// kept in recents.
function createLibrary(sources: Record<string, string[]>, unremembered: string[] = []) {
  const log: string[] = [];
  const loads: string[] = [];
  const recents: string[] = [];
  const errors: string[] = [];
  const published: MediaCollection[] = [];
  const broken = new Set<string>();
  let generation = 0;
  const provider = {
    id: "trial", sourceKind: "web" as const, siteName: "Trial", matches: () => true,
    async load({ location }: { location: string }): Promise<ProviderCollection> {
      loads.push(location);
      const canonical = location.replace(/\/+$/, "");
      const keys = sources[canonical];
      if (!keys || broken.has(canonical)) throw new ProviderError("unavailable", "Cannot load.");
      return member(canonical, keys, { remember: !unremembered.includes(canonical) }, log);
    }
  };
  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]), getSettings: async () => defaultSettings,
    remember: async (source) => { recents.push(source.location); },
    publishCollection: (collection, delivered) => { published.push(collection); delivered(); },
    publishLoading() {}, publishError: (error) => { errors.push(error); }, fatal: (message): never => { throw new Error(message); },
    setAcknowledgementTimer: () => 1, clearAcknowledgementTimer() {}, createCollectionId: () => `collection-${++generation}`
  });
  const latest = () => published.at(-1) as MediaCollection;
  const names = () => latest().items.map((entry) => entry.name);
  const selectedName = () => latest().items.find((entry) => entry.id === latest().selectedId)?.name;
  const deactivated = () => log.filter((entry) => entry.endsWith(":deactivate"));
  return { library, loads, recents, errors, published, broken, latest, names, selectedName, deactivated };
}

test("adding a source keeps the collection, its item IDs and the selection, and remembers only the added source", async () => {
  const harness = createLibrary({ a: ["a1", "a2"], b: ["b1", "b2", "b3"] });
  assert.equal(await harness.library.openLocation("a"), true);
  harness.library.acknowledgeRenderer();
  const before = harness.latest();
  harness.library.selectMedia(before.items[1].id);

  assert.equal(await harness.library.addLocation("b"), "added");
  harness.library.acknowledgeRenderer();
  const after = harness.latest();
  assert.equal(after.source.id, before.source.id);
  assert.deepEqual(harness.names(), ["a1", "b1", "a2", "b2", "b3"]);
  assert.equal(after.items[0].id, before.items[0].id);
  assert.equal(harness.selectedName(), "a2");
  assert.equal(after.source.title, "a + b");
  assert.deepEqual(harness.loads, ["a", "b"], "Adding loads only the new source.");
  assert.deepEqual(harness.recents, ["a", "b"]);
});

test("each member carries its kind, site and item count, and names the recent source it was remembered as when it was", async () => {
  const harness = createLibrary({ a: ["a1"], b: ["b1", "b2"] }, ["b"]);
  await openAll(harness, ["a", "b"]);
  assert.deepEqual(harness.recents, ["a"]);
  assert.deepEqual(
    harness.latest().source.members.map(({ title, kind, siteName, itemCount, recentLocation }) => ({ title, kind, siteName, itemCount, recentLocation })),
    [
      { title: "a", kind: "web", siteName: "Trial", itemCount: 1, recentLocation: "a" },
      { title: "b", kind: "web", siteName: "Trial", itemCount: 2, recentLocation: undefined }
    ]
  );
});

test("adding a source that is already a member, or that fails, leaves the collection alone", async () => {
  const harness = createLibrary({ a: ["a1"], b: ["b1"] });
  assert.equal(await harness.library.openLocation("a"), true);
  harness.library.acknowledgeRenderer();
  assert.equal(await harness.library.addLocation("b"), "added");
  harness.library.acknowledgeRenderer();

  // A member is reported to the requester, not as an error, whether it is
  // recognized by its location or only once it loads.
  assert.equal(await harness.library.addLocation("a"), "already-added");
  assert.equal(await harness.library.addLocation(" b "), "already-added");
  assert.equal(await harness.library.addLocation("b/"), "already-added");
  assert.deepEqual(harness.loads, ["a", "b", "b/"], "Only a location that is not already a member is loaded.");
  assert.deepEqual(harness.deactivated(), ["b:deactivate"], "The duplicate it loaded is let go.");
  assert.deepEqual(harness.errors, []);
  assert.equal(await harness.library.addLocation("missing"), "not-added");
  assert.deepEqual(harness.errors, ["unavailable"]);
  assert.equal(harness.published.length, 2);
  assert.equal(harness.library.getPhase(), "idle");
  assert.ok(harness.library.resolveMediaId(harness.latest().items[1].id));
});

test("adding with nothing open opens the source", async () => {
  const harness = createLibrary({ a: ["a1"] });
  assert.equal(await harness.library.addLocation("a"), "added");
  harness.library.acknowledgeRenderer();
  assert.equal(harness.latest().source.title, "a");
  assert.equal(harness.latest().items[0].sourceLabel, undefined);
});

test("refresh reloads every member, keeps the selection by key, and fails as a whole", async () => {
  const sources = { a: ["a1", "a2"], b: ["b1"] };
  const harness = createLibrary(sources);
  await harness.library.openLocation("a");
  harness.library.acknowledgeRenderer();
  await harness.library.addLocation("b");
  harness.library.acknowledgeRenderer();
  harness.library.selectMedia(harness.latest().items[1].id);

  sources.b = ["b0", "b1"];
  assert.equal(await harness.library.refresh(), true);
  harness.library.acknowledgeRenderer();
  assert.deepEqual(harness.loads, ["a", "b", "a", "b"]);
  assert.deepEqual(harness.names(), ["a1", "b0", "a2", "b1"]);
  assert.equal(harness.selectedName(), "b1");

  harness.broken.add("b");
  assert.equal(await harness.library.refresh(), false);
  assert.deepEqual(harness.errors, ["unavailable"]);
  assert.equal(harness.published.length, 3);
  assert.ok(harness.library.resolveMediaId(harness.latest().items[0].id));
});

async function openAll(harness: ReturnType<typeof createLibrary>, locations: string[]) {
  const [first, ...rest] = locations;
  assert.equal(await harness.library.openLocation(first), true);
  harness.library.acknowledgeRenderer();
  for (const location of rest) {
    assert.equal(await harness.library.addLocation(location), "added");
    harness.library.acknowledgeRenderer();
  }
}

test("removing a source keeps the collection and its other items, reloads nothing, and deactivates only that source", async () => {
  const harness = createLibrary({ a: ["a1", "a2"], b: ["b1", "b2"], c: ["c1"] });
  await openAll(harness, ["a", "b", "c"]);
  const before = harness.latest();
  assert.deepEqual(before.source.members.map((entry) => entry.title), ["a", "b", "c"]);
  assert.deepEqual(harness.names(), ["a1", "b1", "c1", "a2", "b2"]);
  harness.library.selectMedia(before.items[1].id);

  assert.equal(await harness.library.removeSource(before.source.members[1].id), true);
  harness.library.acknowledgeRenderer();
  const after = harness.latest();
  assert.equal(after.source.id, before.source.id);
  assert.deepEqual(harness.names(), ["a1", "c1", "a2"]);
  assert.deepEqual(after.items.map((entry) => entry.id), [before.items[0].id, before.items[2].id, before.items[3].id]);
  assert.deepEqual(after.source.members, [before.source.members[0], before.source.members[2]]);
  assert.equal(harness.selectedName(), "c1", "The selection moves to the next remaining item.");
  assert.deepEqual(harness.deactivated(), ["b:deactivate"]);
  assert.deepEqual(harness.loads, ["a", "b", "c"]);
});

test("removing keeps a selection the source did not own, else falls back to the previous item, and one source is plain again", async () => {
  const harness = createLibrary({ a: ["a1", "a2"], b: ["b1", "b2", "b3"], c: ["c1"] });
  await openAll(harness, ["a", "b", "c"]);
  const [a, b, c] = harness.latest().source.members;
  // a1 b1 c1 a2 b2 b3
  harness.library.selectMedia(harness.latest().items[3].id);
  assert.equal(await harness.library.removeSource(c.id), true);
  harness.library.acknowledgeRenderer();
  assert.equal(harness.selectedName(), "a2");

  // a1 a2 b1 b2 b3 is now a1 b1 a2 b2 b3; select b3.
  harness.library.selectMedia(harness.latest().items[4].id);
  assert.equal(await harness.library.removeSource(b.id), true);
  harness.library.acknowledgeRenderer();
  assert.equal(harness.selectedName(), "a2", "With nothing after it, the selection moves to the previous item.");
  assert.equal(harness.latest().source.title, "a");
  assert.deepEqual(harness.latest().source.members, [a]);
  assert.ok(harness.latest().items.every((entry) => entry.sourceLabel === undefined));
});

test("removing the last source or an unknown one is ignored", async () => {
  const harness = createLibrary({ a: ["a1"], b: ["b1"] });
  await openAll(harness, ["a"]);
  assert.equal(await harness.library.removeSource(harness.latest().source.members[0].id), false);
  assert.equal(await harness.library.addLocation("b"), "added");
  harness.library.acknowledgeRenderer();
  assert.equal(await harness.library.removeSource("unknown"), false);
  assert.equal(harness.published.length, 2);
  assert.equal(harness.library.getPhase(), "idle");
  assert.deepEqual(harness.deactivated(), []);
});
