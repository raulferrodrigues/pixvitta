import { useLayoutEffect, useRef } from "react";
import { useVirtualizer, type VirtualizerOptions } from "@tanstack/react-virtual";
import { useGT } from "gt-react";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { FilmstripItem } from "./FilmstripItem";
import { FilmstripResizer } from "./FilmstripResizer";
import "./filmstrip.css";

const FILMSTRIP_GAP_PX = 10;
const FILMSTRIP_OVERSCAN = 8;
const DEFAULT_VIEWPORT_HEIGHT = 600;

function estimateItemSize(width: number): number {
  return Math.max(1, width - FILMSTRIP_GAP_PX * 2);
}

const observeElementRect: VirtualizerOptions<HTMLDivElement, HTMLDivElement>["observeElementRect"] = (instance, callback) => {
  const element = instance.scrollElement;
  if (!element) return;
  const readRect = () => {
    const rect = element.getBoundingClientRect();
    callback({ width: Math.round(rect.width || element.clientWidth || 1), height: Math.round(rect.height || element.clientHeight || window.innerHeight || DEFAULT_VIEWPORT_HEIGHT) });
  };
  readRect();
  const targetWindow = instance.targetWindow;
  if (!targetWindow?.ResizeObserver) return () => {};
  const observer = new targetWindow.ResizeObserver(readRect);
  observer.observe(element, { box: "border-box" });
  return () => observer.unobserve(element);
};

const scrollToFn: VirtualizerOptions<HTMLDivElement, HTMLDivElement>["scrollToFn"] = (offset, { adjustments = 0, behavior }, instance) => {
  const element = instance.scrollElement;
  if (!element) return;
  const nextOffset = offset + adjustments;
  if (element.scrollTo) element.scrollTo({ top: nextOffset, behavior });
  else element.scrollTop = nextOffset;
};

export function Filmstrip() {
  const gt = useGT();
  const items = useViewerStore((state) => state.items);
  const index = useViewerStore((state) => state.index);
  const filmstripWidth = useViewerStore((state) => state.filmstripWidth);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const estimatedItemSize = estimateItemSize(filmstripWidth);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedItemSize,
    getItemKey: (itemIndex) => items[itemIndex]?.id ?? itemIndex,
    gap: FILMSTRIP_GAP_PX,
    initialRect: { width: filmstripWidth, height: DEFAULT_VIEWPORT_HEIGHT },
    measureElement: (element) => element.getBoundingClientRect().height || estimatedItemSize,
    observeElementRect,
    overscan: FILMSTRIP_OVERSCAN,
    paddingStart: FILMSTRIP_GAP_PX,
    paddingEnd: FILMSTRIP_GAP_PX,
    scrollToFn
  });

  const currentItemId = items[index]?.id;
  useLayoutEffect(() => {
    if (items.length > 0) virtualizer.scrollToIndex(index, { align: "center", behavior: "auto" });
  }, [index, currentItemId, items.length, virtualizer]);

  if (items.length === 0) return null;
  return (
    <aside className="filmstrip" aria-label={gt("Filmstrip")} data-testid="filmstrip">
      <div ref={scrollRef} className="filmstrip-scrollbar filmstrip-content filmstrip-virtual-scroll" data-testid="filmstrip-scroll">
        <div className="filmstrip-virtual-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            if (!item) return null;
            return (
              <div key={virtualItem.key} ref={virtualizer.measureElement} className="filmstrip-virtual-item" data-index={virtualItem.index} style={{ transform: `translateY(${virtualItem.start}px)` }}>
                <FilmstripItem item={item} itemIndex={virtualItem.index} isActive={virtualItem.index === index} />
              </div>
            );
          })}
        </div>
      </div>
      <FilmstripResizer />
    </aside>
  );
}
