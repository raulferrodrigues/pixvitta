import { readFile } from "node:fs/promises";

function positiveInteger(value, name) {
  if (!/^[1-9]\d*$/.test(value ?? "")) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const runNumber = positiveInteger(process.argv[2], "run number");
const runAttempt = positiveInteger(process.argv[3] ?? "1", "run attempt");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const baseVersion = String(packageJson.version);
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(baseVersion);

if (!match) {
  throw new Error(`package.json version must be a stable semantic version, received ${baseVersion}`);
}

// dev's package.json already holds the next unreleased version, bumped by CI
// when each change lands, so Nightly builds use it as-is.
process.stdout.write(`${baseVersion}-nightly.${runNumber}.${runAttempt}`);
