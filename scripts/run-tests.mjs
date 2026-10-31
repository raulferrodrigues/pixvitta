import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

// Every *.test.ts under src is bundled for Node with Electron replaced by the
// test stub, then run with the built-in test runner.
const outdir = ".tmp/tests";
const entries = (await readdir("src", { recursive: true }))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.join("src", file))
  .sort();

if (entries.length === 0) throw new Error("No test files were found under src.");

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "cjs",
  alias: { electron: "./src/main/testing/electron.ts" },
  outbase: "src",
  outdir,
  logLevel: "warning"
});

const outputs = entries.map((entry) =>
  path.join(outdir, path.relative("src", entry).replace(/\.ts$/, ".js"))
);
const child = spawn(process.execPath, ["--test", ...outputs], {
  stdio: "inherit"
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
