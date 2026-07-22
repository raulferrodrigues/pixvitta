import assert from "node:assert/strict";
import test from "node:test";
import { getLinuxUpdatePackageType, getUpdatesUnavailableMessage } from "./updateStatus";

const packagedLinux = {
  isPackaged: true,
  platform: "linux" as const
};

test("recognizes update-capable Linux package formats", () => {
  assert.equal(getLinuxUpdatePackageType({ ...packagedLinux, appImagePath: "/tmp/Pixvitta.AppImage" }), "appimage");
  assert.equal(getLinuxUpdatePackageType({ ...packagedLinux, packageTypeMarker: "deb\n" }), "deb");
});

test("allows automatic updates for AppImage and Debian packages", () => {
  assert.equal(
    getUpdatesUnavailableMessage("1.0.0", { ...packagedLinux, appImagePath: "/tmp/Pixvitta.AppImage" }),
    ""
  );
  assert.equal(getUpdatesUnavailableMessage("1.0.0", { ...packagedLinux, packageTypeMarker: "deb" }), "");
});

test("rejects unsupported Linux package formats", () => {
  assert.match(
    getUpdatesUnavailableMessage("1.0.0", { ...packagedLinux, packageTypeMarker: "rpm" }),
    /does not support automatic updates/
  );
});
