export function imageTransformStyle(zoom: number, panX: number, panY: number): string {
  return `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
}
