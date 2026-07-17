import { access, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const workDir = path.join(buildDir, ".icon-work");
const iconsetDir = path.join(buildDir, "icon.iconset");
const sourcePng = path.join(root, "assets", "pixvitta-icon.png");
const sourceSvg = path.join(root, "assets", "pixvitta-icon.svg");
const iconPng = path.join(buildDir, "icon.png");
const iconIcns = path.join(buildDir, "icon.icns");

const iconsetSizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024]
];

async function ensureTool(command) {
  try {
    await execFileAsync("/usr/bin/which", [command]);
  } catch {
    throw new Error(`${command} is required to generate the macOS icon`);
  }
}

try {
  await access(sourcePng);
} catch {
  throw new Error(`Icon source not found: ${path.relative(root, sourcePng)}`);
}
await mkdir(buildDir, { recursive: true });
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

await copyFile(sourcePng, iconPng);
await copyFile(sourcePng, path.join(workDir, "icon.png"));
try {
  await copyFile(sourceSvg, path.join(workDir, "icon-source.svg"));
} catch {
  // The PNG is the authoritative packaging source; the SVG export is optional.
}

if (process.platform === "darwin") {
  await ensureTool("sips");
  await ensureTool("iconutil");
  await rm(iconsetDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });
  for (const [fileName, size] of iconsetSizes) {
    await execFileAsync("/usr/bin/sips", ["-z", String(size), String(size), iconPng, "--out", path.join(iconsetDir, fileName)]);
  }
  await execFileAsync("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", iconIcns]);
  console.log(`Generated ${path.relative(root, iconPng)} and ${path.relative(root, iconIcns)}`);
} else {
  console.log(`Generated ${path.relative(root, iconPng)} (Linux packaging icon)`);
}
