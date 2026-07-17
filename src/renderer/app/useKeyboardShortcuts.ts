import { useEffect } from "react";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { IMAGE_ZOOM_STEP } from "../state/imageView";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectCurrentItem } from "../state/viewerSelectors";
import { matchesRendererHotkey, RENDERER_HOTKEYS } from "./hotkeys";

const VIDEO_SEEK_SECONDS = 5;

export function useKeyboardShortcuts(api: PixvittaApi) {
  const currentItemKind = useViewerStore((state) => selectCurrentItem(state)?.kind);
  const openFolder = useViewerStore((state) => state.openFolder);
  const rescanFolder = useViewerStore((state) => state.rescanFolder);
  const goNext = useViewerStore((state) => state.goNext);
  const goPrevious = useViewerStore((state) => state.goPrevious);
  const zoomCurrentImage = useViewerStore((state) => state.zoomCurrentImage);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const seekVideoBy = useViewerStore((state) => state.seekVideoBy);
  const toggleFullscreen = useViewerStore((state) => state.toggleFullscreen);
  const exitFullscreen = useViewerStore((state) => state.exitFullscreen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openFolder(); return; }
      if (event.metaKey && event.key.toLowerCase() === "r") { event.preventDefault(); void rescanFolder(); return; }
      if (event.metaKey && event.key === ",") { event.preventDefault(); void api.openPreferences(); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.imageZoomIn)) { event.preventDefault(); if (currentItemKind === "image") zoomCurrentImage(IMAGE_ZOOM_STEP); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.imageZoomOut)) { event.preventDefault(); if (currentItemKind === "image") zoomCurrentImage(1 / IMAGE_ZOOM_STEP); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); goNext(); return; }
      if (event.key === "ArrowLeft") { event.preventDefault(); goPrevious(); return; }
      if (event.key === " ") { event.preventDefault(); void toggleVideoPlayback(); return; }
      const key = event.key.toLowerCase();
      if (!event.metaKey && !event.ctrlKey && !event.altKey && key === "k") { if (currentItemKind === "video") { event.preventDefault(); void toggleVideoPlayback(); } return; }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && (key === "j" || key === "l")) { if (seekVideoBy(key === "j" ? -VIDEO_SEEK_SECONDS : VIDEO_SEEK_SECONDS)) event.preventDefault(); return; }
      if (key === "f") { event.preventDefault(); void toggleFullscreen(); return; }
      if (event.key === "Escape") { event.preventDefault(); void exitFullscreen(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, currentItemKind, exitFullscreen, goNext, goPrevious, openFolder, rescanFolder, seekVideoBy, toggleFullscreen, toggleVideoPlayback, zoomCurrentImage]);
}
