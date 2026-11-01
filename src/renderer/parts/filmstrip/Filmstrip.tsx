import { useLayoutEffect, useRef, type WheelEvent } from "react";
import { useVirtualizer, type VirtualizerOptions } from "@tanstack/react-virtual";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { classNames } from "../../ui/classNames";
import { FilmstripItem } from "./FilmstripItem";
import { FilmstripResizer } from "./FilmstripResizer";
import "./filmstrip.css";

const FILMSTRIP_GAP_PX = 10;
const FILMSTRIP_OVERSCAN = 8;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const HORIZONTAL_ITEM_SIZE_PX = 72;

export type FilmstripOrientation = "vertical" | "horizontal";

// Vertical filmstrips size their square tiles from the resizable column width.
// Horizontal filmstrips use a fixed tile size and scroll sideways.
function estimateItemSize(orientation: FilmstripOrientation, width: number): number {
  if (orientation === "horizontal") return HORIZONTAL_ITEM_SIZE_PX;
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
  if (instance.options.horizontal) {
    if (element.scrollTo) element.scrollTo({ left: nextOffset, behavior });
    else element.scrollLeft = nextOffset;
    return;
  }
  if (element.scrollTo) element.scrollTo({ top: nextOffset, behavior });
  else element.scrollTop = nextOffset;
};

// A mouse wheel only scrolls vertically, so horizontal filmstrips turn it
// into sideways scrolling.
function scrollSideways(event: WheelEvent<HTMLDivElement>) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.currentTarget.scrollLeft += event.deltaY;
}

export function Filmstrip({ orientation }: { orientation: FilmstripOrientation }) {
  const gt = useGT();
  const items = useViewerStore((state) => state.items);
  const index = useViewerStore((state) => state.index);
  const filmstripWidth = useViewerStore((state) => state.filmstripWidth);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isHorizontal = orientation === "horizontal";
  const estimatedItemSize = estimateItemSize(orientation, filmstripWidth);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedItemSize,
    getItemKey: (itemIndex) => items[itemIndex]?.id ?? itemIndex,
    gap: FILMSTRIP_GAP_PX,
    horizontal: isHorizontal,
    initialRect: isHorizontal ? { width: window.innerWidth, height: HORIZONTAL_ITEM_SIZE_PX } : { width: filmstripWidth, height: DEFAULT_VIEWPORT_HEIGHT },
    measureElement: (element) => {
      const rect = element.getBoundingClientRect();
      return (isHorizontal ? rect.width : rect.height) || estimatedItemSize;
    },
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
    <aside className={classNames("filmstrip", isHorizontal && "is-horizontal")} aria-label={gt("Filmstrip")} data-testid="filmstrip">
      <div ref={scrollRef} className="filmstrip-scrollbar filmstrip-content filmstrip-virtual-scroll" data-testid="filmstrip-scroll" onWheel={isHorizontal ? scrollSideways : undefined}>
        <div className="filmstrip-virtual-spacer" style={isHorizontal ? { width: `${virtualizer.getTotalSize()}px` } : { height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            if (!item) return null;
            return (
              <div key={virtualItem.key} ref={virtualizer.measureElement} className="filmstrip-virtual-item" data-index={virtualItem.index} style={{ transform: isHorizontal ? `translateX(${virtualItem.start}px)` : `translateY(${virtualItem.start}px)` }}>
                <FilmstripItem item={item} itemIndex={virtualItem.index} isActive={virtualItem.index === index} />
              </div>
            );
          })}
        </div>
      </div>
      {isHorizontal ? null : <div className="filmstrip-scrollbar-passage" aria-hidden />}
      {isHorizontal ? null : <FilmstripResizer />}
    </aside>
  );
}
