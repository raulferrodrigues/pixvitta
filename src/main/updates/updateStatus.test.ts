import assert from "node:assert/strict";
import test from "node:test";
import { createAppBuildInfo, resolveBuildFlavor } from "../../shared/appBuild";
import { getLinuxUpdatePackageType, getUpdateChannel, getUpdatesUnavailableMessage } from "./updateStatus";

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

test("resolves stable and development build identities", () => {
  assert.equal(resolveBuildFlavor({ version: "1.2.3" }), "stable");
  assert.equal(resolveBuildFlavor({ version: "1.2.4-dev.12.1" }), "dev");
  assert.equal(resolveBuildFlavor({ version: "1.2.3", productName: "Pixvitta Dev" }), "dev");
  assert.equal(resolveBuildFlavor({ version: "1.2.3", flavorOverride: "dev" }), "dev");
  assert.equal(resolveBuildFlavor({ version: "1.2.4-dev.12.1", flavorOverride: "stable" }), "stable");
  assert.deepEqual(createAppBuildInfo({ version: "1.2.4-dev.12.1" }), {
    flavor: "dev",
    name: "Pixvitta Dev",
    version: "1.2.4-dev.12.1"
  });
});

test("maps build flavors to independent update channels", () => {
  assert.equal(getUpdateChannel("stable"), "latest");
  assert.equal(getUpdateChannel("dev"), "dev");
});
