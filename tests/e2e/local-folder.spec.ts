import { spawn } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { syntheticPng } from "../../src/main/testing/fakeWeb.ts";
import { ELECTRON_TEST_SWITCHES, sandboxEnvironment, repositoryRoot, SAMPLE_FOLDER_MEDIA } from "../support/app.ts";
import { expect, test } from "../support/fixtures.ts";

// By inode, because a cache hit touches a file's mtime to keep it in the LRU, but
// only regenerating one replaces the file.
async function thumbnailFiles(userDataDir: string): Promise<Map<string, number>> {
  const root = path.join(userDataDir, "thumbnail-cache");
  const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const files = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.endsWith(".jpg")) continue;
    files.set(entry, (await stat(path.join(root, entry))).ino);
  }
  return files;
}

test("a picked folder shows only its supported top-level media, and each kind really decodes", async ({ launch, sampleFolder }) => {
  const { viewer, pressNativeKey } = await launch({ dialogs: [sampleFolder] });

  await viewer.pickFolder();
  await viewer.expectShowing("alpha.png");
  expect(await viewer.tileNames()).toEqual(SAMPLE_FOLDER_MEDIA);
  await viewer.expectImageDecoded({ width: 64, height: 48 });

  // Main intercepts arrow keys before the page, so focused video controls can't
  // reinterpret them as seeking.
  await pressNativeKey("Right");
  await viewer.expectShowing("bravo.png");
  await viewer.expectImageDecoded({ width: 96, height: 72 });

  await viewer.clickTile("charlie.webm");
  await viewer.expectShowing("charlie.webm");
  await viewer.expectVideoSeekable();

  // The video has focusable controls now, and wrapping returns to the start.
  await pressNativeKey("Right");
  await viewer.expectShowing("alpha.png");
});

test("viewer keys edit a focused text field, and drive the viewer again once it is gone", async ({ launch, sampleFolder }) => {
  const { viewer, pressNativeKey, typeNative, expectMainHearsTextEntryFocus } = await launch({ dialogs: [sampleFolder] });
  await viewer.pickFolder();
  await viewer.expectShowing("alpha.png");

  await viewer.openWebSourceDialog();
  await expectMainHearsTextEntryFocus(true);
  await typeNative("jkl");
  await pressNativeKey("Left");
  await pressNativeKey("Left");
  await typeNative("J");
  await pressNativeKey("Right");
  await typeNative("K");
  await expect(viewer.webSourceField).toHaveValue("jJkKl");
  await viewer.expectShowing("alpha.png");

  await viewer.closeWebSourceDialog();
  await pressNativeKey("Right");
  await viewer.expectShowing("bravo.png");
  await pressNativeKey("Left");
  await viewer.expectShowing("alpha.png");
});

test("thumbnails and recent sources survive a restart without being regenerated", async ({ launch, sampleFolder, sandbox }) => {
  const first = await launch({ dialogs: [sampleFolder] });
  await first.viewer.pickFolder();
  await first.viewer.expectShowing("alpha.png");

  // The renderer captures each thumbnail and main caches it, images and video alike.
  await expect.poll(async () => (await thumbnailFiles(sandbox.userDataDir)).size).toBe(SAMPLE_FOLDER_MEDIA.length);
  const generated = await thumbnailFiles(sandbox.userDataDir);
  await first.close();

  const second = await launch();
  await second.viewer.openRecentSource(0);
  await second.viewer.expectShowing("alpha.png");
  await expect(second.viewer.filmstripTiles).toHaveCount(SAMPLE_FOLDER_MEDIA.length);
  await second.viewer.expectThumbnailsServedFromCache();
  expect(await thumbnailFiles(sandbox.userDataDir)).toEqual(generated);
});

test("refresh picks up files added since the folder was opened and keeps the selected file", async ({ launch, sampleFolder }) => {
  const { viewer, app } = await launch({ dialogs: [sampleFolder] });
  await viewer.pickFolder();
  await viewer.clickTile("bravo.png");
  await viewer.expectShowing("bravo.png");

  await writeFile(path.join(sampleFolder, "aardvark.png"), syntheticPng(32, 32));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send("menu:command", "refresh-source");
  });

  await expect(viewer.filmstripTiles).toHaveCount(SAMPLE_FOLDER_MEDIA.length + 1);
  expect((await viewer.tileNames())[0]).toBe("aardvark.png");
  // The new first file shifts bravo.png along, but it stays the one shown.
  await viewer.expectShowing("bravo.png");
});

test("opening a file from a second launch focuses the running app on that file", async ({ launch, sampleFolder, sandbox }) => {
  const { viewer, app } = await launch();
  const electronBinary = await app.evaluate(() => process.execPath);

  const secondInstance = spawn(
    electronBinary,
    [repositoryRoot, ...ELECTRON_TEST_SWITCHES, path.join(sampleFolder, "bravo.png")],
    { env: sandboxEnvironment(sandbox), cwd: repositoryRoot, stdio: "ignore" }
  );
  const exitCode = await new Promise((resolve) => secondInstance.once("exit", resolve));
  expect(exitCode, "The second process hands over and quits.").toBe(0);

  await viewer.expectShowing("bravo.png");
  await viewer.expectImageDecoded({ width: 96, height: 72 });
  expect(await viewer.tileNames()).toEqual(SAMPLE_FOLDER_MEDIA);
});
