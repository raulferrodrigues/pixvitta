import assert from "node:assert/strict";
import test from "node:test";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import type { OpenSourceRequest } from "../../shared/media";
import { createViewerStore } from "./viewerStore";

const gallery = "https://exhentai.org/g/42/abcdef1234/";

function setup() {
  const requests: OpenSourceRequest[] = [];
  let completeSignIn!: (signedIn: boolean) => void;
  const api = {
    openSource(request: OpenSourceRequest) { requests.push(request); },
    signIn: () => new Promise<boolean>((resolve) => { completeSignIn = resolve; }),
    refreshSource() {}
  } satisfies Pick<PixvittaApi, "openSource" | "signIn" | "refreshSource">;
  const store = createViewerStore(api as unknown as PixvittaApi);
  return {
    store,
    // Main answers an ExHentai gallery without a sign-in with this error.
    async openGallery() {
      await store.getState().openLocation(gallery);
      store.getState().showSourceError("authentication-required", "exhentai");
    },
    requests,
    completeSignIn(signedIn: boolean) { completeSignIn(signedIn); }
  };
}

test("successful sign-in retries the gallery when its source request is still current", async () => {
  const { store, requests, completeSignIn, openGallery } = setup();
  await openGallery();
  const pending = store.getState().signInForSource();
  completeSignIn(true);
  await pending;
  assert.deepEqual(requests, [
    { kind: "location", location: gallery },
    { kind: "location", location: gallery }
  ]);
});

test("successful sign-in cannot override a newer source command", async () => {
  for (const nextLocation of ["/new/folder", "https://exhentai.org/g/43/abcdef1234/", gallery]) {
    const { store, requests, completeSignIn, openGallery } = setup();
    await openGallery();
    const pending = store.getState().signInForSource();
    await store.getState().openLocation(nextLocation);
    completeSignIn(true);
    await pending;
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { kind: "location", location: nextLocation });
  }
});

test("cancelled sign-in does not retry the gallery", async () => {
  const { store, requests, completeSignIn, openGallery } = setup();
  await openGallery();
  const pending = store.getState().signInForSource();
  completeSignIn(false);
  await pending;
  assert.equal(requests.length, 1);
});

test("a collection delivered while sign-in is open prevents a stale retry", async () => {
  const { store, requests, completeSignIn, openGallery } = setup();
  await openGallery();
  const pending = store.getState().signInForSource();
  store.getState().openCollection({
    source: {
      id: "new-source",
      title: "Folder",
      capabilities: { canRefresh: true, canSort: true, canDownload: false, canDownloadCollection: false, canOpenOrigin: false },
      members: []
    },
    items: [],
    selectedId: null
  });
  completeSignIn(true);
  await pending;
  assert.equal(requests.length, 1);
  assert.equal(store.getState().source?.id, "new-source");
});

test("refreshing the current source while signing in prevents a stale retry", async () => {
  const { store, requests, completeSignIn, openGallery } = setup();
  await openGallery();
  store.getState().openCollection({
    source: {
      id: "current-source",
      title: "Gallery",
      capabilities: { canRefresh: true, canSort: false, canDownload: true, canDownloadCollection: true, canOpenOrigin: true },
      members: []
    },
    items: [],
    selectedId: null
  });
  const pending = store.getState().signInForSource();
  await store.getState().refreshSource();
  completeSignIn(true);
  await pending;
  assert.equal(requests.length, 1);
});

test("an obsolete media failure after navigation does not mark that page broken", () => {
  const { store } = setup();
  store.getState().openCollection({
    source: { id: "source", title: "Gallery", capabilities: { canRefresh: true, canSort: false, canDownload: true, canDownloadCollection: true, canOpenOrigin: true }, members: [] },
    selectedId: "first",
    items: ["first", "second"].map((id) => ({ id, name: id, url: `pixvitta-media://media/${id}`, thumbnailUrl: null,
      kind: "image", sizeBytes: 1, lastOpenedMs: 0, addedMs: 0, modifiedMs: 0, createdMs: 0 }))
  });
  store.getState().selectMedia(1);
  store.getState().markMediaBroken("first");
  assert.equal(store.getState().mediaErrors.has("first"), false);
  store.getState().markMediaBroken("second");
  assert.equal(store.getState().mediaErrors.has("second"), true);
});

function videoCollection(sourceId: string, itemIds: string[]) {
  return {
    source: { id: sourceId, title: "Videos", capabilities: { canRefresh: true, canSort: true, canDownload: false, canDownloadCollection: false, canOpenOrigin: false }, members: [] },
    selectedId: itemIds[0],
    items: itemIds.map((id) => ({ id, name: id, url: `pixvitta-media://media/${id}`, thumbnailUrl: null,
      kind: "video" as const, sizeBytes: 1, lastOpenedMs: 0, addedMs: 0, modifiedMs: 0, createdMs: 0 }))
  };
}

test("video playback state follows whether the video element survives the transition", () => {
  const { store } = setup();
  const { getState } = store;
  getState().openCollection(videoCollection("source", ["first", "second"]));
  getState().setVideoPlaying(true);

  // A refresh that keeps the selected item keeps its playing element.
  getState().openCollection(videoCollection("source", ["first", "second"]));
  assert.equal(getState().isVideoPlaying, true);

  // A refresh that selects a different item mounts a new, paused element.
  getState().openCollection(videoCollection("source", ["second", "first"]));
  assert.equal(getState().isVideoPlaying, false);

  // Switching view mode unmounts the element, which then reports nothing.
  getState().setVideoPlaying(true);
  getState().toggleViewMode();
  assert.equal(getState().isVideoPlaying, false);
});

// A member of the open mix that failed for want of sign-in has no request to
// retry: signing in refreshes the collection, which tries it again.
test("signing in for a failed member refreshes the collection it belongs to, and retries no request", async () => {
  const requests: OpenSourceRequest[] = [];
  const signIns: Array<(signedIn: boolean) => void> = [];
  let refreshes = 0;
  const api = {
    openSource(request: OpenSourceRequest) { requests.push(request); },
    signIn: () => new Promise<boolean>((resolve) => { signIns.push(resolve); }),
    refreshSource() { refreshes += 1; }
  } satisfies Pick<PixvittaApi, "openSource" | "signIn" | "refreshSource">;
  const store = createViewerStore(api as unknown as PixvittaApi);
  const collection = (id: string) => ({
    source: {
      id,
      title: id,
      capabilities: { canRefresh: true, canSort: false, canDownload: false, canDownloadCollection: false, canOpenOrigin: false },
      members: [{ id: "source-1", title: "Gallery", kind: "web" as const, itemCount: 0, error: "authentication-required" as const, errorAccountId: "exhentai" }]
    },
    items: [],
    selectedId: null
  });
  store.getState().openCollection(collection("mix"));

  const closed = store.getState().signInAndRefresh("exhentai");
  signIns[0](false);
  await closed;
  assert.equal(refreshes, 0, "Closing the sign-in window changes nothing.");

  const signedIn = store.getState().signInAndRefresh("exhentai");
  signIns[1](true);
  await signedIn;
  assert.equal(refreshes, 1);

  // Another collection opened during sign-in is not refreshed on its behalf.
  const replaced = store.getState().signInAndRefresh("exhentai");
  store.getState().openCollection(collection("other"));
  signIns[2](true);
  await replaced;
  assert.equal(refreshes, 1);
  assert.deepEqual(requests, []);
});
