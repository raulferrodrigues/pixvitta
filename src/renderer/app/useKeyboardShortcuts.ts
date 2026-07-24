import { useEffect } from "react";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { IMAGE_ZOOM_STEP } from "../state/imageView";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectCurrentItem } from "../state/viewerSelectors";
import { matchesRendererHotkey, RENDERER_HOTKEYS } from "./hotkeys";

export function useKeyboardShortcuts(api: PixvittaApi) {
  const currentItemKind = useViewerStore((state) => selectCurrentItem(state)?.kind);
  const openFolder = useViewerStore((state) => state.openFolder);
  const refreshSource = useViewerStore((state) => state.refreshSource);
  const zoomCurrentImage = useViewerStore((state) => state.zoomCurrentImage);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const toggleFullscreen = useViewerStore((state) => state.toggleFullscreen);
  const exitFullscreen = useViewerStore((state) => state.exitFullscreen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openFolder(); return; }
      if (event.metaKey && event.key.toLowerCase() === "r") { event.preventDefault(); void refreshSource(); return; }
      if (event.metaKey && event.key === ",") { event.preventDefault(); void api.openPreferences(); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.imageZoomIn)) { event.preventDefault(); if (currentItemKind === "image") zoomCurrentImage(IMAGE_ZOOM_STEP); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.imageZoomOut)) { event.preventDefault(); if (currentItemKind === "image") zoomCurrentImage(1 / IMAGE_ZOOM_STEP); return; }
      if (event.key === " ") { event.preventDefault(); void toggleVideoPlayback(); return; }
      const key = event.key.toLowerCase();
      if (key === "f") { event.preventDefault(); void toggleFullscreen(); return; }
      if (event.key === "Escape") { event.preventDefault(); void exitFullscreen(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, currentItemKind, exitFullscreen, openFolder, refreshSource, toggleFullscreen, toggleVideoPlayback, zoomCurrentImage]);
}
