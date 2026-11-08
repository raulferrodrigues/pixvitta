import assert from "node:assert/strict";
import test from "node:test";
import {
  createUpdateState,
  hasPendingUpdate,
  onCheckFailure,
  onCheckStart,
  onDownloaded,
  onDownloadFailure,
  onDownloadProgress,
  onDownloadStart,
  onInstallFailure,
  onNoUpdate,
  onUpdateAvailable,
  resolveUpdateAction
} from "./updates";

const idle = createUpdateState("1.0.0", "latest", null);

test("walks one update from check to install, one button step at a time", () => {
  assert.equal(resolveUpdateAction(idle), "check");

  const checking = onCheckStart(idle);
  assert.equal(resolveUpdateAction(checking), "none");

  const available = onUpdateAvailable(checking, "1.1.0");
  assert.equal(resolveUpdateAction(available), "download");
  assert.equal(hasPendingUpdate(available), true);

  const downloading = onDownloadProgress(onDownloadStart(available), 42.5);
  assert.equal(downloading.downloadPercent, 42.5);
  assert.equal(resolveUpdateAction(downloading), "none");

  const downloaded = onDownloaded(downloading, "1.1.0");
  assert.equal(resolveUpdateAction(downloaded), "install");
  assert.equal(downloaded.downloadedVersion, "1.1.0");
});

test("a failed step offers that same step again", () => {
  const available = onUpdateAvailable(idle, "1.1.0");
  const downloadFailed = onDownloadFailure(onDownloadStart(available), "socket hang up");
  assert.equal(resolveUpdateAction(downloadFailed), "download");
  assert.equal(downloadFailed.availableVersion, "1.1.0");
  assert.equal(downloadFailed.message, "socket hang up");

  const installFailed = onInstallFailure(onDownloaded(available, "1.1.0"), "pkexec was dismissed");
  assert.equal(resolveUpdateAction(installFailed), "install");
  assert.equal(hasPendingUpdate(installFailed), true);

  const checkFailed = onCheckFailure(onCheckStart(idle), "offline");
  assert.equal(resolveUpdateAction(checkFailed), "check");
  assert.equal(hasPendingUpdate(checkFailed), false);
});

test("a build that cannot update offers nothing", () => {
  const unavailable = createUpdateState("1.0.0", "latest", "unsigned-macos");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(resolveUpdateAction(unavailable), "none");
});

test("progress outside a download is ignored and kept within 0 to 100", () => {
  assert.equal(onDownloadProgress(idle, 50), idle);
  assert.equal(onDownloadProgress(onDownloadStart(onUpdateAvailable(idle, "1.1.0")), 120).downloadPercent, 100);
  assert.equal(resolveUpdateAction(onNoUpdate(onCheckStart(idle))), "check");
});
