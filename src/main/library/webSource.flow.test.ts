import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { mock, test } from "node:test";
import { addFourChanThread, addNHentaiGallery, createGate, syntheticPng } from "../testing/fakeWeb";
import { createLibraryHarness } from "../testing/libraryHarness";

// Thread and gallery IDs differ per test because the disk cache is per process.

test("a thread opens, its selected file comes over the wire once, and the rest prefetch in order", async (t) => {
  const harness = await createLibraryHarness(t);
  const thread = addFourChanThread(harness.web, { threadId: 1100, files: 4, subject: "Lunch <b>photos</b>" });

  assert.equal(await harness.open(thread.pageUrl), true);
  const { source, items, selectedId } = harness.collection;
  assert.equal(source.title, "Lunch photos");
  assert.equal(source.capabilities.canDownloadCollection, true);
  assert.deepEqual(items.map((item) => item.name), ["file-1.png", "file-2.png", "file-3.png", "file-4.png"]);
  assert.equal(selectedId, items[0].id);
  assert.deepEqual(harness.remembered, [thread.pageUrl], "A committed source is remembered once acknowledged.");

  const selected = await harness.view(items[0]);
  assert.deepEqual(Buffer.from(await selected.arrayBuffer()), thread.bodies[0]);

  // Prefetch starts by itself after the selected file and walks forward.
  await harness.web.waitForRequest(thread.mediaUrls[3]);
  assert.deepEqual(harness.web.urls("i.4cdn.org"), thread.mediaUrls);

  // Everything is cached now, so these answers cannot touch the network.
  const before = harness.web.requests.length;
  const revisit = await harness.view(items[2]);
  assert.deepEqual(Buffer.from(await revisit.arrayBuffer()), thread.bodies[2]);
  const partial = await harness.view(items[0], { range: "bytes=0-7" });
  assert.equal(partial.status, 206);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), thread.bodies[0].subarray(0, 8));
  assert.equal(harness.web.requests.length, before);
});

test("refresh honors the thread API's ten-second rule, then revalidates and keeps media IDs", async (t) => {
  const clock = Date.parse("2026-11-07T12:00:00Z");
  mock.timers.enable({ apis: ["Date"], now: clock });
  t.after(() => mock.timers.reset());
  const harness = await createLibraryHarness(t);
  const thread = addFourChanThread(harness.web, { threadId: 1200, files: 2 });

  await harness.open(thread.pageUrl);
  const firstIds = harness.collection.items.map((item) => item.id);

  assert.equal(await harness.refresh(), true);
  assert.equal(harness.web.urls("a.4cdn.org").length, 1, "A refresh inside ten seconds must not reach the API.");

  mock.timers.setTime(clock + 10_001);
  assert.equal(await harness.refresh(), true);
  const revalidation = harness.web.requests.filter((request) => request.host === "a.4cdn.org").at(-1);
  assert.ok(revalidation?.ifModifiedSince, "The refresh after ten seconds must be conditional.");
  assert.equal(revalidation.status, 304);
  assert.deepEqual(harness.collection.items.map((item) => item.id), firstIds);
  assert.equal(harness.publishedCount, 3, "Every refresh still commits, so the renderer re-establishes selection.");
});

test("a failed replacement reports its error and leaves the current source fully usable", async (t) => {
  const harness = await createLibraryHarness(t);
  const current = addFourChanThread(harness.web, { threadId: 1300, files: 1 });
  const slowDown = addFourChanThread(harness.web, { threadId: 1301, files: 1 });
  const missing = addFourChanThread(harness.web, { threadId: 1302, files: 1 });
  harness.web.route(slowDown.apiUrl, () => new Response(null, { status: 503 }));
  harness.web.route(missing.apiUrl, () => new Response(null, { status: 404 }));

  await harness.open(current.pageUrl);
  const item = harness.collection.items[0];
  assert.equal(await harness.open(slowDown.pageUrl), false);
  assert.equal(await harness.open(missing.pageUrl), false);
  assert.equal(await harness.open("https://boards.4chan.org/g/catalog"), false);

  assert.deepEqual(harness.errors, ["rate-limited", "not-found", "invalid-location"]);
  assert.equal(harness.collection.items[0].id, item.id);
  assert.equal(harness.library.getPhase(), "idle");
  assert.deepEqual(harness.loadingStates, [true, false, true, false, true, false, true, false]);
  assert.deepEqual(Buffer.from(await (await harness.view(item)).arrayBuffer()), current.bodies[0]);
  assert.deepEqual(harness.remembered, [current.pageUrl], "A source that failed to open is never remembered.");
});

test("replacing a source stops its prefetch, without cancelling work already on the wire", async (t) => {
  const harness = await createLibraryHarness(t);
  const previous = addFourChanThread(harness.web, { threadId: 1400, files: 4 });
  const next = addFourChanThread(harness.web, { threadId: 1401, files: 1 });
  const held = createGate();
  const body = previous.bodies[1];
  harness.web.route(previous.mediaUrls[1], async () => {
    await held.wait;
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/png" } });
  });

  await harness.open(previous.pageUrl);
  await (await harness.view(harness.collection.items[0])).arrayBuffer();
  await harness.web.waitForRequest(previous.mediaUrls[1]);

  await harness.open(next.pageUrl);
  held.open();
  await (await harness.view(harness.collection.items[0])).arrayBuffer();

  // Both threads share one media queue, so anything the old thread still wanted
  // would have reached the wire before the new thread's file.
  assert.deepEqual(harness.web.urls("i.4cdn.org"), [previous.mediaUrls[0], previous.mediaUrls[1], next.mediaUrls[0]]);
});

test("a collection download finishes after its source is replaced, with the bytes that were served", async (t) => {
  const harness = await createLibraryHarness(t);
  const downloaded = addFourChanThread(harness.web, { threadId: 1500, files: 3, subject: "Keep these" });
  const next = addFourChanThread(harness.web, { threadId: 1501, files: 1 });
  const held = createGate();
  const secondBody = downloaded.bodies[1];
  harness.web.route(downloaded.mediaUrls[1], async () => {
    await held.wait;
    return new Response(new Uint8Array(secondBody), { headers: { "Content-Type": "image/png" } });
  });

  await harness.open(downloaded.pageUrl);
  const items = harness.collection.items.map((item) => harness.library.resolveMediaId(item.id)!);
  const settled = harness.downloadsSettled();
  assert.equal(harness.downloads.startCollection("Keep these", items), true);
  await harness.web.waitForRequest(downloaded.mediaUrls[1]);

  await harness.open(next.pageUrl);
  held.open();
  await settled;

  const directory = path.join(harness.downloadsDirectory, "Keep these");
  assert.deepEqual((await readdir(directory)).sort(), ["file-1.png", "file-2.png", "file-3.png"]);
  for (const [index, body] of downloaded.bodies.entries()) {
    assert.deepEqual(await readFile(path.join(directory, `file-${index + 1}.png`)), body);
  }
  assert.equal(harness.downloads.getSnapshot().rows.every((row) => row.state === "complete"), true);
});

test("HTTP 429 halts every request for the rest of the session", async (t) => {
  const harness = await createLibraryHarness(t);
  const thread = addFourChanThread(harness.web, { threadId: 1600, files: 3 });
  const other = addFourChanThread(harness.web, { threadId: 1601, files: 1 });
  harness.web.route(thread.mediaUrls[0], () => new Response(null, { status: 429 }));

  await harness.open(thread.pageUrl);
  const [selected, later] = harness.collection.items;
  await assert.rejects(harness.view(selected), /halted/);
  assert.equal(harness.rateLimitHalts(), 1);

  // Nothing queued, requested afterwards, or belonging to another source moves.
  const sent = harness.web.requests.length;
  await assert.rejects(harness.view(later), /halted/);
  assert.equal(await harness.open(other.pageUrl), false);
  assert.deepEqual(harness.errors, ["unavailable"]);
  assert.equal(harness.web.requests.length, sent);
  assert.equal(harness.rateLimitHalts(), 1, "The halt is reported to the user once.");
});

test("an nhentai gallery reads its CDN once, reuses it, and refreshes only the gallery", async (t) => {
  const harness = await createLibraryHarness(t);
  const first = addNHentaiGallery(harness.web, { galleryId: 1700, pages: 2 });
  const second = addNHentaiGallery(harness.web, { galleryId: 1701, pages: 1 });

  assert.equal(await harness.open(first.pageUrl), true);
  assert.equal(harness.collection.source.title, "Sample gallery 1700");
  assert.deepEqual(harness.web.urls("nhentai.net"), [first.apiUrl, first.cdnUrl]);

  const response = await harness.view(harness.collection.items[0]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticPng(40, 30));
  assert.equal(harness.web.urls("i1.nhentai.net")[0], first.mediaUrls[0]);

  await harness.open(second.pageUrl);
  await harness.refresh();
  assert.deepEqual(harness.web.urls("nhentai.net"), [first.apiUrl, first.cdnUrl, second.apiUrl, second.apiUrl]);

  const thumbnail = harness.library.resolveMediaUrl(harness.collection.items[0].thumbnailUrl!);
  assert.ok(thumbnail);
  await (await thumbnail.respond(new Request(harness.collection.items[0].thumbnailUrl!), "normal")).arrayBuffer();
  assert.equal(harness.web.urls("t1.nhentai.net")[0], second.thumbnailUrls[0]);
});
