import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { addFourChanThread, type RecordedRequest } from "../../src/main/testing/fakeWeb.ts";
import { expect, test } from "../support/fixtures.ts";

// Timers can fire very slightly early relative to wall-clock measurement.
const TIMER_TOLERANCE_MS = 50;

function smallestGapMs(requests: RecordedRequest[]): number {
  const gaps = requests.slice(1).map((request, index) => request.atMs - requests[index].atMs);
  return Math.min(...gaps);
}

test("a web source reaches the screen through the real broker, paced on the wire", async ({ launch, web }) => {
  const thread = addFourChanThread(web, { threadId: 2000, files: 3, subject: "Wire test" });
  const { viewer, pressNativeKey } = await launch();

  await viewer.openLocation(thread.pageUrl);
  await viewer.expectShowing("file-1.png");
  await viewer.expectImageDecoded({ width: 40, height: 30 });
  expect(await viewer.tileNames()).toEqual(["file-1.png", "file-2.png", "file-3.png"]);

  await web.waitForRequest(thread.mediaUrls[2], 10_000);
  await web.waitForRequest(thread.thumbnailUrls[2], 10_000);

  // Pacing lives in the broker, and flow tests run it with instant delays. Only
  // here, with real timers and a real wire, is the delay itself proven.
  const media = web.requests.filter((request) => thread.mediaUrls.includes(request.url));
  const thumbnails = web.requests.filter((request) => thread.thumbnailUrls.includes(request.url));
  expect(media.map((request) => request.url)).toEqual(thread.mediaUrls);
  expect(smallestGapMs(media)).toBeGreaterThanOrEqual(1_000 - TIMER_TOLERANCE_MS);
  expect(smallestGapMs(thumbnails)).toBeGreaterThanOrEqual(200 - TIMER_TOLERANCE_MS);

  expect(web.urls("a.4cdn.org")).toEqual([thread.apiUrl]);
  for (const request of web.requests) {
    expect(request.userAgent, request.url).toContain("Pixvitta");
  }

  // Revisiting a prefetched file comes from the cache, not the wire.
  const sent = web.requests.length;
  await pressNativeKey("Right");
  await viewer.expectShowing("file-2.png");
  await viewer.expectImageDecoded({ width: 41, height: 31 });
  expect(web.requests.length).toBe(sent);
});

test("downloading a collection writes the served bytes under the source's name", async ({ launch, web, sandbox }) => {
  const thread = addFourChanThread(web, { threadId: 2100, files: 2, subject: "Saved thread" });
  const { viewer, page } = await launch();
  await viewer.openLocation(thread.pageUrl);
  await viewer.expectShowing("file-1.png");

  await page.getByTestId("download-collection").click();

  const directory = path.join(sandbox.downloadsDir, "Saved thread");
  await expect
    .poll(() => readdir(directory).catch(() => [] as string[]), { timeout: 10_000 })
    .toEqual(["file-1.png", "file-2.png"]);
  expect(await readFile(path.join(directory, "file-1.png"))).toEqual(thread.bodies[0]);
  expect(await readFile(path.join(directory, "file-2.png"))).toEqual(thread.bodies[1]);
});

test("a source that fails to open explains why and can be replaced by one that works", async ({ launch, web }) => {
  const thread = addFourChanThread(web, { threadId: 2200, files: 1 });
  const missing = addFourChanThread(web, { threadId: 2201, files: 1 });
  web.route(missing.apiUrl, () => new Response(null, { status: 404 }));
  const { viewer } = await launch();

  await viewer.openLocation(missing.pageUrl);
  await expect(viewer.sourceError).toContainText("could not be found");

  await viewer.openLocation(thread.pageUrl);
  await viewer.expectShowing("file-1.png");
  await expect(viewer.sourceError).toHaveCount(0);
});

test("HTTP 429 stops every request, tells the user, and quits", async ({ launch, web }) => {
  const thread = addFourChanThread(web, { threadId: 2300, files: 3 });
  web.route(thread.mediaUrls[0], () => new Response(null, { status: 429 }));
  const { viewer, app, exited } = await launch();

  // Native dialogs block on a person, so answer it and keep what it said.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async (options: { message: string }) => {
      console.log(`halt-dialog: ${options.message}`);
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  const haltMessage = new Promise<string>((resolve) => {
    app.process().stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes("halt-dialog:")) resolve(text);
    });
  });

  await viewer.openLocation(thread.pageUrl);

  expect(await haltMessage).toContain("rate-limited");
  expect(await exited, "The app quits cleanly rather than crashing.").toBe(0);
  const onWire = web.requests.filter((request) => request.status === 429);
  expect(onWire.map((request) => request.url)).toEqual([thread.mediaUrls[0]]);
  const after = web.requests.slice(web.requests.indexOf(onWire[0]) + 1);
  expect(after.filter((request) => thread.mediaUrls.includes(request.url)), "No media request follows the 429.").toEqual([]);
});
