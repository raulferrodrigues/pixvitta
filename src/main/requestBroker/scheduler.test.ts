import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createRequestBroker, RequestCancelledError } from "./scheduler";
import type { RequestPriority } from "./types";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("cancelling queued work removes it without consuming another pacing delay", async () => {
  const response = deferred<Response>();
  const cooldown = deferred<void>();
  const sent: string[] = [];
  const delays: number[] = [];
  const broker = createRequestBroker({
    fetch: async (request) => { sent.push(new URL(request.url).pathname); return sent.length === 1 ? response.promise : new Response("ok"); },
    wait: async (milliseconds) => { delays.push(milliseconds); if (delays.length === 1) await cooldown.promise; },
    onRateLimit() { assert.fail("Unexpected rate limit."); }
  });
  const submit = (path: string, priority: RequestPriority) => broker.request({
    policy: { id: "images", delayMs: 2000 }, priority,
    request: new Request(`https://example.invalid/${path}`), handleResponse: (result) => result.text()
  });
  const first = submit("first", "normal");
  const obsolete = submit("obsolete", "low");
  const cancelled = assert.rejects(obsolete.result, RequestCancelledError);
  const selected = submit("selected", "high");
  assert.equal(broker.cancel(obsolete), true);
  assert.equal(broker.cancel(obsolete), false);
  await cancelled;
  response.resolve(new Response("first"));
  await first.result;
  await setImmediate();
  assert.deepEqual(sent, ["/first"]);
  cooldown.resolve();
  assert.equal(await selected.result, "ok");
  await setImmediate();
  assert.deepEqual(sent, ["/first", "/selected"]);
  assert.deepEqual(delays, [2000, 2000]);
});

test("foreground aborts only orphaned active work, waits for cleanup, and preserves pacing", async () => {
  const cleanup = deferred<void>();
  const cooldown = deferred<void>();
  const sent: string[] = [];
  let needed = true;
  let aborted = false;
  const broker = createRequestBroker({
    fetch: async (request) => {
      sent.push(new URL(request.url).pathname);
      if (sent.length !== 1) return new Response("selected");
      return new Promise<Response>((resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
          void cleanup.promise.then(() => reject(request.signal.reason));
        }, { once: true });
      });
    },
    wait: async () => cooldown.promise,
    onRateLimit() { assert.fail("Unexpected rate limit."); }
  });
  const submit = (path: string, priority: RequestPriority) => broker.request({
    policy: { id: "images", delayMs: 2000 }, priority,
    request: new Request(`https://example.invalid/${path}`),
    interruptWhenUnneeded: () => !needed, handleResponse: (response) => response.text()
  });
  const background = submit("background", "low");
  assert.equal(broker.cancel(background, "queued"), false);
  needed = false;
  const cancelled = assert.rejects(background.result, RequestCancelledError);
  const selected = submit("selected", "high");
  assert.equal(aborted, true);
  assert.equal(background.state, "active");
  await setImmediate();
  assert.deepEqual(sent, ["/background"]);
  cleanup.resolve();
  await cancelled;
  assert.equal(background.state, "completed");
  assert.deepEqual(sent, ["/background"]);
  cooldown.resolve();
  assert.equal(await selected.result, "selected");
});

test("queued priorities can move down as well as up, and independent policy work is not interrupted", async () => {
  const response = deferred<Response>();
  const sent: string[] = [];
  let aborted = false;
  const broker = createRequestBroker({
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      sent.push(path);
      if (path === "/active") { request.signal.addEventListener("abort", () => { aborted = true; }); return response.promise; }
      return new Response(path);
    }, wait: async () => {}, onRateLimit() { assert.fail("Unexpected rate limit."); }
  });
  const submit = (path: string, priority: RequestPriority, id = "images") => broker.request({
    policy: { id, delayMs: 0 }, priority, request: new Request(`https://example.invalid/${path}`),
    interruptWhenUnneeded: () => true, handleResponse: (result) => result.text()
  });
  const active = submit("active", "low");
  const otherQueue = submit("other", "high", "pages");
  await otherQueue.result;
  assert.equal(aborted, false);
  const oldSelected = submit("old-selected", "high");
  // The high request makes the active orphan abortable. Resolve its mocked
  // transport so the worker can complete the cancellation before continuing.
  const cancelled = assert.rejects(active.result, RequestCancelledError);
  broker.setPriority(oldSelected, "low");
  const normal = submit("normal", "normal");
  response.resolve(new Response("active"));
  await cancelled;
  await Promise.all([oldSelected.result, normal.result]);
  assert.deepEqual(sent, ["/active", "/other", "/normal", "/old-selected"]);
});

test("an aborted request signal cancels queued work immediately", async () => {
  const activeResponse = deferred<Response>();
  const sent: string[] = [];
  const broker = createRequestBroker({
    fetch: async (request) => { sent.push(request.url); return activeResponse.promise; },
    wait: async () => {}, onRateLimit() { assert.fail("Unexpected rate limit."); }
  });
  const options = { policy: { id: "pages", delayMs: 0 }, priority: "normal" as const, handleResponse: (response: Response) => response.text() };
  const active = broker.request({ ...options, request: new Request("https://example.invalid/active") });
  const controller = new AbortController();
  const queued = broker.request({ ...options, request: new Request("https://example.invalid/queued", { signal: controller.signal }) });
  const rejected = assert.rejects(queued.result, RequestCancelledError);
  controller.abort();
  await rejected;
  activeResponse.resolve(new Response("ok"));
  await active.result;
  assert.equal(sent.length, 1);
});

test("HTTP 429 still halts every policy and refuses later requests", async () => {
  const limit = deferred<Response>();
  let halts = 0;
  let aborts = 0;
  const broker = createRequestBroker({
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/limit") return limit.promise;
      return new Promise<Response>((resolve, reject) => request.signal.addEventListener("abort", () => {
        aborts++;
        reject(request.signal.reason);
      }, { once: true }));
    }, wait: async () => {}, onRateLimit() { halts++; }
  });
  const submit = (path: string, id: string) => broker.request({
    policy: { id, delayMs: 0 }, priority: "normal", request: new Request(`https://example.invalid/${path}`),
    handleResponse: (response) => response.text()
  });
  const limited = submit("limit", "pages");
  const active = submit("active", "images");
  const queued = submit("queued", "images");
  const rejected = [limited, active, queued].map((task) => assert.rejects(task.result, /halted/));
  limit.resolve(new Response(null, { status: 429 }));
  await Promise.all(rejected);
  await assert.rejects(submit("later", "thumbnails").result, /halted/);
  assert.equal(halts, 1);
  assert.equal(aborts, 1);
});
