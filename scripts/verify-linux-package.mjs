import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const flavor = process.argv[2];
const packagePath = process.argv[3];

if ((flavor !== "stable" && flavor !== "dev") || !packagePath) {
  throw new Error("Usage: node scripts/verify-linux-package.mjs <stable|dev> <package.deb>");
}

const expected = flavor === "dev"
  ? {
    packageName: "pixvitta-dev",
    productName: "Pixvitta Dev",
    executable: "pixvitta-dev",
    desktopFile: "pixvitta-dev.desktop",
    iconName: "pixvitta-dev",
    updaterCache: "pixvitta-dev-updater"
  }
  : {
    packageName: "pixvitta",
    productName: "Pixvitta",
    executable: "pixvitta",
    desktopFile: "pixvitta.desktop",
    iconName: "pixvitta",
    updaterCache: "pixvitta-updater"
  };

function requireMatch(value, pattern, description) {
  if (!pattern.test(value)) {
    throw new Error(`Linux package has an unexpected ${description}`);
  }
}

const { stdout: fields } = await execFileAsync("dpkg-deb", ["--field", packagePath]);
requireMatch(fields, new RegExp(`^Package: ${expected.packageName}$`, "m"), "package name");

for (const relationship of ["Conflicts", "Replaces", "Provides"]) {
  if (new RegExp(`^${relationship}:`, "m").test(fields)) {
    throw new Error(`${expected.packageName} must not declare ${relationship}`);
  }
}

const extractDir = await mkdtemp(path.join(os.tmpdir(), "pixvitta-package-"));
try {
  await execFileAsync("dpkg-deb", ["--extract", packagePath, extractDir]);
  const installRoot = path.join(extractDir, "opt", expected.productName);
  const desktopPath = path.join(extractDir, "usr", "share", "applications", expected.desktopFile);
  const desktopEntry = await readFile(desktopPath, "utf8");
  const updateConfig = await readFile(path.join(installRoot, "resources", "app-update.yml"), "utf8");
  const packageType = await readFile(path.join(installRoot, "resources", "package-type"), "utf8");

  await access(path.join(installRoot, expected.executable));
  await access(
    path.join(extractDir, "usr", "share", "icons", "hicolor", "128x128", "apps", `${expected.iconName}.png`)
  );
  requireMatch(desktopEntry, new RegExp(`^Name=${expected.productName}$`, "m"), "desktop name");
  requireMatch(desktopEntry, new RegExp(`^Exec=.*${expected.executable}.*%U$`, "m"), "desktop executable");
  requireMatch(desktopEntry, new RegExp(`^Icon=${expected.iconName}$`, "m"), "desktop icon");
  requireMatch(desktopEntry, new RegExp(`^StartupWMClass=${expected.executable}$`, "m"), "window class");
  requireMatch(desktopEntry, /^MimeType=.*image\/jpeg.*video\/mp4/m, "MIME associations");
  requireMatch(updateConfig, new RegExp(`^updaterCacheDirName: ${expected.updaterCache}$`, "m"), "updater cache");
  requireMatch(packageType, /^deb\s*$/, "package type marker");
} finally {
  await rm(extractDir, { recursive: true, force: true });
}

console.log(`Verified ${expected.productName} Debian package identity`);
