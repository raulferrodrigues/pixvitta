import { useEffect } from "react";
import { IMAGE_ZOOM_STEP } from "../state/imageView";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectCurrentItem } from "../state/viewerSelectors";
import { isShortcutsSheetKey, matchesRendererHotkey, RENDERER_HOTKEYS } from "./hotkeys";

export function useKeyboardShortcuts() {
  const currentItemKind = useViewerStore((state) => selectCurrentItem(state)?.kind);
  const openFolder = useViewerStore((state) => state.openFolder);
  const refreshSource = useViewerStore((state) => state.refreshSource);
  const downloadCurrentMedia = useViewerStore((state) => state.downloadCurrentMedia);
  const zoomCurrentImage = useViewerStore((state) => state.zoomCurrentImage);
  const viewMode = useViewerStore((state) => state.viewMode);
  const scaleContinuousColumn = useViewerStore((state) => state.scaleContinuousColumn);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const toggleFullscreen = useViewerStore((state) => state.toggleFullscreen);
  const exitFullscreen = useViewerStore((state) => state.exitFullscreen);
  const settingsView = useViewerStore((state) => state.settingsView);
  const openSettings = useViewerStore((state) => state.openSettings);
  const closeSettings = useViewerStore((state) => state.closeSettings);

  useEffect(() => {
    // Continuous view zooms by widening or narrowing its column.
    const zoomBy = (multiplier: number) => {
      if (viewMode === "continuous") scaleContinuousColumn(multiplier);
      else if (currentItemKind === "image") zoomCurrentImage(multiplier);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutsSheetKey(event)) {
        event.preventDefault();
        if (settingsView === "shortcuts") closeSettings();
        else openSettings("shortcuts");
        return;
      }
      // The open settings modal keeps viewer keys from acting behind it; its
      // native dialog handles Escape.
      if (settingsView) return;
      if (event.metaKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openFolder(); return; }
      if (event.metaKey && event.key.toLowerCase() === "r") { event.preventDefault(); void refreshSource(); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.downloadCurrentMedia)) { event.preventDefault(); void downloadCurrentMedia(); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.imageZoomIn)) { event.preventDefault(); zoomBy(IMAGE_ZOOM_STEP); return; }
      if (matchesRendererHotkey(event, RENDERER_HOTKEYS.imageZoomOut)) { event.preventDefault(); zoomBy(1 / IMAGE_ZOOM_STEP); return; }
      if (event.key === " ") { event.preventDefault(); void toggleVideoPlayback(); return; }
      const key = event.key.toLowerCase();
      if (key === "f") { event.preventDefault(); void toggleFullscreen(); return; }
      if (event.key === "Escape") { event.preventDefault(); void exitFullscreen(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings, currentItemKind, downloadCurrentMedia, exitFullscreen, openFolder, openSettings, refreshSource, scaleContinuousColumn, settingsView, toggleFullscreen, toggleVideoPlayback, viewMode, zoomCurrentImage]);
}
