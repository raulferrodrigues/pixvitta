import assert from "node:assert/strict";
import test from "node:test";
import type { MediaCollection } from "../../shared/media";
import { defaultSettings } from "../../shared/settings";
import { MediaLibrary } from "./mediaLibrary";
import {
  ProviderError,
  ProviderRegistry,
  type MediaProvider,
  type ProviderCollection
} from "./providers";

function providerCollection(location: string): ProviderCollection {
  return {
    canonicalLocation: location,
    title: "Example source",
    capabilities: {
      canDownload: false,
      canRefresh: true,
      canSort: false
    },
    remember: true,
    items: [],
    selectedKey: null
  };
}

function publicCollection(
  collectionId: string,
  collection: ProviderCollection
): MediaCollection {
  return {
    source: {
      id: collectionId,
      title: collection.title,
      capabilities: {
        canDownload: collection.capabilities.canDownload,
        canRefresh: collection.capabilities.canRefresh,
        canSort: collection.capabilities.canSort,
        canOpenOrigin: !!collection.origin
      }
    },
    items: [],
    selectedId: null
  };
}

test("opens and refreshes locations through the matching provider", async () => {
  const loads: Array<{ location: string; refresh: boolean }> = [];
  const remembered: string[] = [];
  const provider: MediaProvider = {
    matches: (location) => location.startsWith("example:"),
    async load(request) {
      loads.push({ location: request.location, refresh: request.refresh });
      return providerCollection(request.location.toLowerCase());
    }
  };
  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]),
    getSettings: async () => defaultSettings,
    activate: publicCollection,
    remember: async (location) => {
      remembered.push(location);
    },
    createCollectionId: () => "collection-1"
  });

  const opened = await library.openLocation("example:SOURCE");
  assert.equal(opened.source.id, "collection-1");
  assert.deepEqual(remembered, ["example:source"]);

  const refreshed = await library.refresh(opened.source.id);
  assert.equal(refreshed.source.id, opened.source.id);
  assert.deepEqual(loads, [
    { location: "example:SOURCE", refresh: false },
    { location: "example:source", refresh: true }
  ]);
});

test("rejects locations unsupported by installed providers", async () => {
  const library = new MediaLibrary({
    providers: new ProviderRegistry([]),
    getSettings: async () => defaultSettings,
    activate: publicCollection,
    remember: async () => undefined
  });

  await assert.rejects(
    library.openLocation("https://unsupported.example/media"),
    (error) =>
      error instanceof ProviderError && error.code === "unsupported-location"
  );
});
