import { expect, test } from "../support/stage.ts";

test("each delivered collection is acknowledged exactly once, however fast they arrive", async ({ openStage }) => {
  const stage = await openStage("empty");
  const { page } = stage;

  // Main quits the app on a missed or doubled acknowledgement, so a duplicate
  // subscription under React StrictMode would be fatal in production.
  await page.evaluate(() => {
    const collection = (title: string, id: string) => ({
      source: { id: title, title, capabilities: { canRefresh: true, canSort: true, canDownload: false, canDownloadCollection: false, canOpenOrigin: false }, members: [{ id, title, kind: "folder" as const, itemCount: 1 }] },
      items: [{
        id, name: `${id}.svg`, url: new URL(`/stage-media/320x240/${id}.svg`, location.origin).href,
        thumbnailUrl: null, kind: "image" as const, sizeBytes: 1, lastOpenedMs: 0, addedMs: 0, modifiedMs: 0, createdMs: 0
      }],
      selectedId: id
    });
    for (const id of ["first", "second", "third"]) {
      window.pixvittaStage.deliverCollection(collection(`Source ${id}`, id));
    }
  });

  await stage.viewer.expectShowing("third.svg");
  expect(await stage.calls("acknowledgeCollection")).toHaveLength(3);
  await stage.expectNoViolations();
});

test("the library hears one selection per change, from every way of navigating", async ({ openStage }) => {
  const { page, viewer, calls } = await openStage("folder");
  await viewer.expectShowing("beach.svg");
  await expect.poll(async () => (await calls("setSelectedMedia")).at(-1)).toEqual(["beach"]);
  const before = (await calls("setSelectedMedia")).length;

  await page.evaluate(() => window.pixvittaStage.sendCommand("next-media"));
  await viewer.expectShowing("forest.svg");
  await viewer.clickTile("harbor.svg");
  await viewer.expectShowing("harbor.svg");
  await viewer.clickTile("harbor.svg");
  await page.evaluate(() => window.pixvittaStage.sendCommand("previous-media"));
  await viewer.expectShowing("waves.webm");

  // Wrapping is the store's job, so this also needs to reach the library.
  await viewer.clickTile("beach.svg");
  await page.evaluate(() => window.pixvittaStage.sendCommand("previous-media"));
  await viewer.expectShowing("sunset.svg");

  // Clicking the tile that is already selected above must not appear here.
  expect((await calls("setSelectedMedia")).slice(before).map(([id]) => id)).toEqual([
    "forest", "harbor", "waves", "beach", "sunset"
  ]);
});

test("a huge source keeps the filmstrip windowed, even after jumping to the far end", async ({ openStage }) => {
  const { page, viewer } = await openStage("large-gallery");
  await viewer.expectShowing("page-0001.svg");

  await expect.poll(() => viewer.filmstripTiles.count()).toBeGreaterThan(0);
  expect(await viewer.filmstripTiles.count()).toBeLessThan(60);

  await page.evaluate(() => window.pixvittaStage.sendCommand("previous-media"));
  await viewer.expectShowing("page-5000.svg");

  const current = page.locator('[data-testid^="filmstrip-item-"][aria-current="true"]');
  await expect(current).toBeInViewport();
  await expect(current).toHaveAttribute("title", "page-5000.svg");
  expect(await viewer.filmstripTiles.count()).toBeLessThan(60);
});

test("a failed media load retries once with a fresh URL, then offers a way forward", async ({ openStage }) => {
  const { page, viewer, expectNoViolations } = await openStage("broken-media");

  await expect(viewer.mediaError).toContainText("never-loads.svg");

  await viewer.mediaError.getByRole("button").click();
  await viewer.expectShowing("recovers.svg");
  await expect(viewer.mediaError).toHaveCount(0);
  await expect.poll(() => viewer.image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await viewer.image.getAttribute("src")).toContain("attempt=");

  await page.evaluate(() => window.pixvittaStage.sendCommand("next-media"));
  await viewer.expectShowing("fine.svg");
  await expectNoViolations();
});

test("a replacement that fails leaves the open source on screen with the reason", async ({ openStage }) => {
  const { viewer } = await openStage("error-rate-limited");

  await viewer.expectShowing("beach.svg");
  await expect(viewer.sourceError).toContainText("slow down");
  await expect(viewer.image).toBeVisible();
});

test("viewer commands wait behind an open settings modal", async ({ openStage }) => {
  const { page, viewer } = await openStage("folder");
  await viewer.expectShowing("beach.svg");

  await page.evaluate(() => window.pixvittaStage.sendCommand("open-settings"));
  await viewer.expectSettingsOpen(true);
  await page.evaluate(() => window.pixvittaStage.sendCommand("next-media"));

  await page.keyboard.press("Escape");
  await viewer.expectSettingsOpen(false);
  // The command sent behind the modal did nothing, so this is the first move.
  await viewer.expectShowing("beach.svg");
  await page.evaluate(() => window.pixvittaStage.sendCommand("next-media"));
  await viewer.expectShowing("forest.svg");
});

test("continuous view selects what scrolls into view and tells the library", async ({ openStage }) => {
  const { page, viewer, calls } = await openStage("folder");
  await viewer.expectShowing("beach.svg");

  await page.getByTestId("view-mode-toggle").click();
  await expect(page.getByTestId("continuous-viewer")).toBeVisible();

  // Real input on purpose: the viewer ignores its own programmatic scrolling. It
  // takes several turns of the wheel because items resize as they are measured.
  await page.mouse.move(600, 400);
  await expect(async () => {
    await page.mouse.wheel(0, 2_000);
    await expect(viewer.filename).toHaveText("sunset.svg", { timeout: 300 });
  }).toPass();
  await expect.poll(async () => (await calls("setSelectedMedia")).at(-1)).toEqual(["sunset"]);
});

test("an update found in the background walks from the gear to a restart", async ({ openStage }) => {
  const { page, viewer, calls } = await openStage("folder");
  await viewer.expectShowing("beach.svg");
  await viewer.expectUpdatePending(false);

  await page.evaluate(() => window.pixvittaStage.setUpdateState({ status: "available", availableVersion: "9.9.9" }));
  await viewer.expectUpdatePending(true);
  await viewer.openSettings();
  await viewer.expectUpdateStep("download");
  await viewer.updateButton.click();
  await expect.poll(() => calls("downloadUpdate")).toHaveLength(1);

  await page.evaluate(() => window.pixvittaStage.setUpdateState({ status: "downloading", downloadPercent: 40 }));
  await viewer.expectUpdateStep("none", "downloading");
  await page.evaluate(() =>
    window.pixvittaStage.setUpdateState({ status: "error", errorContext: "download", message: "socket hang up", downloadPercent: null }));
  await viewer.expectUpdateStep("download", "error");

  await page.evaluate(() => window.pixvittaStage.setUpdateState({ status: "downloaded", downloadedVersion: "9.9.9", errorContext: null }));
  await viewer.expectUpdateStep("install");
  await viewer.updateButton.click();
  await expect.poll(() => calls("installUpdate")).toHaveLength(1);
});

test("Check for Updates in the app menu opens Settings at the update row and checks", async ({ openStage }) => {
  const { page, viewer, calls } = await openStage("folder");
  await viewer.expectShowing("beach.svg");

  await page.evaluate(() => window.pixvittaStage.sendCommand("check-for-updates"));
  await viewer.expectSettingsOpen(true);
  await expect(viewer.updateRow).toBeInViewport({ ratio: 1 });
  await expect.poll(() => calls("checkForUpdates")).toHaveLength(1);
});
