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

  const opened = await library.beginRequest().openLocation("example:SOURCE");
  assert.ok(opened);
  assert.equal(opened.source.id, "collection-1");
  assert.deepEqual(remembered, ["example:source"]);

  const refreshed = await library.beginRequest().refresh(opened.source.id);
  assert.ok(refreshed);
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
    library.beginRequest().openLocation("https://unsupported.example/media"),
    (error) =>
      error instanceof ProviderError && error.code === "unsupported-location"
  );
});

test("a stale provider load cannot replace the active collection", async () => {
  let finishSlowLoad: ((collection: ProviderCollection) => void) | undefined;
  let markSlowLoadStarted: (() => void) | undefined;
  const slowLoadStarted = new Promise<void>((resolve) => {
    markSlowLoadStarted = resolve;
  });
  const activations: string[] = [];
  const provider: MediaProvider = {
    matches: (location) => location.startsWith("example:"),
    async load(request) {
      if (request.location === "example:slow") {
        return new Promise<ProviderCollection>((resolve) => {
          finishSlowLoad = resolve;
          markSlowLoadStarted?.();
        });
      }
      return providerCollection(request.location);
    }
  };
  let collectionNumber = 0;
  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]),
    getSettings: async () => defaultSettings,
    activate: (collectionId, collection) => {
      activations.push(collection.canonicalLocation);
      return publicCollection(collectionId, collection);
    },
    remember: async () => undefined,
    createCollectionId: () => `collection-${++collectionNumber}`
  });

  const staleOpen = library.beginRequest().openLocation("example:slow");
  await slowLoadStarted;
  const activeCollection = await library
    .beginRequest()
    .openLocation("example:active");
  assert.ok(activeCollection);

  assert.ok(finishSlowLoad);
  finishSlowLoad(providerCollection("example:slow"));
  assert.equal(await staleOpen, null);
  assert.deepEqual(activations, ["example:active"]);
  assert.equal(activeCollection.source.id, "collection-1");
});

test("a stale refresh cannot replace a newer collection", async () => {
  let finishRefresh: ((collection: ProviderCollection) => void) | undefined;
  let markRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  const activations: string[] = [];
  const provider: MediaProvider = {
    matches: (location) => location.startsWith("example:"),
    async load(request) {
      if (request.refresh) {
        return new Promise<ProviderCollection>((resolve) => {
          finishRefresh = resolve;
          markRefreshStarted?.();
        });
      }
      return providerCollection(request.location);
    }
  };
  let collectionNumber = 0;
  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]),
    getSettings: async () => defaultSettings,
    activate: (collectionId, collection) => {
      activations.push(collection.canonicalLocation);
      return publicCollection(collectionId, collection);
    },
    remember: async () => undefined,
    createCollectionId: () => `collection-${++collectionNumber}`
  });

  const originalCollection = await library
    .beginRequest()
    .openLocation("example:original");
  assert.ok(originalCollection);

  const staleRefresh = library
    .beginRequest()
    .refresh(originalCollection.source.id);
  await refreshStarted;
  const activeCollection = await library
    .beginRequest()
    .openLocation("example:active");
  assert.ok(activeCollection);

  assert.ok(finishRefresh);
  finishRefresh(providerCollection("example:original-refreshed"));
  assert.equal(await staleRefresh, null);
  assert.deepEqual(activations, ["example:original", "example:active"]);
  assert.equal(activeCollection.source.id, "collection-2");
});
