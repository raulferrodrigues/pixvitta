// Prefetch-intent media requests run at normal priority and do not wait for
// the item to become the library selection.
export function prefetchUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("intent", "prefetch");
  return url.href;
}
