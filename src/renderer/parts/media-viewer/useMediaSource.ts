import { useState, type SyntheticEvent } from "react";
import type { MediaItem } from "../../../shared/media";
import { useViewerStore } from "../../state/ViewerStoreProvider";

let retryCount = 0;

function retryUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("attempt", String(++retryCount));
  return url.href;
}

// Chromium reuses an in-flight request for an identical URL. Returning to an
// item before its superseded request settles attaches the new element to that
// request, so its cancellation reads as a load failure. A uniquely addressed
// retry reaches the library as a fresh request for the selected item.
export function useMediaSource(item: MediaItem, url = item.url) {
  const markMediaBroken = useViewerStore((state) => state.markMediaBroken);
  const [retry, setRetry] = useState<{ itemId: string; src: string } | null>(null);
  // Each visit to an item gets its own retry.
  if (retry && retry.itemId !== item.id) setRetry(null);
  const isRetrying = retry?.itemId === item.id;

  function handleError(event: SyntheticEvent<HTMLElement>) {
    if (!event.currentTarget.isConnected) return;
    if (isRetrying) markMediaBroken(item.id);
    else setRetry({ itemId: item.id, src: retryUrl(url) });
  }

  return { src: isRetrying ? retry.src : url, handleError };
}
