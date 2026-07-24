import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../../shared/settings";
import { MediaLibrary } from "./mediaLibrary";
import {
  ProviderError,
  ProviderRegistry,
  type MediaProvider,
  type ProviderCollection
} from "./providers";

function providerCollection(
  location: string,
  key = location
): ProviderCollection {
  return {
    canonicalLocation: location,
    title: `Source ${location}`,
    capabilities: {
      canDownload: true,
      canRefresh: true,
      canSort: false
    },
    remember: true,
    items: [
      {
        key,
        name: `${key}.jpg`,
        kind: "image",
        sizeBytes: 1,
        lastOpenedMs: 0,
        addedMs: 0,
        modifiedMs: 0,
        createdMs: 0,
        media: {
          async respond() {
            return new Response(key);
          }
        },
        thumbnail: {
          kind: "direct",
          url: `https://example.test/${key}.jpg`
        }
      }
    ],
    selectedKey: key
  };
}

type PublishedCollection = {
  collection: Parameters<
    ConstructorParameters<typeof MediaLibrary>[0]["publishCollection"]
  >[0];
  onDelivered(): void;
};

function createLibrary(
  provider: MediaProvider,
  options: {
    ids?: string[];
    remembered?: string[];
    loading?: boolean[];
    errors?: string[];
  } = {}
) {
  const published: PublishedCollection[] = [];
  const timers: Array<{ callback(): void; timeoutMs: number }> = [];
  const ids = [...(options.ids ?? ["collection-1"])];

  const library = new MediaLibrary({
    providers: new ProviderRegistry([provider]),
    getSettings: async () => defaultSettings,
    remember: async (location) => {
      options.remembered?.push(location);
    },
    publishCollection(collection, onDelivered) {
      published.push({ collection, onDelivered });
    },
    publishLoading(isLoading) {
      options.loading?.push(isLoading);
    },
    publishError(error) {
      options.errors?.push(error);
    },
    fatal(message): never {
      throw new Error(`fatal: ${message}`);
    },
    setAcknowledgementTimer(callback, timeoutMs) {
      const timer = { callback, timeoutMs };
      timers.push(timer);
      return timer;
    },
    clearAcknowledgementTimer() {},
    createCollectionId: () => ids.shift() ?? "unexpected-collection"
  });

  return { library, published, timers };
}

function deliverAndAcknowledge(
  library: MediaLibrary,
  published: PublishedCollection[]
): void {
  published.at(-1)?.onDelivered();
  library.acknowledgeRenderer();
}

test("opens and refreshes through one authoritative commit pipeline", async () => {
  const loads: Array<{ location: string; refresh: boolean }> = [];
  const remembered: string[] = [];
  const loading: boolean[] = [];
  const provider: MediaProvider = {
    matches: (location) => location.startsWith("example:"),
    async load(request) {
      loads.push({ location: request.location, refresh: request.refresh });
      return providerCollection(request.location.toLowerCase());
    }
  };
  const { library, published, timers } = createLibrary(provider, {
    ids: ["collection-1"],
    remembered,
    loading
  });

  assert.equal(await library.openLocation("example:SOURCE"), true);
  assert.equal(library.getPhase(), "awaiting-renderer");
  assert.equal(published[0]?.collection.source.id, "collection-1");
  assert.deepEqual(remembered, ["example:source"]);

  published[0]?.onDelivered();
  assert.equal(timers[0]?.timeoutMs, 1_000);
  library.acknowledgeRenderer();
  assert.equal(library.getPhase(), "idle");

  assert.equal(await library.refresh(), true);
  assert.equal(published[1]?.collection.source.id, "collection-1");
  deliverAndAcknowledge(library, published);
  assert.deepEqual(loads, [
    { location: "example:SOURCE", refresh: false },
    { location: "example:source", refresh: true }
  ]);
  assert.deepEqual(loading, [true, false, true, false]);
});

test("collection-changing commands are ignored throughout the critical zone", async () => {
  let resolveLoad: ((collection: ProviderCollection) => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let loadCount = 0;
  const provider: MediaProvider = {
    matches: () => true,
    async load(request) {
      loadCount += 1;
      markStarted?.();
      return new Promise<ProviderCollection>((resolve) => {
        resolveLoad = resolve;
      });
    }
  };
  const { library, published } = createLibrary(provider);

  const firstOpen = library.openLocation("example:first");
  await started;
  assert.equal(library.getPhase(), "loading");
  assert.equal(await library.openLocation("example:ignored"), false);
  assert.equal(await library.refresh(), false);

  resolveLoad?.(providerCollection("example:first"));
  assert.equal(await firstOpen, true);
  assert.equal(library.getPhase(), "awaiting-renderer");
  assert.equal(await library.openLocation("example:also-ignored"), false);
  assert.equal(loadCount, 1);

  deliverAndAcknowledge(library, published);
});

test("a provider failure preserves the active collection and registry", async () => {
  const errors: string[] = [];
  const provider: MediaProvider = {
    matches: () => true,
    async load(request) {
      if (request.location === "example:broken") {
        throw new ProviderError("unavailable", "offline");
      }
      return providerCollection(request.location, "working");
    }
  };
  const { library, published } = createLibrary(provider, {
    ids: ["collection-1", "collection-2"],
    errors
  });

  assert.equal(await library.openLocation("example:working"), true);
  const oldUrl = published[0]?.collection.items[0]?.url;
  deliverAndAcknowledge(library, published);

  assert.equal(await library.openLocation("example:broken"), false);
  assert.equal(library.getPhase(), "idle");
  assert.equal(errors.at(-1), "unavailable");
  assert.ok(oldUrl);
  assert.ok(library.resolveMediaUrl(oldUrl));
});

test("the previous registry survives only until the renderer acknowledges", async () => {
  const provider: MediaProvider = {
    matches: () => true,
    async load(request) {
      return providerCollection(request.location);
    }
  };
  const { library, published } = createLibrary(provider, {
    ids: ["collection-1", "collection-2"]
  });

  await library.openLocation("example:old");
  const oldUrl = published[0]!.collection.items[0]!.url;
  deliverAndAcknowledge(library, published);

  await library.openLocation("example:new");
  const newUrl = published[1]!.collection.items[0]!.url;
  assert.ok(library.resolveMediaUrl(oldUrl));
  assert.ok(library.resolveMediaUrl(newUrl));

  deliverAndAcknowledge(library, published);
  assert.equal(library.resolveMediaUrl(oldUrl), null);
  assert.ok(library.resolveMediaUrl(newUrl));
});

test("missing or unexpected renderer acknowledgements are fatal", async () => {
  const provider: MediaProvider = {
    matches: () => true,
    async load(request) {
      return providerCollection(request.location);
    }
  };
  const { library, published, timers } = createLibrary(provider);

  assert.throws(
    () => library.acknowledgeRenderer(),
    /fatal: Unexpected renderer acknowledgement/
  );

  await library.openLocation("example:source");
  published[0]?.onDelivered();
  assert.throws(
    () => timers[0]?.callback(),
    /fatal: Renderer did not acknowledge/
  );
});
