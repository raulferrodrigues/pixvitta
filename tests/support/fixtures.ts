import { test as base, expect, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { FakeWeb } from "../../src/main/testing/fakeWeb.ts";
import { createSampleFolder, launchPixvitta, type AppSandbox, type LaunchOptions, type RunningApp } from "./app.ts";
import { serveFakeWeb } from "./fakeWebServer.ts";
import { Viewer } from "./viewer.ts";

export type RunningViewer = RunningApp & {
  viewer: Viewer;
  /**
   * A key press that takes the route a real one does, through main's
   * before-input-event. page.keyboard goes straight to the page and skips it.
   */
  pressNativeKey(keyCode: "Right" | "Left"): Promise<void>;
};

type E2EFixtures = {
  /** The internet for this test. Add threads and galleries before opening them. */
  web: FakeWeb;
  sandbox: AppSandbox;
  /** A folder of real media, plus the files a scan must skip. */
  sampleFolder: string;
  /** Launches the app in this test's sandbox. Call it again to test a restart. */
  launch(options?: Omit<LaunchOptions, "sandbox">): Promise<RunningViewer>;
};

/**
 * On failure, everything needed to diagnose it lands in one readable file: what
 * was on screen, what the app logged, and what it requested. An agent can read
 * this without opening a trace viewer.
 */
async function writeDiagnostics(testInfo: TestInfo, running: RunningApp | undefined, web: FakeWeb): Promise<void> {
  let screen = "(the app was no longer running)";
  if (running && !running.page.isClosed()) {
    screen = await running.page.locator("body").ariaSnapshot().catch((error: unknown) => `(could not read: ${String(error)})`);
    await running.page.screenshot({ path: testInfo.outputPath("screenshot.png") }).catch(() => undefined);
  }
  const requests = web.requests.map((request) => `${request.status} ${request.method} ${request.url}`);
  const file = testInfo.outputPath("diagnostics.md");
  await writeFile(file, [
    `# ${testInfo.title}`,
    "",
    "## Error",
    "```",
    stripVTControlCharacters(testInfo.error?.message ?? "(none)"),
    "```",
    "## Screen (ARIA snapshot; screenshot.png is alongside if the app was running)",
    "```yaml",
    screen,
    "```",
    "## App output",
    "```",
    running?.logs.join("\n") || "(none)",
    "```",
    "## Requests to the fake web",
    "```",
    requests.join("\n") || "(none)",
    "```",
    "## Requests no route answered",
    "```",
    web.unexpected.join("\n") || "(none)",
    "```",
    ""
  ].join("\n"));
  console.error(`Diagnostics: ${file}`);
}

export const test = base.extend<E2EFixtures>({
  web: async ({}, use) => {
    await use(new FakeWeb());
  },

  sandbox: async ({ web }, use, testInfo) => {
    const server = await serveFakeWeb(web);
    const sandbox: AppSandbox = {
      userDataDir: testInfo.outputPath("user-data"),
      downloadsDir: testInfo.outputPath("downloads"),
      fakeWebPort: server.port
    };
    await mkdir(sandbox.downloadsDir, { recursive: true });
    await use(sandbox);
    await server.close();
  },

  sampleFolder: async ({}, use, testInfo) => {
    await use(await createSampleFolder(testInfo.outputPath("sample-folder")));
  },

  launch: async ({ sandbox, web }, use, testInfo) => {
    const launched: RunningApp[] = [];
    await use(async (options = {}) => {
      const running = await launchPixvitta({ ...options, sandbox });
      launched.push(running);
      return {
        ...running,
        viewer: new Viewer(running.page),
        async pressNativeKey(keyCode) {
          await running.app.evaluate(({ BrowserWindow }, code) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.focus();
            window.webContents.focus();
            window.webContents.sendInputEvent({ type: "keyDown", keyCode: code });
            window.webContents.sendInputEvent({ type: "keyUp", keyCode: code });
          }, keyCode);
        }
      };
    });

    if (testInfo.status !== testInfo.expectedStatus) {
      await writeDiagnostics(testInfo, launched.at(-1), web);
    }
    await Promise.all(launched.map((running) => running.close()));
    // Holds for every test, so no flow can quietly start depending on a real site.
    expect(web.unexpected, "The app requested URLs the fake web does not define.").toEqual([]);
  }
});

export { expect };
