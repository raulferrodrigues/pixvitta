export function nextIndex(current: number, total: number, wrap: boolean): number {
  if (total <= 0) return 0;
  if (!wrap) return Math.min(current + 1, total - 1);
  return (current + 1) % total;
}

export function previousIndex(current: number, total: number, wrap: boolean): number {
  if (total <= 0) return 0;
  if (!wrap) return Math.max(current - 1, 0);
  return (current - 1 + total) % total;
}
