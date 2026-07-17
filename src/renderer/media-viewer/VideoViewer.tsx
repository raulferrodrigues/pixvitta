import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { MediaItem } from "../../shared/media";
import { useViewerStore } from "../state/ViewerStoreProvider";

export function VideoViewer({ item }: { item: MediaItem }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const settings = useViewerStore((state) => state.settings);
  const mediaErrors = useViewerStore((state) => state.mediaErrors);
  const isVideoLooping = useViewerStore((state) => state.isVideoLooping);
  const attachVideoElement = useViewerStore((state) => state.attachVideoElement);
  const markMediaBroken = useViewerStore((state) => state.markMediaBroken);
  const setVideoPlaying = useViewerStore((state) => state.setVideoPlaying);

  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    attachVideoElement(element);
  }, [attachVideoElement]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !settings.videoAutoplay || mediaErrors.has(item.id)) return;
    void video.play().catch(() => setVideoPlaying(false));
  }, [item.id, mediaErrors, setVideoPlaying, settings.videoAutoplay]);

  function showContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void window.pixvitta.showMediaContextMenu(item.id);
  }

  return (
    <video
      ref={setVideoRef}
      className={`media-object video-object media-scale-${settings.mediaScaleMode}`}
      data-testid="video-media"
      src={item.url}
      controls={settings.showVideoControls}
      autoPlay={settings.videoAutoplay}
      loop={isVideoLooping}
      playsInline
      onContextMenu={showContextMenu}
      onPlay={() => setVideoPlaying(true)}
      onPause={() => setVideoPlaying(false)}
      onEnded={() => setVideoPlaying(false)}
      onError={() => markMediaBroken(item.id)}
    />
  );
}
