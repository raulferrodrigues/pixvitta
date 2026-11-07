import { defineConfig } from "@playwright/test";
import { stagePort } from "./scripts/stage-port.mjs";

// Run through `pnpm test:e2e` and `pnpm test:stage`, which build what is needed
// and keep windows off your desktop. See docs/testing.md.
const port = stagePort();

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  outputDir: "test-results",
  preserveOutput: "failures-only",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A retry would hide exactly the races these tests exist to find.
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  projects: [
    { name: "e2e", testMatch: "e2e/*.spec.ts" },
    { name: "stage", testMatch: "stage/*.spec.ts" }
  ],
  webServer: {
    command: `pnpm exec vite --config vite.stage.config.mts --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/stage.html`,
    // An agent's already-running `pnpm dev:stage` serves the same files.
    reuseExistingServer: !process.env.CI,
    stdout: "ignore"
  }
});
