const THUMBNAIL_MAX_SIZE = 512;
const THUMBNAIL_JPEG_QUALITY = 0.9;

export type CoverThumbnailGeometry = { sourceX: number; sourceY: number; sourceSize: number; outputSize: number };

export function getCoverThumbnailGeometry(sourceWidth: number, sourceHeight: number, maxSize = THUMBNAIL_MAX_SIZE): CoverThumbnailGeometry | null {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0 || maxSize <= 0) return null;
  const sourceSize = Math.min(sourceWidth, sourceHeight);
  return {
    sourceX: (sourceWidth - sourceSize) / 2,
    sourceY: (sourceHeight - sourceSize) / 2,
    sourceSize,
    outputSize: Math.max(1, Math.round(Math.min(maxSize, sourceSize)))
  };
}

export function createMediaThumbnailDataUrl(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): string | null {
  const geometry = getCoverThumbnailGeometry(sourceWidth, sourceHeight);
  if (!geometry) return null;
  const canvas = document.createElement("canvas");
  canvas.width = geometry.outputSize;
  canvas.height = geometry.outputSize;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, geometry.sourceX, geometry.sourceY, geometry.sourceSize, geometry.sourceSize, 0, 0, geometry.outputSize, geometry.outputSize);
  return canvas.toDataURL("image/jpeg", THUMBNAIL_JPEG_QUALITY);
}
