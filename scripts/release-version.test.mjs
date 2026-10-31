import assert from "node:assert/strict";
import test from "node:test";
import { devVersionAfterRelease, nextVersion } from "./release-version.mjs";

test("bump levels follow X.Y.Z", () => {
  assert.equal(nextVersion("0.4.3", "patch"), "0.4.4");
  assert.equal(nextVersion("0.4.3", "minor"), "0.5.0");
  assert.equal(nextVersion("0.4.3", "major"), "1.0.0");
  assert.throws(() => nextVersion("0.4.3", "huge"));
  assert.throws(() => nextVersion("0.4.3-nightly.1.1", "patch"));
});

test("dev continues from a minor or major release", () => {
  assert.equal(devVersionAfterRelease("0.4.3", "0.5.0"), "0.5.0");
  assert.equal(devVersionAfterRelease("0.4.3", "1.0.0"), "1.0.0");
  // A change landed on dev while the release was being cut.
  assert.equal(devVersionAfterRelease("0.4.4", "0.5.0"), "0.5.0");
});

test("dev never moves backwards after a hotfix", () => {
  assert.equal(devVersionAfterRelease("0.4.3", "0.4.1"), "0.4.4");
  assert.equal(devVersionAfterRelease("0.4.0", "0.4.1"), "0.4.1");
  assert.equal(devVersionAfterRelease("0.4.1", "0.4.2"), "0.4.2");
});
