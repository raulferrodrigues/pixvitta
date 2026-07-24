import assert from "node:assert/strict";
import test from "node:test";
import type {
  DownloadMediaResult,
  MediaCollection
} from "../../shared/media";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { createViewerStore } from "./viewerStore";

function collection(itemIds = ["a", "b"]): MediaCollection {
  const item = (id: string) => ({
    id,
    name: `${id}.jpg`,
    url: `pixvitta-media://media/${id}`,
    thumbnailUrl: `pixvitta-media://thumbnail/${id}`,
    kind: "image" as const,
    sizeBytes: 1,
    lastOpenedMs: 0,
    addedMs: 0,
    modifiedMs: 0,
    createdMs: 0
  });

  return {
    source: {
      id: "source-1",
      title: "Example source",
      capabilities: {
        canDownload: true,
        canRefresh: true,
        canSort: false,
        canOpenOrigin: false
      }
    },
    items: itemIds.map(item),
    selectedId: itemIds[0] ?? null
  };
}

function createApi(
  overrides: Partial<PixvittaApi>
): PixvittaApi {
  return {
    getRecentFolders: async () => [],
    ...overrides
  } as PixvittaApi;
}

test("a failed refresh preserves the current collection", async () => {
  const store = createViewerStore(createApi({
    refreshSource: () => {
      store.getState().setSourceLoading(true);
      store.getState().setSourceLoading(false);
      store.getState().showSourceError("unavailable");
    }
  }));
  store.getState().openCollection(collection());

  await store.getState().refreshSource();

  assert.equal(store.getState().loadState, "ready");
  assert.deepEqual(store.getState().items.map((item) => item.id), ["a", "b"]);
  assert.equal(store.getState().sourceOpenError, "unavailable");
});

test("an older download cannot complete a newer attempt for the same item", async () => {
  const pendingDownloads: Array<
    (result: DownloadMediaResult) => void
  > = [];
  const store = createViewerStore(createApi({
    downloadMedia: async () =>
      new Promise<DownloadMediaResult>((resolve) => {
        pendingDownloads.push(resolve);
      })
  }));
  store.getState().openCollection(collection());

  const firstDownload = store.getState().downloadCurrentMedia();
  store.getState().goNext();
  store.getState().goPrevious();
  const secondDownload = store.getState().downloadCurrentMedia();

  pendingDownloads[0]({ ok: true, fileName: "old-a.jpg" });
  await firstDownload;
  assert.equal(store.getState().downloadState, "downloading");
  assert.equal(store.getState().downloadedFileName, null);

  pendingDownloads[1]({ ok: true, fileName: "new-a.jpg" });
  await secondDownload;
  assert.equal(store.getState().downloadState, "downloaded");
  assert.equal(store.getState().downloadedFileName, "new-a.jpg");
});

test("no-op navigation does not allow a duplicate download", async () => {
  const pendingDownloads: Array<
    (result: DownloadMediaResult) => void
  > = [];
  const store = createViewerStore(createApi({
    downloadMedia: async () =>
      new Promise<DownloadMediaResult>((resolve) => {
        pendingDownloads.push(resolve);
      })
  }));
  store.getState().openCollection(collection(["a"]));

  const download = store.getState().downloadCurrentMedia();
  store.getState().goNext();
  store.getState().goPrevious();
  store.getState().selectMedia(0);
  await store.getState().downloadCurrentMedia();

  assert.equal(pendingDownloads.length, 1);
  assert.equal(store.getState().downloadState, "downloading");

  pendingDownloads[0]({ ok: true, fileName: "a.jpg" });
  await download;
  assert.equal(store.getState().downloadState, "downloaded");
  assert.equal(store.getState().downloadedFileName, "a.jpg");
});
