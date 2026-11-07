import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { changedFiles, isGlobalChange } from "./changed-files.mjs";

// Runs the spec and flow layers. Every *.test.ts under src is bundled for Node
// with Electron and the app-wide request broker replaced by test doubles, then
// run with the built-in test runner.
//
//   pnpm test                          everything
//   pnpm test --changed [base]         tests whose import graph touches your diff
//   pnpm test <file-or-dir>...         tests for a path, test or source file
//   pnpm test <path> --name <pattern>  only the tests whose name matches
const USAGE = "Usage: pnpm test [<test-or-source-path>...] [--changed [base]] [--name <pattern>]";
const outdir = ".tmp/tests";

function parseArguments(argv) {
  const options = { paths: [], changed: false, base: undefined, name: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--changed") {
      options.changed = true;
      if (argv[index + 1] && !argv[index + 1].startsWith("-")) options.base = argv[(index += 1)];
    } else if (argument === "--name") {
      options.name = argv[(index += 1)];
      if (!options.name) throw new Error(USAGE);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option ${argument}.\n${USAGE}`);
    } else {
      options.paths.push(path.normalize(argument).replace(/\/$/, ""));
    }
  }
  return options;
}

// The real broker paces with wall-clock delays, so test bundles swap it for one
// with the same scheduler and instant pacing. Doing this at bundle time means
// no switch exists in the app that could ever turn rate limiting off.
const testDoubles = {
  name: "pixvitta-test-doubles",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\/requestBroker$/ }, (resolved) =>
      resolved.resolveDir.endsWith(path.join("main", "requestBroker"))
        ? { path: path.resolve("src/main/testing/testBroker.ts") }
        : undefined
    );
  }
};

// Maps each bundled test to the source files that went into it. esbuild already
// walks the import graph, so selection needs no separate dependency analysis.
function importGraphs(metafile) {
  const graphs = new Map();
  for (const [output, details] of Object.entries(metafile.outputs)) {
    if (!details.entryPoint) continue;
    graphs.set(path.normalize(details.entryPoint), {
      output: path.normalize(output),
      inputs: new Set(Object.keys(details.inputs).map((input) => path.normalize(input)))
    });
  }
  return graphs;
}

function matchesPath(file, target) {
  return file === target || file.startsWith(`${target}${path.sep}`);
}

function selectBundledTests(graphs, targets) {
  return [...graphs.keys()].filter((entry) =>
    [...graphs.get(entry).inputs].some((input) => targets.some((target) => matchesPath(input, target)))
  );
}

function selectScriptTests(scriptTests, targets) {
  return scriptTests.filter((test) => {
    const subject = test.replace(/\.test\.mjs$/, ".mjs");
    return targets.some((target) => matchesPath(test, target) || matchesPath(subject, target));
  });
}

const options = parseArguments(process.argv.slice(2));
const entries = (await readdir("src", { recursive: true }))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.join("src", file))
  .sort();
if (entries.length === 0) throw new Error("No test files were found under src.");

// Build and release scripts are plain Node modules and run without bundling.
const scriptTests = (await readdir("scripts"))
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => path.join("scripts", file))
  .sort();

await rm(outdir, { recursive: true, force: true });
const { metafile } = await build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "cjs",
  alias: { electron: "./src/main/testing/electron.ts" },
  plugins: [testDoubles],
  metafile: true,
  outbase: "src",
  outdir,
  logLevel: "warning"
});
const graphs = importGraphs(metafile);

let selectedEntries = entries;
let selectedScripts = scriptTests;
if (options.changed || options.paths.length > 0) {
  let targets = options.paths;
  let runEverything = false;
  if (options.changed) {
    const changed = changedFiles(options.base);
    runEverything = changed.some(isGlobalChange);
    targets = [...targets, ...changed];
  }
  if (!runEverything) {
    selectedEntries = selectBundledTests(graphs, targets);
    selectedScripts = selectScriptTests(scriptTests, targets);
  }
}

const selected = selectedEntries.length + selectedScripts.length;
const total = entries.length + scriptTests.length;
if (selected === 0) {
  if (options.paths.length > 0) {
    throw new Error(`No test reaches ${options.paths.join(", ")}. Check the path, or add a test if this needs one.`);
  }
  console.log(`No test imports the changed files (0 of ${total} test files selected).`);
  process.exit(0);
}
if (selected < total) console.log(`Running ${selected} of ${total} test files.`);

const outputs = selectedEntries.map((entry) => graphs.get(entry).output);
const nameFilter = options.name ? [`--test-name-pattern=${options.name}`] : [];
// A hung test must fail, not stall whoever is waiting on this command.
const child = spawn(process.execPath, ["--test", "--test-timeout=20000", ...nameFilter, ...outputs, ...selectedScripts], {
  stdio: "inherit"
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
