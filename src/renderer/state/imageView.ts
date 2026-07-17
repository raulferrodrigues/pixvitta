export const MIN_IMAGE_ZOOM = 1;
export const MAX_IMAGE_ZOOM = 10;
export const IMAGE_ZOOM_STEP = 1.35;

export function roundImageTransformValue(value: number): number {
  if (Math.abs(value) < 0.001) return 0;
  return Math.round(value * 1000) / 1000;
}

export function clampImageZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_IMAGE_ZOOM;
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, roundImageTransformValue(zoom)));
}
