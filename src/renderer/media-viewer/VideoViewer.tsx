import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { MediaItem } from "../../shared/media";
import { classNames } from "../ui/classNames";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { MediaLoadingOverlay } from "./MediaLoadingOverlay";

export function VideoViewer({ item }: { item: MediaItem }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);
  const settings = useViewerStore((state) => state.settings);
  const mediaErrors = useViewerStore((state) => state.mediaErrors);
  const isVideoLooping = useViewerStore((state) => state.isVideoLooping);
  const attachVideoElement = useViewerStore((state) => state.attachVideoElement);
  const markMediaBroken = useViewerStore((state) => state.markMediaBroken);
  const setVideoPlaying = useViewerStore((state) => state.setVideoPlaying);
  const setVideoAudio = useViewerStore((state) => state.setVideoAudio);
  const isLoaded = loadedItemId === item.id;

  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    attachVideoElement(element);
  }, [attachVideoElement]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.volume !== settings.videoVolume) {
      video.volume = settings.videoVolume;
    }
    if (video.muted !== settings.videoMuted) {
      video.muted = settings.videoMuted;
    }
  }, [item.id, settings.videoMuted, settings.videoVolume]);

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
    <div className="media-viewer-interaction" onContextMenu={showContextMenu}>
      {!isLoaded ? <MediaLoadingOverlay item={item} /> : null}
      <video
        key={item.id}
        ref={setVideoRef}
        className={classNames(
          "media-object",
          "video-object",
          `media-scale-${settings.mediaScaleMode}`,
          !isLoaded && "is-media-loading"
        )}
        data-testid="video-media"
        src={item.url}
        controls={settings.showVideoControls}
        autoPlay={settings.videoAutoplay}
        loop={isVideoLooping}
        playsInline
        onLoadedData={() => setLoadedItemId(item.id)}
        onPlay={() => setVideoPlaying(true)}
        onPause={() => setVideoPlaying(false)}
        onEnded={() => setVideoPlaying(false)}
        onVolumeChange={(event) => {
          setVideoAudio(event.currentTarget.volume, event.currentTarget.muted);
        }}
        onError={() => markMediaBroken(item.id)}
      />
    </div>
  );
}
