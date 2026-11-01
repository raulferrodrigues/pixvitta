import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGT } from "gt-react";
import type { MediaItem } from "../../../shared/media";
import type { MediaScaleMode } from "../../../shared/settings";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { classNames } from "../../ui/classNames";
import { MediaLoadingOverlay } from "./MediaLoadingOverlay";
import { prefetchUrl } from "./prefetchUrl";
import { useMediaSource } from "./useMediaSource";

const ITEM_GAP_PX = 8;
const OVERSCAN = 2;
// Items that only fly past during a fast scroll never start a request.
const LOAD_SETTLE_MS = 120;
const IMAGE_ASPECT_ESTIMATE = 1.42;
const VIDEO_ASPECT_ESTIMATE = 9 / 16;
// The current item is the one crossing this fraction of the viewport height.
const SELECTION_PROBE_RATIO = 0.4;
const ARROW_SCROLL_PX = 80;
const PAGE_SCROLL_RATIO = 0.85;

type NaturalSize = { width: number; height: number };
type FrameSize = { width: number; height: number };

function frameSize(item: MediaItem, natural: NaturalSize | undefined, columnWidth: number, mediaScaleMode: MediaScaleMode): FrameSize {
  const ratio = natural ? natural.height / natural.width : item.kind === "video" ? VIDEO_ASPECT_ESTIMATE : IMAGE_ASPECT_ESTIMATE;
  const width = natural && mediaScaleMode === "native-or-smaller" ? Math.min(columnWidth, natural.width) : columnWidth;
  return { width: Math.round(width), height: Math.max(1, Math.round(width * ratio)) };
}

function isKeyboardInputTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']") !== null;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function ContinuousViewer() {
  const items = useViewerStore((state) => state.items);
  const index = useViewerStore((state) => state.index);
  const columnScale = useViewerStore((state) => state.continuousColumnScale);
  const mediaScaleMode = useViewerStore((state) => state.settings.mediaScaleMode);
  const selectMedia = useViewerStore((state) => state.selectMedia);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const naturalSizesRef = useRef(new Map<string, NaturalSize>());
  const [, setNaturalSizeRevision] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  // Scrolling to a navigation target must not reselect a neighbor that shares
  // the probe line. User scroll input resumes following the viewport.
  const followsScrollRef = useRef(true);
  const scrolledItemIdRef = useRef<string | null>(null);
  // Where the current item sat in the last scrolled layout. Measurements are
  // already recomputed by the time a layout change is observed.
  const scrollAnchorRef = useRef<{ index: number; fraction: number } | null>(null);
  const columnWidth = Math.max(1, Math.floor(viewportWidth * columnScale));
  const currentItem = items[index];

  const getItemKey = useCallback((itemIndex: number) => items[itemIndex]?.id ?? itemIndex, [items]);
  const sizeFor = useCallback(
    (item: MediaItem) => frameSize(item, naturalSizesRef.current.get(item.id), columnWidth, mediaScaleMode),
    [columnWidth, mediaScaleMode]
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: viewportWidth > 0 ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (itemIndex) => {
      const item = items[itemIndex];
      return item ? sizeFor(item).height : 1;
    },
    getItemKey,
    gap: ITEM_GAP_PX,
    overscan: OVERSCAN,
    paddingStart: ITEM_GAP_PX,
    paddingEnd: ITEM_GAP_PX,
    scrollPaddingStart: ITEM_GAP_PX
  });
  // The default skips corrections while scrolling backward, so items loading
  // above a jump target to an earlier item would push the target away.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => item.start < (virtualizer.scrollOffset ?? 0);

  const recordNaturalSize = useCallback((itemId: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    const previous = naturalSizesRef.current.get(itemId);
    if (previous?.width === width && previous.height === height) return;
    naturalSizesRef.current.set(itemId, { width, height });
    setNaturalSizeRevision((revision) => revision + 1);
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const readWidth = () => setViewportWidth(element.clientWidth);
    readWidth();
    const observer = new ResizeObserver(readWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A column width change resizes every item. Remeasure from the known aspect
  // ratios, then restore the relative position inside the current item once
  // the remeasured layout has rendered.
  const layoutKey = `${columnWidth}:${mediaScaleMode}`;
  const previousLayoutKeyRef = useRef(layoutKey);
  const [layoutAnchor, setLayoutAnchor] = useState<{ index: number; fraction: number } | null>(null);
  useLayoutEffect(() => {
    if (previousLayoutKeyRef.current === layoutKey) return;
    previousLayoutKeyRef.current = layoutKey;
    const anchor = scrollAnchorRef.current;
    virtualizer.measure();
    setLayoutAnchor({ index, fraction: anchor?.index === index ? anchor.fraction : 0 });
  }, [index, layoutKey, virtualizer]);

  useLayoutEffect(() => {
    const item = layoutAnchor ? virtualizer.measurementsCache[layoutAnchor.index] : undefined;
    if (!layoutAnchor || !item) return;
    setLayoutAnchor(null);
    followsScrollRef.current = false;
    // Through the virtualizer, so its size corrections start from this offset.
    virtualizer.scrollToOffset(item.start - ITEM_GAP_PX + layoutAnchor.fraction * item.size);
  }, [layoutAnchor, virtualizer]);

  useLayoutEffect(() => {
    if (!currentItem || viewportWidth <= 0 || currentItem.id === scrolledItemIdRef.current) return;
    scrolledItemIdRef.current = currentItem.id;
    followsScrollRef.current = false;
    virtualizer.scrollToIndex(index, { align: "start" });
  }, [currentItem, index, viewportWidth, virtualizer]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const recordAnchor = () => {
      const item = virtualizer.measurementsCache[index];
      scrollAnchorRef.current = item && item.size > 0
        ? { index, fraction: Math.max(0, (element.scrollTop + ITEM_GAP_PX - item.start) / item.size) }
        : null;
    };
    const followSelection = () => {
      recordAnchor();
      if (!followsScrollRef.current || items.length === 0) return;
      let nextIndex: number | undefined;
      if (element.scrollTop <= 0) nextIndex = 0;
      else if (element.scrollTop + element.clientHeight >= element.scrollHeight - 1) nextIndex = items.length - 1;
      else nextIndex = virtualizer.getVirtualItemForOffset(element.scrollTop + element.clientHeight * SELECTION_PROBE_RATIO)?.index;
      const nextItem = nextIndex === undefined ? undefined : items[nextIndex];
      if (nextIndex === undefined || !nextItem || nextItem.id === scrolledItemIdRef.current) return;
      scrolledItemIdRef.current = nextItem.id;
      selectMedia(nextIndex);
    };
    const resumeFollowing = () => { followsScrollRef.current = true; };
    const scrollByKeyboard = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isKeyboardInputTarget(event.target)) return;
      const page = element.clientHeight * PAGE_SCROLL_RATIO;
      let delta: number;
      if (event.key === "ArrowDown") delta = ARROW_SCROLL_PX;
      else if (event.key === "ArrowUp") delta = -ARROW_SCROLL_PX;
      else if (event.key === "PageDown") delta = page;
      else if (event.key === "PageUp") delta = -page;
      else if (event.key === "Home") delta = -element.scrollTop;
      else if (event.key === "End") delta = element.scrollHeight;
      // Space keeps toggling playback while a video is current.
      else if (event.key === " " && items[index]?.kind !== "video") delta = event.shiftKey ? -page : page;
      else return;
      event.preventDefault();
      event.stopPropagation();
      resumeFollowing();
      element.scrollBy({ top: delta, behavior: event.repeat ? "auto" : scrollBehavior() });
    };
    element.addEventListener("scroll", followSelection, { passive: true });
    element.addEventListener("wheel", resumeFollowing, { passive: true });
    element.addEventListener("pointerdown", resumeFollowing);
    // Capture runs before the global shortcuts and the page's own scrolling, so
    // the viewer scrolls regardless of which control has focus.
    window.addEventListener("keydown", scrollByKeyboard, { capture: true });
    return () => {
      element.removeEventListener("scroll", followSelection);
      element.removeEventListener("wheel", resumeFollowing);
      element.removeEventListener("pointerdown", resumeFollowing);
      window.removeEventListener("keydown", scrollByKeyboard, { capture: true });
    };
  }, [index, items, selectMedia, virtualizer]);

  return (
    <>
      <div ref={scrollRef} className="continuous-viewer" data-testid="continuous-viewer">
        <div className="continuous-viewer-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            if (!item) return null;
            return (
              <div key={virtualItem.key} ref={virtualizer.measureElement} className="continuous-viewer-row" data-index={virtualItem.index} style={{ transform: `translateY(${virtualItem.start}px)` }}>
                <ContinuousItem
                  item={item}
                  size={sizeFor(item)}
                  isCurrent={virtualItem.index === index}
                  hasLoadedBefore={naturalSizesRef.current.has(item.id)}
                  onNaturalSize={recordNaturalSize}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="continuous-scrollbar-passage" aria-hidden />
    </>
  );
}

type ContinuousItemProps = {
  item: MediaItem;
  size: FrameSize;
  isCurrent: boolean;
  hasLoadedBefore: boolean;
  onNaturalSize(itemId: string, width: number, height: number): void;
};

function ContinuousItem({ item, size, isCurrent, hasLoadedBefore, onNaturalSize }: ContinuousItemProps) {
  const gt = useGT();
  const hasMediaError = useViewerStore((state) => state.mediaErrors.has(item.id));
  const url = useMemo(() => prefetchUrl(item.url), [item.url]);
  const source = useMediaSource(item, url);
  const [isArmed, setIsArmed] = useState(hasLoadedBefore);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (isArmed) return;
    const timer = window.setTimeout(() => setIsArmed(true), LOAD_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [isArmed]);

  function showContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void window.pixvitta.showMediaContextMenu(item.id);
  }

  return (
    <div
      className={classNames("continuous-item", isCurrent && "is-current")}
      style={{ width: `${size.width}px`, height: `${size.height}px` }}
      data-testid="continuous-item"
      aria-current={isCurrent ? "true" : undefined}
      onContextMenu={showContextMenu}
    >
      {hasMediaError ? (
        <div className="continuous-item-error">{gt("Could not load")} {item.name}.</div>
      ) : (
        <>
          {!isLoaded ? <MediaLoadingOverlay item={item} /> : null}
          {isArmed && item.kind === "image" ? (
            <img
              className={classNames("continuous-media", !isLoaded && "is-media-loading")}
              src={source.src}
              alt={item.name}
              decoding="async"
              draggable={false}
              onLoad={(event) => {
                onNaturalSize(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                setIsLoaded(true);
              }}
              onError={source.handleError}
            />
          ) : null}
          {isArmed && item.kind === "video" ? (
            <ContinuousVideo
              item={item}
              src={source.src}
              isCurrent={isCurrent}
              isLoaded={isLoaded}
              onNaturalSize={onNaturalSize}
              onLoaded={() => setIsLoaded(true)}
              onError={source.handleError}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

type ContinuousVideoProps = {
  item: MediaItem;
  src: string;
  isCurrent: boolean;
  isLoaded: boolean;
  onNaturalSize(itemId: string, width: number, height: number): void;
  onLoaded(): void;
  onError: ReturnType<typeof useMediaSource>["handleError"];
};

function ContinuousVideo({ item, src, isCurrent, isLoaded, onNaturalSize, onLoaded, onError }: ContinuousVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const settings = useViewerStore((state) => state.settings);
  const isVideoLooping = useViewerStore((state) => state.isVideoLooping);
  const attachVideoElement = useViewerStore((state) => state.attachVideoElement);
  const setVideoPlaying = useViewerStore((state) => state.setVideoPlaying);
  const setVideoAudio = useViewerStore((state) => state.setVideoAudio);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.volume !== settings.videoVolume) video.volume = settings.videoVolume;
    if (video.muted !== settings.videoMuted) video.muted = settings.videoMuted;
  }, [settings.videoMuted, settings.videoVolume]);

  // Only the current video receives playback shortcuts and autoplays. A layout
  // effect detaches before the single viewer's video ref attaches.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !isCurrent) return;
    attachVideoElement(video);
    if (settings.videoAutoplay) void video.play().catch(() => setVideoPlaying(false));
    return () => {
      attachVideoElement(null);
      video.pause();
    };
  }, [attachVideoElement, isCurrent, setVideoPlaying, settings.videoAutoplay]);

  return (
    <video
      ref={videoRef}
      className={classNames("continuous-media", !isLoaded && "is-media-loading")}
      src={src}
      controls={settings.showVideoControls}
      loop={isVideoLooping}
      playsInline
      preload="auto"
      onLoadedMetadata={(event) => onNaturalSize(item.id, event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
      onLoadedData={onLoaded}
      onPlay={() => { if (isCurrent) setVideoPlaying(true); }}
      onPause={() => { if (isCurrent) setVideoPlaying(false); }}
      onEnded={() => { if (isCurrent) setVideoPlaying(false); }}
      onVolumeChange={(event) => setVideoAudio(event.currentTarget.volume, event.currentTarget.muted)}
      onError={onError}
    />
  );
}
