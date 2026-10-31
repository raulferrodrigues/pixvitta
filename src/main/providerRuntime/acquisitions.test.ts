import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createRequestBroker, RequestCancelledError } from "../requestBroker/scheduler";
import { ResourceAcquisitions, type ProviderIO } from "./acquisitions";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function resources(fetch: (request: Request) => Promise<Response>) {
  return new ResourceAcquisitions(createRequestBroker({ fetch, wait: async () => {}, onRateLimit() { assert.fail("Unexpected rate limit."); } }));
}

const request = (io: ProviderIO, path: string, policy = "images") => io.request({
  policy: { id: policy, delayMs: 0 }, request: new Request(`https://example.invalid/${path}`),
  handleResponse: (response) => response.text()
});

test("a download keeps a shared fetch alive after its viewing owner leaves", async () => {
  const response = deferred<Response>();
  let count = 0;
  let aborted = false;
  const runtime = resources(async (upstream) => { count++; upstream.signal.addEventListener("abort", () => { aborted = true; }); return response.promise; });
  const viewing = runtime.acquire("image", (io) => request(io, "image"), "normal");
  const download = runtime.acquire("image", (io) => request(io, "image"), "low");
  await setImmediate();
  const cancelled = assert.rejects(viewing.result, RequestCancelledError);
  viewing.release();
  await cancelled;
  response.resolve(new Response("image"));
  assert.equal(await download.result, "image");
  assert.equal(aborted, false);
  assert.equal(count, 1);
});

test("an orphan finishes its active stage but cannot submit the next stage", async () => {
  const response = deferred<Response>();
  const sent: string[] = [];
  const runtime = resources(async (upstream) => { sent.push(new URL(upstream.url).pathname); return response.promise; });
  const lease = runtime.acquire("image", async (io) => { await request(io, "html", "pages"); return request(io, "image"); }, "normal");
  await setImmediate();
  const cancelled = assert.rejects(lease.result, RequestCancelledError);
  lease.release();
  await cancelled;
  response.resolve(new Response("html"));
  await setImmediate();
  assert.deepEqual(sent, ["/html"]);
});

test("shared index demand survives one consumer cancelling and inherits foreground priority", async () => {
  const blocker = deferred<Response>();
  const sent: string[] = [];
  const broker = createRequestBroker({
    fetch: async (upstream) => { const path = new URL(upstream.url).pathname; sent.push(path); return path === "/blocker" ? blocker.promise : new Response(path); },
    wait: async () => {}, onRateLimit() { assert.fail("Unexpected rate limit."); }
  });
  const active = broker.request({ policy: { id: "pages", delayMs: 0 }, priority: "normal", request: new Request("https://example.invalid/blocker"), handleResponse: (response) => response.text() });
  const runtime = new ResourceAcquisitions(broker);
  const load = (io: ProviderIO) => io.use("index", (indexIO) => request(indexIO, "index", "pages"));
  const prefetch = runtime.acquire("media", load, "low");
  const thumbnail = runtime.acquire("thumbnail", load, "normal");
  await setImmediate();
  const cancelled = assert.rejects(prefetch.result, RequestCancelledError);
  prefetch.release();
  await cancelled;
  const competing = broker.request({ policy: { id: "pages", delayMs: 0 }, priority: "normal", request: new Request("https://example.invalid/competing"), handleResponse: (response) => response.text() });
  thumbnail.setPriority("high");
  blocker.resolve(new Response("blocker"));
  await active.result;
  assert.equal(await thumbnail.result, "/index");
  await competing.result;
  assert.deepEqual(sent, ["/blocker", "/index", "/competing"]);
});

test("foreground interrupts an orphan, and revisiting it never joins the cancelled acquisition", async () => {
  const sent: string[] = [];
  const runtime = resources(async (upstream) => {
    const path = new URL(upstream.url).pathname;
    sent.push(path);
    if (sent.length === 1) return new Promise<Response>((resolve, reject) => upstream.signal.addEventListener("abort", () => reject(upstream.signal.reason), { once: true }));
    return new Response(path);
  });
  const old = runtime.acquire("old", (io) => request(io, "old"), "low");
  await setImmediate();
  const cancelled = assert.rejects(old.result, RequestCancelledError);
  old.release();
  await cancelled;
  const selected = runtime.acquire("selected", (io) => request(io, "selected"), "high");
  assert.equal(await selected.result, "/selected");
  const revisited = runtime.acquire("old", (io) => request(io, "old"), "high");
  assert.equal(await revisited.result, "/old");
  assert.deepEqual(sent, ["/old", "/selected", "/old"]);
});

test("an active fetch becomes interruptible when its last download owner leaves after foreground queues", async () => {
  let aborted = false;
  const runtime = resources(async (upstream) => {
    if (new URL(upstream.url).pathname === "/old") {
      return new Promise<Response>((resolve, reject) => upstream.signal.addEventListener("abort", () => {
        aborted = true;
        reject(upstream.signal.reason);
      }, { once: true }));
    }
    return new Response("selected");
  });
  const old = runtime.acquire("old", (io) => request(io, "old"), "low");
  await setImmediate();
  const selected = runtime.acquire("selected", (io) => request(io, "selected"), "high");
  await setImmediate();
  assert.equal(aborted, false);
  const cancelled = assert.rejects(old.result, RequestCancelledError);
  old.release();
  await cancelled;
  assert.equal(await selected.result, "selected");
  assert.equal(aborted, true);
});
