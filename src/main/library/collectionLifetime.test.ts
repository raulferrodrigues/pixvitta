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
        canonicalLocation: location, title: location, capabilities: { canRefresh: true, canSort: false }, remember: false,
        selectedKey: "page:1",
        viewing: { select: (key) => { selected.push(`${location}:${key}`); }, deactivate: () => { deactivated.push(location); } },
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
