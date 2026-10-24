import assert from "node:assert/strict";
import test from "node:test";
import { CacheIndex } from "./cacheIndex";

test("evicts least recently used entries until the cache fits its limit", () => {
  const index = new CacheIndex({ maxBytes: 300, protectedMs: 1_000 });
  index.use("a", 100, 0);
  index.use("b", 100, 10);
  index.use("c", 100, 20);
  // Reading an entry makes it the most recently used.
  index.use("a", 100, 30);
  index.use("d", 150, 5_000);

  assert.deepEqual(index.takeEvictions(5_000), ["b", "c"]);
  assert.equal(index.byteLength, 250);
  assert.deepEqual(index.takeEvictions(5_000), []);
});

test("keeps recently used entries even when the cache is over its limit", () => {
  const index = new CacheIndex({ maxBytes: 100, protectedMs: 1_000 });
  index.use("old", 100, 0);
  index.use("selected", 100, 9_500);
  index.use("prefetched", 100, 9_800);

  assert.deepEqual(index.takeEvictions(10_000), ["old"]);
  assert.equal(index.byteLength, 200);
  assert.deepEqual(index.takeEvictions(10_600), ["selected"]);
});

test("forgotten entries no longer count toward the limit", () => {
  const index = new CacheIndex({ maxBytes: 100, protectedMs: 0 });
  index.use("corrupt", 80, 0);
  index.use("valid", 80, 1);
  index.forget("corrupt");

  assert.equal(index.byteLength, 80);
  assert.deepEqual(index.takeEvictions(2), []);
});
