import type { MediaItem } from "../../shared/media";

export function nextIndex(current: number, total: number, wrap = true): number {
  if (total <= 0) return 0;
  if (!wrap) return Math.min(current + 1, total - 1);
  return (current + 1) % total;
}

export function previousIndex(current: number, total: number, wrap = true): number {
  if (total <= 0) return 0;
  if (!wrap) return Math.max(current - 1, 0);
  return (current - 1 + total) % total;
}

export function selectAfterRescan(
  previousItemId: string | undefined,
  newItems: MediaItem[],
  previousIndexValue: number
): number {
  if (newItems.length === 0) return 0;
  if (previousItemId) {
    const sameItemIndex = newItems.findIndex((item) => item.id === previousItemId);
    if (sameItemIndex >= 0) return sameItemIndex;
  }
  return Math.min(Math.max(previousIndexValue, 0), newItems.length - 1);
}
