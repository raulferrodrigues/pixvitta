import {
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from "lucide-react";
import { useGT } from "gt-react";
import type { AppBuildInfo } from "../../shared/appBuild";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectHasMedia, selectStatusText } from "../state/viewerSelectors";
import { IconButton } from "../ui/IconButton";
import { BuildFlavorBadge } from "../ui/BuildFlavorBadge";
import { useWindowChrome } from "./useWindowChrome";
import "./topbar.css";

export function TopBar({ buildInfo }: { buildInfo: AppBuildInfo }) {
  const gt = useGT();
  const hasMedia = useViewerStore(selectHasMedia);
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const source = useViewerStore((state) => state.source);
  const statusText = useViewerStore(selectStatusText);
  const toggleFilmstrip = useViewerStore((state) => state.toggleFilmstrip);
  const hasDownloadActivity = useViewerStore(
    (state) => state.downloadActivity.rows.length > 0
  );
  const isDownloadPanelOpen = useViewerStore(
    (state) => state.isDownloadPanelOpen
  );
  const toggleDownloadPanel = useViewerStore(
    (state) => state.toggleDownloadPanel
  );
  useWindowChrome(window.pixvitta);

  if (!hasMedia) return null;
  const label = isFilmstripVisible ? gt("Hide filmstrip") : gt("Show filmstrip");
  return (
    <header className="topbar" data-testid="title-bar" aria-label="Window title">
      <div className="topbar-traffic-space" aria-hidden />
      <IconButton label={label} aria-pressed={isFilmstripVisible} className="topbar-filmstrip-toggle" data-testid="filmstrip-toggle" onClick={toggleFilmstrip}>
        {isFilmstripVisible ? <PanelLeftClose size={17} aria-hidden /> : <PanelLeftOpen size={17} aria-hidden />}
      </IconButton>
      <BuildFlavorBadge buildInfo={buildInfo} />
      {source?.capabilities.canOpenOrigin && source.originLabel ? (
        <button
          className="topbar-source-origin"
          type="button"
          title={gt("Open source in browser")}
          onClick={() => void window.pixvitta.openSourceOrigin(source.id)}
        >
          <span>{source.originLabel}</span>
          <ExternalLink size={12} aria-hidden />
        </button>
      ) : null}
      <div className="topbar-fill" aria-hidden />
      <div className="topbar-counter" data-testid="counter">{statusText}</div>
      {hasDownloadActivity ? (
        <IconButton
          label={
            isDownloadPanelOpen
              ? gt("Hide downloads")
              : gt("Show downloads")
          }
          aria-pressed={isDownloadPanelOpen}
          className="topbar-download-toggle"
          data-testid="download-panel-toggle"
          onClick={toggleDownloadPanel}
        >
          {isDownloadPanelOpen ? (
            <PanelRightClose size={17} aria-hidden />
          ) : (
            <PanelRightOpen size={17} aria-hidden />
          )}
        </IconButton>
      ) : null}
    </header>
  );
}
