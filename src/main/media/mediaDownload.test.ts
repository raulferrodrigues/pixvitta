import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadMediaResource } from "./mediaDownload";

test("downloads resources with safe collision-free filenames", async () => {
  const downloadsDirectory = await mkdtemp(
    path.join(tmpdir(), "pixvitta-download-test-")
  );
  const resource = {
    respond: async () => new Response("media contents")
  };

  try {
    const first = await downloadMediaResource(
      downloadsDirectory,
      "../unsafe?.jpg",
      resource
    );
    const second = await downloadMediaResource(
      downloadsDirectory,
      "../unsafe?.jpg",
      resource
    );

    assert.equal(path.basename(first), "unsafe_.jpg");
    assert.equal(path.basename(second), "unsafe_ (1).jpg");
    assert.equal(await readFile(first, "utf8"), "media contents");
    assert.equal(await readFile(second, "utf8"), "media contents");
  } finally {
    await rm(downloadsDirectory, { recursive: true, force: true });
  }
});
