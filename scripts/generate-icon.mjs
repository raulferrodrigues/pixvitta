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
const linuxIconsDir = path.join(buildDir, "icons");

const linuxIconSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

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

async function ensureTool(command, purpose) {
  try {
    await execFileAsync("/usr/bin/which", [command]);
  } catch {
    throw new Error(`${command} is required to ${purpose}`);
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
await rm(linuxIconsDir, { recursive: true, force: true });
await mkdir(linuxIconsDir, { recursive: true });

await copyFile(sourcePng, iconPng);
await copyFile(sourcePng, path.join(workDir, "icon.png"));
await copyFile(sourcePng, path.join(linuxIconsDir, "1024x1024.png"));
try {
  await copyFile(sourceSvg, path.join(workDir, "icon-source.svg"));
} catch {
  // The PNG is the authoritative packaging source; the SVG export is optional.
}

if (process.platform === "darwin") {
  await ensureTool("sips", "resize application icons");
  await ensureTool("iconutil", "generate the macOS icon");
  await rm(iconsetDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });
  for (const [fileName, size] of iconsetSizes) {
    await execFileAsync("/usr/bin/sips", ["-z", String(size), String(size), iconPng, "--out", path.join(iconsetDir, fileName)]);
  }
  for (const size of linuxIconSizes.slice(0, -1)) {
    await execFileAsync("/usr/bin/sips", ["-z", String(size), String(size), iconPng, "--out", path.join(linuxIconsDir, `${size}x${size}.png`)]);
  }
  await execFileAsync("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", iconIcns]);
  console.log(`Generated ${path.relative(root, iconPng)}, ${path.relative(root, iconIcns)}, and Linux icon sizes`);
} else {
  const resizeCommand = await execFileAsync("/usr/bin/which", ["magick"]).then(() => "magick").catch(() => "convert");
  await ensureTool(resizeCommand, "generate Linux icon sizes");
  for (const size of linuxIconSizes.slice(0, -1)) {
    await execFileAsync(resizeCommand, [iconPng, "-filter", "Lanczos", "-resize", `${size}x${size}`, path.join(linuxIconsDir, `${size}x${size}.png`)]);
  }
  console.log(`Generated ${path.relative(root, iconPng)} and Linux icon sizes`);
}
