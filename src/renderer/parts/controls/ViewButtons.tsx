import { Eye, EyeOff, GalleryVertical, Maximize, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { IconButton } from "../../ui/IconButton";

export function FullscreenButton() {
  const gt = useGT();
  const toggleFullscreen = useViewerStore((state) => state.toggleFullscreen);
  return <IconButton label={gt("Toggle fullscreen")} onClick={() => void toggleFullscreen()}><Maximize size={17} aria-hidden /></IconButton>;
}

export function UnobtrusiveToggle() {
  const gt = useGT();
  const isUnobtrusive = useViewerStore((state) => state.settings.unobtrusiveViewerControls);
  const toggleUnobtrusiveControls = useViewerStore((state) => state.toggleUnobtrusiveControls);
  const label = isUnobtrusive ? gt("Disable unobtrusive controls") : gt("Enable unobtrusive controls");
  return (
    <IconButton label={label} aria-pressed={isUnobtrusive} data-testid="unobtrusive-controls-toggle" onClick={() => void toggleUnobtrusiveControls()}>
      {isUnobtrusive ? <Eye size={17} aria-hidden /> : <EyeOff size={17} aria-hidden />}
    </IconButton>
  );
}

export function FilmstripToggle() {
  const gt = useGT();
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const toggleFilmstrip = useViewerStore((state) => state.toggleFilmstrip);
  const label = isFilmstripVisible ? gt("Hide filmstrip") : gt("Show filmstrip");
  return (
    <IconButton label={label} aria-pressed={isFilmstripVisible} className="filmstrip-toggle" data-testid="filmstrip-toggle" onClick={toggleFilmstrip}>
      {isFilmstripVisible ? <PanelLeftClose size={17} aria-hidden /> : <PanelLeftOpen size={17} aria-hidden />}
    </IconButton>
  );
}

export function ViewModeToggle() {
  const gt = useGT();
  const viewMode = useViewerStore((state) => state.viewMode);
  const toggleViewMode = useViewerStore((state) => state.toggleViewMode);
  const label = viewMode === "continuous" ? gt("Show one at a time") : gt("Show as continuous scroll");
  return (
    <IconButton label={label} aria-pressed={viewMode === "continuous"} className="view-mode-toggle" data-testid="view-mode-toggle" onClick={toggleViewMode}>
      <GalleryVertical size={17} aria-hidden />
    </IconButton>
  );
}

export function DownloadPanelToggle() {
  const gt = useGT();
  const hasDownloadActivity = useViewerStore(
    (state) => state.downloadActivity.rows.length > 0
  );
  const isDownloadPanelOpen = useViewerStore(
    (state) => state.isDownloadPanelOpen
  );
  const toggleDownloadPanel = useViewerStore(
    (state) => state.toggleDownloadPanel
  );
  if (!hasDownloadActivity) return null;
  return (
    <IconButton
      label={
        isDownloadPanelOpen
          ? gt("Hide downloads")
          : gt("Show downloads")
      }
      aria-pressed={isDownloadPanelOpen}
      className="download-panel-toggle"
      data-testid="download-panel-toggle"
      onClick={toggleDownloadPanel}
    >
      {isDownloadPanelOpen ? (
        <PanelRightClose size={17} aria-hidden />
      ) : (
        <PanelRightOpen size={17} aria-hidden />
      )}
    </IconButton>
  );
}
