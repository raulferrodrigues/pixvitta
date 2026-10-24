import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createRequestBroker, RequestCancelledError } from "../requestBroker/scheduler";
import type { BrokerRequestOptions, RequestBroker, RequestPriority } from "../requestBroker";
import type { CachedFile } from "../resourceCache";
import { ResourceAcquisitions } from "./acquisitions";
import { ProviderCollectionRuntime } from "./collectionRuntime";

async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000 && !condition(); turn++) await setImmediate();
  assert.equal(condition(), true, "The expected demand did not arrive.");
}

function setup(count: number, fetch: (request: Request) => Promise<Response> = async () => new Response("image")) {
  const submitted: Array<{ index: number; priority: RequestPriority }> = [];
  const transport = createRequestBroker({ fetch, wait: async () => {}, onRateLimit() { assert.fail("Unexpected rate limit."); } });
  const broker: RequestBroker = {
    ...transport,
    request<T>(options: BrokerRequestOptions<T>) {
      submitted.push({ index: Number(new URL(options.request.url).pathname.slice(1)), priority: options.priority });
      return transport.request(options);
    }
  };
  const acquisitions = new ResourceAcquisitions(broker);
  const runtime = new ProviderCollectionRuntime(acquisitions, {
    itemCount: count,
    mediaKey: (index) => `media:${index}`,
    loadMedia: (index, io) => io.request({
      policy: { id: "images", delayMs: 0 }, request: new Request(`https://example.invalid/${index}`),
      handleResponse: async (response): Promise<CachedFile> => { await response.text(); return { filePath: `/image/${index}`, contentType: "image/jpeg", byteLength: 1 }; }
    }),
    thumbnailKey: (index) => `thumbnail:${index}`,
    loadThumbnail: async () => null
  });
  return { runtime, submitted };
}

test("five ahead, five behind, then fifteen more ahead use the agreed priorities", async () => {
  const { runtime, submitted } = setup(100);
  runtime.select(10);
  await until(() => submitted.length === 26);
  assert.deepEqual(submitted, [
    { index: 10, priority: "high" },
    ...[11,12,13,14,15,9,8,7,6,5].map((index) => ({ index, priority: "normal" })),
    ...Array.from({ length: 15 }, (value, offset) => ({ index: 16 + offset, priority: "low" }))
  ]);
  runtime.deactivate();
});

test("prefetch clamps both ends without wrapping", async () => {
  for (const selected of [0, 2]) {
    const { runtime, submitted } = setup(3);
    runtime.select(selected);
    await until(() => submitted.length === 3);
    assert.deepEqual(submitted.map(({ index }) => index), selected === 0 ? [0,1,2] : [2,1,0]);
    runtime.deactivate();
  }
});

test("an overlapping selection reuses active prefetch without aborting it", async () => {
  let release!: (response: Response) => void;
  let aborted = false;
  const { runtime, submitted } = setup(100, async (request) => {
    if (new URL(request.url).pathname === "/11") {
      request.signal.addEventListener("abort", () => { aborted = true; });
      return new Promise<Response>((resolve) => { release = resolve; });
    }
    return new Response("image");
  });
  runtime.select(10);
  await until(() => submitted.some(({ index }) => index === 11));
  runtime.select(11);
  const selected = runtime.getMedia(11, "high", new Request("https://example.invalid/selected"));
  release(new Response("image"));
  assert.equal((await selected).filePath, "/image/11");
  assert.equal(submitted.filter(({ index }) => index === 11).length, 1);
  assert.equal(aborted, false);
  runtime.deactivate();
});

test("leaving a collection cancels viewing demand but a retained download completes", async () => {
  let release!: (response: Response) => void;
  let aborted = false;
  const { runtime, submitted } = setup(100, async (request) => {
    request.signal.addEventListener("abort", () => { aborted = true; });
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  runtime.select(10);
  await until(() => submitted.length === 1);
  const viewing = runtime.getMedia(10, "high", new Request("https://example.invalid/selected"));
  const cancelled = assert.rejects(viewing, RequestCancelledError);
  const download = runtime.getMedia(10, "low", new Request("https://example.invalid/download"));
  runtime.deactivate();
  await cancelled;
  release(new Response("image"));
  assert.equal((await download).filePath, "/image/10");
  await setImmediate();
  assert.equal(submitted.length, 1);
  assert.equal(aborted, false);
});

test("a late media request cannot move selection back to an obsolete page", async () => {
  const { runtime } = setup(100);
  runtime.select(80);
  const controller = new AbortController();
  const stale = runtime.getMedia(10, "high", new Request("https://example.invalid/late", { signal: controller.signal }));
  const cancelled = assert.rejects(stale, RequestCancelledError);
  controller.abort();
  await cancelled;
  runtime.deactivate();
});

test("media arriving before its selection event waits without reverting navigation", async () => {
  const { runtime, submitted } = setup(100);
  const selected = runtime.getMedia(80, "high", new Request("https://example.invalid/selected"));
  runtime.select(10);
  runtime.select(80);
  assert.equal((await selected).filePath, "/image/80");
  assert.equal(submitted.filter(({ index }) => index === 80).length, 1);
  runtime.deactivate();
});

test("a second navigation before a selection waiter resumes cannot start obsolete media", async () => {
  const { runtime, submitted } = setup(100);
  const old = runtime.getMedia(10, "high", new Request("https://example.invalid/old"));
  const cancelled = assert.rejects(old, RequestCancelledError);
  runtime.select(10);
  runtime.select(80);
  await cancelled;
  await until(() => submitted.some(({ index }) => index === 80));
  assert.equal(submitted.some(({ index }) => index === 10), false);
  runtime.deactivate();
});
