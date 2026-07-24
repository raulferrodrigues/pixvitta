import { Film } from "lucide-react";
import { useGT } from "gt-react";
import { type MouseEvent as ReactMouseEvent, type SyntheticEvent, useEffect, useRef, useState } from "react";
import type { MediaItem } from "../../shared/media";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { createMediaThumbnailDataUrl } from "./thumbnailCapture";

type FilmstripItemProps = { item: MediaItem; itemIndex: number; isActive: boolean };
type PreviewMode = "thumbnail" | "image-capture" | "video-capture" | "fallback";

export function FilmstripItem({ item, itemIndex, isActive }: FilmstripItemProps) {
  const gt = useGT();
  const hasMediaError = useViewerStore((state) => state.mediaErrors.has(item.id));
  const selectMedia = useViewerStore((state) => state.selectMedia);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("thumbnail");
  const [thumbnailSrc, setThumbnailSrc] = useState(item.thumbnailUrl);
  const isCapturingFrameRef = useRef(false);
  const hasRequestedSeekRef = useRef(false);

  useEffect(() => {
    setPreviewMode("thumbnail");
    setThumbnailSrc(item.thumbnailUrl);
    isCapturingFrameRef.current = false;
    hasRequestedSeekRef.current = false;
  }, [item.id, item.thumbnailUrl]);

  function showMediaContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void window.pixvitta.showMediaContextMenu(item.id);
  }

  function handleThumbnailError() {
    setPreviewMode(item.kind === "video" ? "video-capture" : "image-capture");
  }

  async function saveCapturedThumbnail(source: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
    if (isCapturingFrameRef.current) return;
    isCapturingFrameRef.current = true;
    try {
      const thumbnailDataUrl = createMediaThumbnailDataUrl(source, sourceWidth, sourceHeight);
      if (!thumbnailDataUrl || !(await window.pixvitta.saveMediaThumbnail(item.thumbnailUrl, thumbnailDataUrl))) {
        setPreviewMode("fallback");
        return;
      }
      setThumbnailSrc(`${item.thumbnailUrl}?captured=${Date.now()}`);
      setPreviewMode("thumbnail");
    } catch {
      setPreviewMode("fallback");
    } finally {
      isCapturingFrameRef.current = false;
    }
  }

  function saveImageThumbnail(image: HTMLImageElement) {
    if (previewMode === "image-capture") void saveCapturedThumbnail(image, image.naturalWidth, image.naturalHeight);
  }

  function saveVideoFrame(video: HTMLVideoElement) {
    if (previewMode !== "video-capture" || video.readyState < video.HAVE_CURRENT_DATA) return;
    void saveCapturedThumbnail(video, video.videoWidth, video.videoHeight);
  }

  function loadVideoCaptureFrame(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (hasRequestedSeekRef.current || !Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime > 0) {
      saveVideoFrame(video);
      return;
    }
    try {
      hasRequestedSeekRef.current = true;
      video.currentTime = Math.min(0.1, video.duration / 2);
    } catch {
      saveVideoFrame(video);
    }
  }

  const showFallback = hasMediaError || previewMode === "fallback";
  const showImageCapture = !showFallback && item.kind === "image" && previewMode === "image-capture";
  const showVideoCapture = !showFallback && item.kind === "video" && previewMode === "video-capture";

  return (
    <button
      className="filmstrip-item relative aspect-square w-full flex-none cursor-pointer overflow-hidden rounded-lg border border-pix-tile-border bg-pix-panel p-0 text-pix-text hover:border-pix-tile-border-hover hover:bg-pix-panel-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent aria-current:border-pix-accent aria-current:shadow-[inset_0_0_0_2px_var(--pix-accent)]"
      type="button"
      aria-label={gt("Show {name}", { name: item.name })}
      aria-current={isActive ? "true" : undefined}
      title={item.name}
      data-testid={`filmstrip-item-${itemIndex}`}
      onClick={() => selectMedia(itemIndex)}
      onContextMenu={showMediaContextMenu}
    >
      {showFallback ? (
        <span className="flex h-full w-full items-center justify-center p-1.5 text-[11px] font-semibold uppercase text-pix-muted">{item.kind === "video" ? gt("Video") : gt("Image")}</span>
      ) : (
        <>
          {showImageCapture ? (
            <img className="block h-full w-full min-w-0 object-cover" src={item.url} alt="" crossOrigin="anonymous" loading={isActive ? "eager" : "lazy"} fetchPriority={isActive ? "high" : "auto"} onLoad={(event) => saveImageThumbnail(event.currentTarget)} onError={() => setPreviewMode("fallback")} />
          ) : showVideoCapture ? (
            <video className="pointer-events-none block h-full w-full min-w-0 object-cover" src={item.url} crossOrigin="anonymous" muted playsInline preload="auto" aria-hidden tabIndex={-1} onLoadedMetadata={loadVideoCaptureFrame} onLoadedData={(event) => saveVideoFrame(event.currentTarget)} onSeeked={(event) => saveVideoFrame(event.currentTarget)} onError={() => setPreviewMode("fallback")} />
          ) : (
            <img className="block h-full w-full min-w-0 object-cover" src={thumbnailSrc} alt="" crossOrigin="anonymous" loading={isActive ? "eager" : "lazy"} fetchPriority={isActive ? "high" : "auto"} onError={handleThumbnailError} />
          )}
          {item.kind === "video" && <span className="absolute bottom-[5px] right-[5px] inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-pix-overlay text-pix-text" aria-hidden><Film size={14} /></span>}
        </>
      )}
    </button>
  );
}
