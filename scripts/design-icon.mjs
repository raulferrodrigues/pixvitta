// Draws the Pixvitta application icon for each build flavor.
//
// The icon is a viewer beside a filmstrip, laid out as a Fibonacci tiling of a
// 610×377 golden rectangle: the 377 square is the viewer, and the 233, 144,
// 89, 55 and 34 squares spiral away from it as the strip. Every other size,
// radius, position and fade is a power of φ.
//
// Writes assets/pixvitta-icon.svg (stable), assets/pixvitta-nightly-icon.svg
// and assets/pixvitta-dev-icon.svg, plus a 1024px PNG next to each. These are
// full-bleed: the rounded body fills the canvas, as Linux docks expect. Stable
// also gets assets/pixvitta-icon-macos.png, the same icon on the macOS grid
// (see BODY_SIZE) for the .icns. Those PNGs are what `pnpm icon:generate`
// packages. Rendering uses Playwright's Chromium: run
// `pnpm exec playwright install chromium` once if it is missing.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHI = (1 + Math.sqrt(5)) / 2;
const SIZE = 1024;
const round = (value) => +value.toFixed(2);

// The body follows the macOS icon grid: an 824px rounded square centred on the
// 1024px canvas, leaving room for the drop shadow macOS expects. Its corner
// radius is 824/φ³. The full-bleed layout crops the canvas to the body.
const BODY_SIZE = 824;
const BODY_ORIGIN = (SIZE - BODY_SIZE) / 2;
const BODY_RADIUS = BODY_SIZE / PHI ** 3;

const BODY = "url(#body)";
const MARK = "url(#mark)";

// Fibonacci tiling of the 610×377 golden rectangle, viewer on the right. The
// last tile is the 34×21 remainder left once the spiral gets too small to see.
const TILING_WIDTH = 610;
const TILING_HEIGHT = 377;
const VIEWER = [233, 0, 377, 377];
const STRIP = [
  [0, 0, 233, 233],
  [0, 233, 144, 144],
  [144, 288, 89, 89],
  [178, 233, 55, 55],
  [144, 233, 34, 34],
  [144, 267, 34, 21]
];
const TILE_GAP = 9;
const FRAME_STROKE = 34;

function roundedRect(x, y, width, height, fill, attributes = "") {
  const radius = Math.min(width, height) / PHI ** 4;
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${round(radius)}" fill="${fill}"${attributes}/>`;
}

// A sun on the golden point and two peaks at φ-derived positions.
function landscape(x, y, width, height) {
  const bottom = y + height;
  const at = (t) => round(x + width * t);
  const sun = `<circle cx="${at(1 / PHI)}" cy="${round(y + height / PHI ** 2.2)}" r="${round(width / PHI ** 4)}" fill="${MARK}"/>`;
  const peaks = [
    [0, 0],
    [1 / PHI ** 2, height / PHI ** 1.5],
    [0.57, height / PHI ** 4],
    [0.8, height / PHI ** 3],
    [1, 0]
  ];
  const outline = peaks
    .map(([t, rise], index) => `${index === 0 ? "M" : "L"}${at(t)},${round(bottom - rise)}`)
    .join(" ");
  const mountains = `<path d="${outline} Z" fill="${MARK}" stroke="${MARK}" stroke-width="${round(width / PHI ** 7)}" stroke-linejoin="round"/>`;
  return sun + mountains;
}

function mark() {
  const originX = SIZE / 2 - TILING_WIDTH / 2;
  const originY = SIZE / 2 - TILING_HEIGHT / 2;

  const [viewerX, viewerY, viewerSize] = VIEWER;
  const frameX = originX + viewerX + TILE_GAP;
  const frameY = originY + viewerY + TILE_GAP;
  const frameSize = viewerSize - 2 * TILE_GAP;
  const frameRadius = frameSize / PHI ** 4;
  const innerX = frameX + FRAME_STROKE;
  const innerY = frameY + FRAME_STROKE;
  const innerSize = frameSize - 2 * FRAME_STROKE;
  const padding = innerSize / PHI ** 5;

  const half = FRAME_STROKE / 2;
  let content = `<rect x="${round(frameX + half)}" y="${round(frameY + half)}" width="${round(frameSize - FRAME_STROKE)}" height="${round(frameSize - FRAME_STROKE)}" rx="${round(frameRadius - half)}" fill="none" stroke="${MARK}" stroke-width="${FRAME_STROKE}"/>`;
  content += `<clipPath id="viewer"><rect x="${round(innerX)}" y="${round(innerY)}" width="${round(innerSize)}" height="${round(innerSize)}" rx="${round(frameRadius - FRAME_STROKE)}"/></clipPath>`;
  content += `<g clip-path="url(#viewer)">${landscape(innerX + padding, innerY + padding, innerSize - 2 * padding, innerSize - padding)}</g>`;

  // Thumbnails fade by φ^-½ per step as the strip spirals away from the viewer.
  STRIP.forEach(([x, y, width, height], step) => {
    content += roundedRect(
      originX + x + TILE_GAP,
      originY + y + TILE_GAP,
      width - 2 * TILE_GAP,
      height - 2 * TILE_GAP,
      MARK,
      step === 0 ? "" : ` opacity="${round(PHI ** (-step / 2))}"`
    );
  });
  return content;
}

// Nightly: a night sky with stars placed on the golden angle.
function nightSky() {
  const glowX = BODY_ORIGIN + BODY_SIZE / PHI;
  const glowY = BODY_ORIGIN + BODY_SIZE / PHI ** 2;
  let stars = "";
  const count = 55;
  for (let index = 1; index < count; index++) {
    const angle = (index * 2 * Math.PI) / PHI ** 2;
    const distance = 405 * Math.sqrt(index / count);
    const brightness = (index * PHI) % 1;
    stars += `<circle cx="${round(SIZE / 2 + distance * Math.cos(angle))}" cy="${round(SIZE / 2 + distance * Math.sin(angle))}" r="${round(2 + 4 * brightness ** 2)}" fill="#fff" opacity="${round(0.25 + 0.55 * brightness)}"/>`;
  }
  return `<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${round(glowX)}" cy="${round(glowY)}" r="${round(BODY_SIZE / PHI)}">
    <stop offset="0" stop-color="#c58bff" stop-opacity="0.45"/><stop offset="1" stop-color="#c58bff" stop-opacity="0"/>
  </radialGradient>
  <rect x="${BODY_ORIGIN}" y="${BODY_ORIGIN}" width="${BODY_SIZE}" height="${BODY_SIZE}" fill="url(#glow)"/>${stars}`;
}

// Dev: a blueprint with a 21-cell grid and golden-section construction lines.
function blueprint() {
  const start = BODY_ORIGIN;
  const end = BODY_ORIGIN + BODY_SIZE;
  const line = (position) => {
    const at = round(position);
    return `<line x1="${at}" y1="${start}" x2="${at}" y2="${end}"/><line x1="${start}" y1="${at}" x2="${end}" y2="${at}"/>`;
  };
  let grid = "";
  for (let cell = 1; cell < 21; cell++) grid += line(start + (cell * BODY_SIZE) / 21);
  let sections = "";
  for (const t of [1 / PHI ** 2, 1 / PHI]) sections += line(start + BODY_SIZE * t);
  return `<g stroke="#fff" stroke-opacity="0.07" stroke-width="2">${grid}</g><g stroke="#fff" stroke-opacity="0.2" stroke-width="2.5" stroke-dasharray="8 13">${sections}</g>`;
}

const FLAVORS = {
  stable: { file: "pixvitta-icon", macos: true, top: "#1c1c1e", bottom: "#030303", shadow: "#000", lift: 0.6 },
  nightly: { file: "pixvitta-nightly-icon", top: "#5b2fd0", bottom: "#1d0b5c", shadow: "#0d0330", lift: 0.4, backdrop: nightSky },
  dev: { file: "pixvitta-dev-icon", top: "#3d8bff", bottom: "#163fb4", shadow: "#061a55", lift: 0.35, backdrop: blueprint }
};

// layout "full" crops to the body (Linux, window icons, T3); "macos" keeps the
// 1024 canvas with the body's drop shadow around it.
function icon(flavor, layout) {
  const body = `x="${BODY_ORIGIN}" y="${BODY_ORIGIN}" width="${BODY_SIZE}" height="${BODY_SIZE}" rx="${round(BODY_RADIUS)}"`;
  const rimInset = 1.5;
  const rim = `x="${BODY_ORIGIN + rimInset}" y="${BODY_ORIGIN + rimInset}" width="${BODY_SIZE - 2 * rimInset}" height="${BODY_SIZE - 2 * rimInset}" rx="${round(BODY_RADIUS - rimInset)}"`;
  const top = BODY_ORIGIN;
  const bottom = BODY_ORIGIN + BODY_SIZE;
  // sRGB filters: the default linearRGB visibly bands the dark gradients.
  const viewBox = layout === "macos"
    ? `0 0 ${SIZE} ${SIZE}`
    : `${BODY_ORIGIN} ${BODY_ORIGIN} ${BODY_SIZE} ${BODY_SIZE}`;
  const shadow = layout === "macos" ? `<rect ${body} fill="#000" filter="url(#drop)"/>\n` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
<defs>
  <linearGradient id="body" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">
    <stop offset="0" stop-color="${flavor.top}"/><stop offset="1" stop-color="${flavor.bottom}"/>
  </linearGradient>
  <linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">
    <stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="${round(1 / PHI ** 2)}" stop-color="#fff" stop-opacity="0.08"/>
    <stop offset="${round(1 / PHI)}" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#fff" stop-opacity="0.28"/>
  </linearGradient>
  <linearGradient id="mark" gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="824">
    <stop offset="0" stop-color="#fff"/><stop offset="${round(1 / PHI)}" stop-color="#ececec"/><stop offset="1" stop-color="#bdbdbd"/>
  </linearGradient>
  <filter id="drop" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.45"/>
  </filter>
  <filter id="lift" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feDropShadow dx="0" dy="8" stdDeviation="13" flood-color="${flavor.shadow}" flood-opacity="${flavor.lift}"/>
  </filter>
  <clipPath id="bodyClip"><rect ${body}/></clipPath>
</defs>
${shadow}<rect ${body} fill="${BODY}"/>
<g clip-path="url(#bodyClip)">${flavor.backdrop ? flavor.backdrop() : ""}<g filter="url(#lift)">${mark()}</g></g>
<rect ${rim} fill="none" stroke="url(#rim)" stroke-width="3"/>
</svg>
`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const render = async (svg, file) => {
    const pngPath = path.join(root, "assets", `${file}.png`);
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `)}</body>`
    );
    await page.screenshot({ path: pngPath, omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    console.log(`Drew ${path.relative(root, pngPath)}`);
  };
  for (const flavor of Object.values(FLAVORS)) {
    const svg = icon(flavor, "full");
    await writeFile(path.join(root, "assets", `${flavor.file}.svg`), svg);
    console.log(`Drew assets/${flavor.file}.svg`);
    await render(svg, flavor.file);
    if (flavor.macos) await render(icon(flavor, "macos"), `${flavor.file}-macos`);
  }
} finally {
  await browser.close();
}
