import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareSessionResourceCache,
  sessionResourceCacheDirectory
} from "./sessionResourceCache";

test("clears only the media cache once at process startup", async (context) => {
  const userDataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "pixvitta-session-cache-")
  );
  context.after(() => rm(userDataDirectory, { recursive: true, force: true }));

  const cacheDirectory = sessionResourceCacheDirectory(userDataDirectory);
  const siblingPath = path.join(userDataDirectory, "settings.json");
  await mkdir(path.join(cacheDirectory, "provider"), { recursive: true });
  await writeFile(path.join(cacheDirectory, "provider", "old.bin"), "old");
  await writeFile(siblingPath, "keep");

  await prepareSessionResourceCache(userDataDirectory);

  assert.deepEqual(await readdir(cacheDirectory), []);
  assert.equal(await readFile(siblingPath, "utf8"), "keep");

  const currentSessionEntry = path.join(cacheDirectory, "current.bin");
  await writeFile(currentSessionEntry, "current");
  await prepareSessionResourceCache(userDataDirectory);
  assert.equal(await readFile(currentSessionEntry, "utf8"), "current");
});
