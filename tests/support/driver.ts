import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { addFourChanThread, addNHentaiGallery, FakeWeb } from "../../src/main/testing/fakeWeb.ts";
import { createSampleFolder, launchPixvitta, repositoryRoot, type AppSandbox, type RunningApp } from "./app.ts";
import { serveFakeWeb } from "./fakeWebServer.ts";

/*
 * `pnpm app` keeps the real app running in a sandbox and drives it one command
 * at a time, so an agent can look, act, and look again across tool calls. Run
 * `pnpm app help` for the commands. It lives in the same sandbox as the E2E
 * tests: its own data directories, a virtual display, and a fake web in place of
 * real providers. State survives restarts until `pnpm app start --fresh`.
 *
 * A small daemon owns the Electron process and answers commands over loopback,
 * guarded by a token. Stopping goes through the daemon by its recorded PID, never
 * by searching for processes by name.
 */

const HELP = `pnpm app <command>

  start [--fresh] [--folder <path>] [--headed]
                       Build and launch the app. --folder opens it right away;
                       --headed uses your display instead of a virtual one.
  status               Is it running, and where do its files live?
  stop                 Quit the app and the daemon.

  open <location>      Open a folder, file, or URL. "sample-folder",
                       "sample-thread", "second-thread", and "sample-gallery"
                       are always available.
  snapshot             Print what is on screen as an ARIA tree.
  screenshot [path]    Save a PNG and print its path.
  click <testid|text>  Click an element by data-testid, or else by visible text.
  press <key>          Press a key in the page (Playwright key name).
  native-key <code>    Press a key through main's before-input-event (Right, Left).
  eval <expression>    Evaluate JavaScript in the renderer and print the result.
  main <expression>    Evaluate JavaScript in the main process; "electron" is in scope.
  logs                 Print main-process and renderer output.
  requests             Print everything the app requested from the fake web.
  web-status <url> <status>
                       Make the fake web answer a URL with that status from now
                       on, as a site that went away would.`;

const SAMPLE_THREAD_ID = 1000;
const SECOND_THREAD_ID = 2000;
const SAMPLE_GALLERY_ID = 1000;

const home = path.join(repositoryRoot, ".tmp", "app");
const stateFile = path.join(home, "daemon.json");
const logFile = path.join(home, "daemon.log");

type DaemonState = { pid: number; port: number; token: string };

function readState(): DaemonState | null {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function liveState(): DaemonState | null {
  const state = readState();
  return state && isAlive(state.pid) ? state : null;
}

async function send(state: DaemonState, command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  const response = await fetch(`http://127.0.0.1:${state.port}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ command, args })
  });
  return await response.json() as { ok: boolean; output: string };
}

/* ---------------------------------------- daemon ---------------------------------------- */

async function runDaemon(startFolder: string | undefined): Promise<void> {
  const web = new FakeWeb();
  addFourChanThread(web, { threadId: SAMPLE_THREAD_ID, files: 8, subject: "Sample thread" });
  addFourChanThread(web, { threadId: SECOND_THREAD_ID, files: 8, subject: "Second thread" });
  addNHentaiGallery(web, { galleryId: SAMPLE_GALLERY_ID, pages: 8 });
  const server = await serveFakeWeb(web);

  const sampleFolder = await createSampleFolder(path.join(home, "sample-folder"));
  const sandbox: AppSandbox = {
    userDataDir: path.join(home, "user-data"),
    downloadsDir: path.join(home, "downloads"),
    fakeWebPort: server.port
  };
  await mkdir(sandbox.downloadsDir, { recursive: true });

  const samples: Record<string, string> = {
    "sample-folder": sampleFolder,
    "sample-thread": `https://boards.4chan.org/g/thread/${SAMPLE_THREAD_ID}`,
    "second-thread": `https://boards.4chan.org/g/thread/${SECOND_THREAD_ID}`,
    "sample-gallery": `https://nhentai.net/g/${SAMPLE_GALLERY_ID}/`
  };
  const running = await launchPixvitta({ sandbox, args: startFolder ? [startFolder] : [] });
  const token = randomBytes(24).toString("hex");

  const shutdown = async () => {
    rmSync(stateFile, { force: true });
    await running.close();
    await server.close();
    process.exit(0);
  };
  void running.exited.then(() => {
    rmSync(stateFile, { force: true });
    process.exit(0);
  });

  const control = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
      void (async () => {
        if (request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(403).end();
          return;
        }
        const { command, args } = JSON.parse(body) as { command: string; args: string[] };
        let result: { ok: boolean; output: string };
        try {
          result = { ok: true, output: await runCommand({ running, web, samples }, command, args) };
        } catch (error) {
          result = { ok: false, output: error instanceof Error ? error.message : String(error) };
        }
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
        if (command === "stop") await shutdown();
      })();
    });
  });
  control.listen(0, "127.0.0.1", () => {
    const state: DaemonState = { pid: process.pid, port: (control.address() as AddressInfo).port, token };
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  });
}

type Session = {
  running: RunningApp;
  web: FakeWeb;
  samples: Record<string, string>;
};

async function runCommand({ running, web, samples }: Session, command: string, args: string[]): Promise<string> {
  const { page, app, logs } = running;
  const argument = args.join(" ");
  switch (command) {
    case "stop":
      return "Stopping.";
    case "open": {
      const location = samples[argument] ?? argument;
      await page.evaluate((target) => { window.pixvitta.openSource({ kind: "location", location: target }); }, location);
      await page.waitForFunction(() => !document.querySelector('[data-testid="source-loading"]'));
      return `Opened ${location}.`;
    }
    case "snapshot":
      return page.locator("body").ariaSnapshot();
    case "screenshot": {
      const file = path.resolve(argument || path.join(home, `screenshot-${Date.now()}.png`));
      await page.screenshot({ path: file });
      return file;
    }
    case "click": {
      const byTestId = page.getByTestId(argument);
      await (await byTestId.count() > 0 ? byTestId : page.getByText(argument, { exact: false })).first().click({ timeout: 5_000 });
      return `Clicked ${argument}.`;
    }
    case "press":
      await page.keyboard.press(argument);
      return `Pressed ${argument}.`;
    case "native-key":
      await app.evaluate(({ BrowserWindow }, code) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.focus();
        window.webContents.focus();
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: code });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: code });
      }, argument);
      return `Pressed ${argument} through main.`;
    case "eval":
      return JSON.stringify(await page.evaluate(argument), null, 2) ?? "undefined";
    case "main": {
      const result = await app.evaluate((electron, expression) => {
        return new Function("electron", `return (${expression});`)(electron);
      }, argument);
      return JSON.stringify(result, null, 2) ?? "undefined";
    }
    case "logs":
      return logs.join("\n") || "(no output yet)";
    case "requests":
      return web.requests.map((request) => `${request.status} ${request.url}`).join("\n") || "(no requests yet)";
    case "web-status": {
      const [url, status] = args;
      if (!url || !Number(status)) throw new Error("Usage: web-status <url> <status>");
      web.route(url, () => new Response(null, { status: Number(status) }));
      return `${url} now answers ${status}.`;
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  }
}

/* ---------------------------------------- client ---------------------------------------- */

async function waitForDaemon(daemonPid: number): Promise<DaemonState> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = liveState();
    if (state) return state;
    if (!isAlive(daemonPid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const log = await readFile(logFile, "utf8").catch(() => "(no log)");
  throw new Error(`The app did not start.\n${log}`);
}

function hasXvfb(): boolean {
  return spawnSync("sh", ["-c", "command -v xvfb-run"], { stdio: "ignore" }).status === 0;
}

async function start(args: string[]): Promise<void> {
  const existing = liveState();
  if (existing) {
    console.log(`Already running (PID ${existing.pid}). Use "pnpm app stop" first to restart.`);
    return;
  }
  const folderIndex = args.indexOf("--folder");
  const folder = folderIndex >= 0 ? path.resolve(args[folderIndex + 1]) : undefined;

  if (args.includes("--fresh")) rmSync(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  rmSync(stateFile, { force: true });

  if (spawnSync("pnpm", ["build"], { stdio: "ignore" }).status !== 0) {
    throw new Error("The build failed. Run pnpm build to see why.");
  }

  const daemon = [process.execPath, ...process.execArgv, path.resolve(process.argv[1]), "--daemon", ...(folder ? [folder] : [])];
  const useVirtualDisplay = process.platform === "linux" && !args.includes("--headed");
  if (useVirtualDisplay && !hasXvfb()) {
    throw new Error("xvfb-run is required for a virtual display. Install it (apt install xvfb), or pass --headed.");
  }
  const [command, ...commandArgs] = useVirtualDisplay ? ["xvfb-run", "-a", ...daemon] : daemon;
  const log = openSync(logFile, "w");
  const child = spawn(command, commandArgs, { detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  child.unref();

  const state = await waitForDaemon(child.pid ?? 0);
  console.log(`Running (PID ${state.pid}). Sandbox: ${home}`);
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "--daemon") return runDaemon(args[0]);
  if (command === "help" || command === "--help") return console.log(HELP);
  if (command === "start") return start(args);

  const state = liveState();
  if (command === "status") {
    return console.log(state ? `Running (PID ${state.pid}). Sandbox: ${home}` : "Not running.");
  }
  if (!state) {
    if (command === "stop") return console.log("Not running.");
    throw new Error('The app is not running. Start it with "pnpm app start".');
  }

  const result = await send(state, command, args);
  if (!result.ok) throw new Error(result.output);
  console.log(result.output);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
