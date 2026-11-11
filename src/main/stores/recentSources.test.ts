import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RecentEntry, RecentSourceInput } from "../../shared/recentSources";
import { RecentSourcesStore } from "./recentSources";

function source(name: string): RecentSourceInput {
  return { location: `/media/${name}`, title: name, providerId: "local-folder", kind: "folder" };
}

// A store on a file of its own, with a clock that moves a millisecond a call.
async function createStore(contents?: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "pixvitta-recents-"));
  const file = path.join(directory, "recent-sources.json");
  if (contents !== undefined) await writeFile(file, JSON.stringify(contents));
  let clock = 1_000;
  const open = () => new RecentSourcesStore(file, path.join(directory, "recent-folders.json"), () => ++clock);
  const store = open();
  await store.load();
  return {
    store,
    stored: async () => JSON.parse(await readFile(file, "utf8")) as unknown,
    // The same file read again, as on the next launch.
    reload: async () => open().load(),
    cleanUp: () => rm(directory, { recursive: true, force: true })
  };
}

// Each entry as its title, with "*" for a pinned mix.
function titles(entries: RecentEntry[]): string[] {
  return entries.map((entry) => (entry.kind === "mix" && entry.pinned ? `*${entry.title}` : entry.title));
}

test("a recents file from before mixes loads as the same sources, in the same order", async (t) => {
  const before = [
    { location: "https://boards.4chan.org/g/thread/1000", title: "Sample thread", providerId: "four-chan", kind: "web", openedMs: 30 },
    { location: "/media/holiday", title: "Holiday", providerId: "local-folder", kind: "folder", openedMs: 20 },
    { location: "/media/archive", title: "Archive", providerId: "local-folder", kind: "folder", openedMs: 10 }
  ];
  const { store, cleanUp } = await createStore(before);
  t.after(cleanUp);
  assert.deepEqual(store.get(), before);
});

test("a saved mix is stored beside sources with its members in order, and reads back the same", async (t) => {
  const { store, stored, reload, cleanUp } = await createStore();
  t.after(cleanUp);
  await store.add(source("a"));
  await store.saveMix({ id: "mix-1", members: [source("b"), source("a")] });

  assert.deepEqual(await stored(), [
    { kind: "mix", id: "mix-1", pinned: false, members: [source("b"), source("a")], openedMs: 1_002 },
    { ...source("a"), openedMs: 1_001 }
  ]);
  assert.deepEqual(titles(store.get()), ["b + a", "a"]);
  assert.deepEqual(await reload(), store.get());
  assert.deepEqual(store.getMix("mix-1"), { id: "mix-1", members: [source("b"), source("a")] });
});

test("unreadable entries are skipped without losing the rest, and a mix needs two sources", async (t) => {
  const { store, cleanUp } = await createStore([
    { ...source("a"), openedMs: 5 },
    { kind: "mix", id: "one", pinned: true, members: [source("a"), source("a")], openedMs: 4 },
    { kind: "mix", id: "", members: [source("a"), source("b")], openedMs: 3 },
    { kind: "mix", id: "two", pinned: "yes", name: "  ", members: [source("a"), { title: "no location" }, source("b")], openedMs: 2 },
    { kind: "unknown", location: "/media/c", title: "c", providerId: "local-folder", openedMs: 1 }
  ]);
  t.after(cleanUp);
  assert.deepEqual(store.get(), [
    { ...source("a"), openedMs: 5 },
    { kind: "mix", id: "two", pinned: false, members: [source("a"), source("b")], openedMs: 2, title: "a + b" }
  ]);
});

test("pinned mixes come first and do not count toward the ten unpinned entries", async (t) => {
  const { store, cleanUp } = await createStore();
  t.after(cleanUp);
  await store.saveMix({ id: "old", members: [source("x"), source("y")] });
  await store.pinMix("old", true);
  for (let index = 1; index <= 11; index += 1) await store.add(source(`s${index}`));
  await store.saveMix({ id: "new", members: [source("s1"), source("s2")] });

  assert.deepEqual(titles(store.get()), [
    "*x + y", "s1 + s2", "s11", "s10", "s9", "s8", "s7", "s6", "s5", "s4", "s3"
  ]);

  // Unpinned, it is newly recent rather than gone at once; the oldest goes.
  await store.pinMix("old", false);
  assert.deepEqual(titles(store.get()).slice(0, 3), ["x + y", "s1 + s2", "s11"]);
  assert.equal(store.get().length, 10);
});

test("only a pinned mix can be renamed, unpinning keeps its name, and an empty name goes back to the automatic title", async (t) => {
  const { store, stored, cleanUp } = await createStore();
  t.after(cleanUp);
  await store.saveMix({ id: "mix", members: [source("a"), source("b"), source("c")] });
  await store.renameMix("mix", "Ignored");
  assert.deepEqual(titles(store.get()), ["a + 2 more"]);

  await store.pinMix("mix", true);
  await store.renameMix("mix", "  Trip  ");
  await store.pinMix("mix", false);
  assert.deepEqual(titles(store.get()), ["Trip"]);
  assert.equal((await stored() as Array<{ name?: string }>)[0].name, "Trip");

  await store.pinMix("mix", true);
  await store.renameMix("mix", " ");
  assert.deepEqual(titles(store.get()), ["*a + 2 more"]);
});

test("a mix its session takes down to one source leaves the list, and comes back with its name and pin", async (t) => {
  const { store, reload, cleanUp } = await createStore();
  t.after(cleanUp);
  await store.saveMix({ id: "solo", members: [source("a")] });
  assert.deepEqual(store.get(), [], "One source is not saved as a mix.");

  await store.saveMix({ id: "mix", members: [source("a"), source("b")] });
  await store.pinMix("mix", true);
  await store.renameMix("mix", "Trip");
  await store.saveMix({ id: "mix", members: [source("a")] });
  assert.deepEqual(store.get(), []);
  assert.deepEqual(await reload(), []);

  await store.saveMix({ id: "mix", members: [source("a"), source("c")] });
  assert.deepEqual(titles(store.get()), ["*Trip"]);
});

test("removing a mix leaves its sources, and removing a source leaves the mixes that hold it", async (t) => {
  const { store, cleanUp } = await createStore();
  t.after(cleanUp);
  await store.add(source("a"));
  await store.add(source("b"));
  await store.saveMix({ id: "mix", members: [source("a"), source("b")] });

  await store.remove(source("a").location);
  assert.deepEqual(titles(store.get()), ["a + b", "b"]);
  await store.removeMix("mix");
  assert.deepEqual(titles(store.get()), ["b"]);
  assert.equal(store.getMix("mix"), null);
});
