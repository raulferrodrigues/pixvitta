import { _electron as electron, test as base, expect, type Page } from "@playwright/test";
import path from "node:path";
import { stagePort } from "../../scripts/stage-port.mjs";
import { ELECTRON_TEST_SWITCHES, repositoryRoot } from "./app.ts";
import { Viewer } from "./viewer.ts";

export type Stage = {
  page: Page;
  viewer: Viewer;
  /** Every call the renderer made to one PixvittaApi method, as argument lists. */
  calls(method: string): Promise<unknown[][]>;
  /** Fails the test if the renderer broke the protocol the real main process enforces. */
  expectNoViolations(): Promise<void>;
};

type StageFixtures = {
  openStage(scenario: string): Promise<Stage>;
};

export const test = base.extend<StageFixtures>({
  openStage: async ({}, use, testInfo) => {
    const closers: Array<() => Promise<void>> = [];
    await use(async (scenario) => {
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        PIXVITTA_STAGE_URL: `http://127.0.0.1:${stagePort(repositoryRoot)}/stage.html?scenario=${scenario}`,
        PIXVITTA_TEST_USER_DATA_DIR: testInfo.outputPath("host-user-data")
      };
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        args: [path.join(repositoryRoot, "tests/stage/host.cjs"), ...ELECTRON_TEST_SWITCHES],
        cwd: repositoryRoot,
        env
      });
      closers.push(() => app.close());
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.pixvittaStage?.isViewerReady());
      return {
        page,
        viewer: new Viewer(page),
        calls: (method) => page.evaluate((name) => window.pixvittaStage.callsTo(name), method),
        async expectNoViolations() {
          expect(await page.evaluate(() => window.pixvittaStage.violations)).toEqual([]);
        }
      };
    });
    await Promise.all(closers.map((close) => close()));
  }
});

export { expect };
