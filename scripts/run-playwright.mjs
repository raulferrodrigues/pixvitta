import { spawnSync } from "node:child_process";

// Runs a Playwright project: `pnpm test:e2e` and `pnpm test:stage`. Extra
// arguments go to Playwright, such as a spec path or `--grep <pattern>`.
const [project, ...playwrightArguments] = process.argv.slice(2);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function hasCommand(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

// E2E runs the built app, so a test can never pass against stale output.
if (project === "e2e") {
  const buildStatus = run("pnpm", ["build"]);
  if (buildStatus !== 0) process.exit(buildStatus);
}

const testCommand = ["exec", "playwright", "test", `--project=${project}`, ...playwrightArguments];

// A virtual display keeps test windows from opening on someone's desktop and
// stealing focus. macOS has no equivalent, so windows do appear there.
if (process.platform === "linux" && !process.env.PIXVITTA_TEST_HEADED) {
  if (!hasCommand("xvfb-run")) {
    console.error("xvfb-run is required to run Electron tests on Linux. Install it (apt install xvfb), or set PIXVITTA_TEST_HEADED=1 to use your display.");
    process.exit(1);
  }
  process.exit(run("xvfb-run", ["-a", "pnpm", ...testCommand]));
}
process.exit(run("pnpm", testCommand));
