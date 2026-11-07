import { spawnSync } from "node:child_process";
import { changedFiles, isGlobalChange } from "./changed-files.mjs";

// The smallest proof for the current diff: it works out which layers the changed
// files can affect and runs only those. CI still runs everything.
//
//   pnpm verify                  run what the diff needs
//   pnpm verify --plan           print the plan without running it
//   pnpm verify --base <ref>     compare with another base
const argv = process.argv.slice(2);
const planOnly = argv.includes("--plan");
const baseIndex = argv.indexOf("--base");
const base = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;

const changed = changedFiles(base);
const everything = changed.some(isGlobalChange);
const touches = (...prefixes) => everything || changed.some((file) => prefixes.some((prefix) => file.startsWith(prefix)));

const code = touches("src/", "tests/", "scripts/", "playwright.config.ts", "vite.", "tsconfig", "stage.html", "index.html");
const steps = [];
if (code) steps.push({ name: "Typecheck", args: ["typecheck"] });
if (code) steps.push({ name: "Spec and flow tests the diff can reach", args: ["test", "--changed", ...(base ? [base] : [])] });
if (touches("src/renderer/", "src/shared/", "tests/stage/", "tests/support/", "vite.", "stage.html", "playwright.config.ts", "scripts/run-playwright.mjs")) {
  steps.push({ name: "Stage tests (renderer in Chromium)", args: ["test:stage"] });
}
if (touches("src/main/", "src/preload/", "src/renderer/", "src/shared/", "tests/e2e/", "tests/support/", "index.html", "playwright.config.ts", "scripts/run-playwright.mjs")) {
  steps.push({ name: "E2E tests (the real app)", args: ["test:e2e"] });
}

console.log(`${changed.length} changed file${changed.length === 1 ? "" : "s"} since the base.`);
if (steps.length === 0) {
  console.log("Nothing here can change behavior, so there is nothing to run.");
  process.exit(0);
}
for (const step of steps) console.log(`  - ${step.name}: pnpm ${step.args.join(" ")}`);
if (planOnly) process.exit(0);

for (const step of steps) {
  console.log(`\n=== ${step.name}`);
  const result = spawnSync("pnpm", step.args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nverify stopped: "pnpm ${step.args.join(" ")}" failed.`);
    process.exit(result.status ?? 1);
  }
}
console.log("\nverify passed.");
