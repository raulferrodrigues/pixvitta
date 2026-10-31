import { pathToFileURL } from "node:url";

// Version rules for the Nightly and Stable workflows. CI owns the X.Y.Z version:
// - a change landing on dev bumps Z,
// - merging dev into main bumps Y (or X with the release:major label),
// - a hotfix PR into main with the release:hotfix label bumps Z on main.
// After any stable release, main is merged back into dev, and dev must never
// move backwards, or Nightly users would stop receiving updates.

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version) {
  const match = versionPattern.exec(version ?? "");
  if (!match) {
    throw new Error(`Expected a stable X.Y.Z version, received ${version}`);
  }
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function nextVersion(version, level) {
  const [major, minor, patch] = parseVersion(version);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Bump level must be major, minor, or patch, received ${level}`);
}

// Merging a release into dev is itself a change landing on dev, so dev takes a
// patch bump, unless the release is ahead of that (every minor or major
// release, or a hotfix when dev had nothing new).
export function devVersionAfterRelease(devVersion, releaseVersion) {
  const bumped = nextVersion(devVersion, "patch");
  return compareVersions(releaseVersion, bumped) > 0 ? releaseVersion : bumped;
}

const commands = {
  next: (version, level) => nextVersion(version, level),
  "after-release": (devVersion, releaseVersion) =>
    devVersionAfterRelease(devVersion, releaseVersion)
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const run = commands[command];
  if (!run) {
    throw new Error(
      "Usage: release-version.mjs next <version> <major|minor|patch> | after-release <dev-version> <release-version>"
    );
  }
  process.stdout.write(run(...args));
}
