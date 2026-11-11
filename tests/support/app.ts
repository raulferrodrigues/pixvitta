import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { syntheticPng } from "../../src/main/testing/fakeWeb.ts";

// pnpm scripts and Playwright both run from the repository root.
export const repositoryRoot = process.cwd();

/*
 * Launches the real, built app in a sandbox: its own userData and downloads
 * directories, and every https request from the default session answered by the
 * fake web. Used by the E2E tests and by `pnpm app`, so an agent poking at the
 * app sees exactly what the tests see, and neither can reach a real provider.
 */

export type AppSandbox = {
  userDataDir: string;
  downloadsDir: string;
  fakeWebPort: number;
};

export type LaunchOptions = {
  sandbox: AppSandbox;
  /** Answers for the native folder picker, in order. null cancels it. */
  dialogs?: Array<string | null>;
  /** Extra command line, such as a file to open. */
  args?: string[];
};

export type RunningApp = {
  app: ElectronApplication;
  page: Page;
  /** Main-process output and renderer console, in arrival order. */
  logs: string[];
  /** Resolves with the exit code once the process is gone. */
  exited: Promise<number | null>;
  close(): Promise<void>;
};

// Test machines rarely have the setuid sandbox helper configured, and a virtual
// display has no GPU, so asking for one only adds a failed start to the logs.
export const ELECTRON_TEST_SWITCHES = ["--no-sandbox", "--disable-gpu"];

export function sandboxEnvironment(sandbox: AppSandbox, dialogs: Array<string | null> = []): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Set when this runs inside another Electron app, such as an agent host. It
  // would make the binary behave as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  return {
    ...env,
    PIXVITTA_TEST_USER_DATA_DIR: sandbox.userDataDir,
    PIXVITTA_TEST_DOWNLOADS_PATH: sandbox.downloadsDir,
    PIXVITTA_TEST_DIALOG_RESPONSES: JSON.stringify(dialogs)
  };
}

export async function launchPixvitta({ sandbox, dialogs = [], args = [] }: LaunchOptions): Promise<RunningApp> {
  const app = await electron.launch({
    args: [repositoryRoot, ...ELECTRON_TEST_SWITCHES, ...args],
    cwd: repositoryRoot,
    env: sandboxEnvironment(sandbox, dialogs) as Record<string, string>
  });

  const logs: string[] = [];
  const childProcess = app.process();
  childProcess.stdout?.on("data", (chunk: Buffer) => logs.push(`[main] ${chunk.toString().trimEnd()}`));
  childProcess.stderr?.on("data", (chunk: Buffer) => logs.push(`[main] ${chunk.toString().trimEnd()}`));
  const exited = new Promise<number | null>((resolve) => {
    childProcess.once("exit", (code) => resolve(code));
  });

  // Registered at the session level rather than by patching a function, so it
  // covers everything that goes through the session, including the renderer.
  // Providers' own partitions, such as a sign-in window's, are created later,
  // so every new session is routed too.
  await app.evaluate(({ app: electronApp, net, session }, port) => {
    const route = (target: Electron.Session) => {
      target.protocol.handle("https", (request) => {
        const url = new URL(request.url);
        return net.fetch(`http://127.0.0.1:${port}/${url.hostname}${url.pathname}${url.search}`, {
          method: request.method,
          headers: request.headers,
          redirect: "manual",
          bypassCustomProtocolHandlers: true
        });
      });
    };
    route(session.defaultSession);
    electronApp.on("session-created", route);
  }, sandbox.fakeWebPort);

  const page = await app.firstWindow();
  page.on("console", (message) => logs.push(`[renderer:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => logs.push(`[renderer:uncaught] ${error.stack ?? error.message}`));
  await page.waitForLoadState("domcontentloaded");

  return {
    app,
    page,
    logs,
    exited,
    async close() {
      if (childProcess.exitCode === null && childProcess.signalCode === null) await app.close();
      await exited;
    }
  };
}

/** Two images and a video at the top level, plus everything a folder scan must skip. */
export const SAMPLE_FOLDER_MEDIA = ["alpha.png", "bravo.png", "charlie.webm"];

export async function createSampleFolder(directory: string): Promise<string> {
  await mkdir(path.join(directory, "nested"), { recursive: true });
  await writeFile(path.join(directory, "alpha.png"), syntheticPng(64, 48, [200, 80, 80]));
  await writeFile(path.join(directory, "bravo.png"), syntheticPng(96, 72, [80, 200, 80]));
  await copyFile(path.join(repositoryRoot, "tests/fixtures/sample.webm"), path.join(directory, "charlie.webm"));
  await writeFile(path.join(directory, ".hidden.png"), syntheticPng(8, 8));
  await writeFile(path.join(directory, "notes.txt"), "Not media.");
  await writeFile(path.join(directory, "nested", "deep.png"), syntheticPng(8, 8));
  return directory;
}
