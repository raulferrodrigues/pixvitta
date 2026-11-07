import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { syntheticPng } from "../testing/fakeWeb";
import { createLibraryHarness, type LibraryHarness } from "../testing/libraryHarness";

// A refresh keeps the item being viewed selected, wherever it moved to, and
// falls back to the first item only once that item is gone.

async function folderWith(t: TestContext, names: string[]): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "pixvitta-refresh-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const name of names) await writeFile(path.join(folder, name), syntheticPng(8, 8));
  return folder;
}

function select(harness: LibraryHarness, name: string): void {
  const item = harness.collection.items.find((candidate) => candidate.name === name);
  assert.ok(item, `${name} is not in the collection.`);
  harness.library.selectMedia(item.id);
}

function selectedName(harness: LibraryHarness): string | undefined {
  const { items, selectedId } = harness.collection;
  return items.find((item) => item.id === selectedId)?.name;
}

test("refreshing a folder keeps the selected file through new files and a new file order", async (t) => {
  const harness = await createLibraryHarness(t);
  const folder = await folderWith(t, ["b.png", "c.png", "d.png", "e.png"]);
  await harness.open(folder);
  select(harness, "d.png");

  await writeFile(path.join(folder, "a.png"), syntheticPng(8, 8));
  assert.equal(await harness.refresh(), true);
  assert.equal(harness.collection.items.length, 5);
  assert.equal(selectedName(harness), "d.png");

  // Newest first reverses the folder, so d.png moves from fourth to second.
  const names = harness.collection.items.map((item) => item.name);
  await Promise.all(names.map((name, index) => {
    const time = new Date(Date.UTC(2026, 0, 1 + index));
    return utimes(path.join(folder, name), time, time);
  }));
  harness.changeSettings({ fileOrder: "modified" });
  assert.equal(await harness.refresh(), true);
  assert.deepEqual(harness.collection.items.map((item) => item.name), ["e.png", "d.png", "c.png", "b.png", "a.png"]);
  assert.equal(selectedName(harness), "d.png");
});

test("refreshing falls back to the first file once the selected one is deleted or hidden", async (t) => {
  const harness = await createLibraryHarness(t);
  const folder = await folderWith(t, [".hidden.png", "a.png", "b.png", "c.png"]);
  harness.changeSettings({ includeHidden: true });
  await harness.open(folder);

  select(harness, "c.png");
  await unlink(path.join(folder, "c.png"));
  assert.equal(await harness.refresh(), true);
  assert.equal(selectedName(harness), ".hidden.png");

  harness.changeSettings({ includeHidden: false });
  assert.equal(await harness.refresh(), true);
  assert.equal(selectedName(harness), "a.png");
});
