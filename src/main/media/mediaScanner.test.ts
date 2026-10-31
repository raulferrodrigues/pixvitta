import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSettings } from "../../shared/settings";
import { LocalFolderProvider } from "../library/providers/localFolder";
import { scanFolder } from "./mediaScanner";

async function withFolder(run: (folder: string, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "pixvitta-scan-"));
  const folder = path.join(root, "folder");
  const targets = path.join(root, "targets");
  await mkdir(folder);
  await mkdir(targets);
  await mkdir(path.join(targets, "album.jpg"));
  await writeFile(path.join(folder, "plain.jpg"), "plain");
  await writeFile(path.join(targets, "target.png"), "linked target");
  await writeFile(path.join(targets, "notes.txt"), "text");
  await symlink("../targets/target.png", path.join(folder, "linked.png"));
  await symlink("../targets/target.png", path.join(folder, "second-link.png"));
  await symlink("../targets/missing.jpg", path.join(folder, "broken.jpg"));
  await symlink("../targets/album.jpg", path.join(folder, "directory.jpg"));
  await symlink("loop.jpg", path.join(folder, "loop.jpg"));
  await symlink("../targets/notes.txt", path.join(folder, "notes.txt"));
  try {
    await run(folder, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("scanFolder follows symlinks to regular media files and skips the rest", async () => {
  await withFolder(async (folder, root) => {
    const { items } = await scanFolder(folder);

    assert.deepEqual(items.map((item) => item.name), ["linked.png", "plain.jpg", "second-link.png"]);

    const linked = items.find((item) => item.name === "linked.png");
    const secondLink = items.find((item) => item.name === "second-link.png");
    assert.equal(linked?.absolutePath, path.join(folder, "linked.png"));
    assert.equal(linked?.sizeBytes, "linked target".length);
    assert.notEqual(linked?.id, secondLink?.id);
    assert.notEqual(linked?.thumbnailUrl, secondLink?.thumbnailUrl);
    assert.ok(items.every((item) => !item.absolutePath.startsWith(path.join(root, "targets"))));
  });
});

test("opening a symlinked file directly selects the link in its folder", async () => {
  await withFolder(async (folder) => {
    const location = path.join(folder, "linked.png");
    const collection = await new LocalFolderProvider().load({ location, refresh: false, settings: defaultSettings });

    assert.equal(collection.canonicalLocation, folder);
    const selected = collection.items.find((item) => item.key === collection.selectedKey);
    assert.equal(selected?.localPath, location);
  });
});
