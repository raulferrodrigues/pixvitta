import type { EHentaiThumbnailReference } from "./html";

type CachedBytes = {
  bytes: Uint8Array;
  contentType: string;
};

type SpriteCrop = Extract<
  EHentaiThumbnailReference,
  { kind: "sprite" }
>["crop"];

type ImageSize = {
  width: number;
  height: number;
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint16(bytes: Uint8Array, start: number): number {
  return bytes[start] | (bytes[start + 1] << 8);
}

function uint24(bytes: Uint8Array, start: number): number {
  return bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16);
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (
    bytes.byteLength < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }

  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return {
      width: uint24(bytes, 24) + 1,
      height: uint24(bytes, 27) + 1
    };
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: uint16(bytes, 26) & 0x3fff,
      height: uint16(bytes, 28) & 0x3fff
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const dimensions =
      (bytes[21] |
        (bytes[22] << 8) |
        (bytes[23] << 16) |
        (bytes[24] << 24)) >>>
      0;
    return {
      width: (dimensions & 0x3fff) + 1,
      height: ((dimensions >>> 14) & 0x3fff) + 1
    };
  }
  return null;
}

function isValidCrop(crop: SpriteCrop, source: ImageSize): boolean {
  return (
    Number.isSafeInteger(crop.x) &&
    Number.isSafeInteger(crop.y) &&
    Number.isSafeInteger(crop.width) &&
    Number.isSafeInteger(crop.height) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= source.width &&
    crop.y + crop.height <= source.height
  );
}

/**
 * Chromium can decode E-Hentai's WebP sprite sheets even where Electron's
 * nativeImage cannot. Wrapping the validated, cached sprite in a tiny SVG lets
 * Chromium apply the provider-owned crop without exposing the upstream URL.
 */
export function renderSpriteThumbnail(
  sprite: CachedBytes,
  crop: SpriteCrop
): CachedBytes {
  if (sprite.contentType !== "image/webp") {
    throw new Error("E-Hentai returned a non-WebP thumbnail sprite.");
  }
  const source = webpSize(sprite.bytes);
  if (!source || !isValidCrop(crop, source)) {
    throw new Error("E-Hentai returned an invalid thumbnail sprite.");
  }

  const encodedSprite = Buffer.from(sprite.bytes).toString("base64");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${crop.width}" height="${crop.height}" ` +
    `viewBox="0 0 ${crop.width} ${crop.height}">` +
    `<image href="data:image/webp;base64,${encodedSprite}" ` +
    `x="${-crop.x}" y="${-crop.y}" ` +
    `width="${source.width}" height="${source.height}" ` +
    `preserveAspectRatio="none"/></svg>`;
  return {
    bytes: new TextEncoder().encode(svg),
    contentType: "image/svg+xml"
  };
}
