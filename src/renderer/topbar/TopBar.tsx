import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useGT } from "gt-react";
import type { AppBuildInfo } from "../../shared/appBuild";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectHasMedia, selectStatusText } from "../state/viewerSelectors";
import { IconButton } from "../ui/IconButton";
import { DevBuildBadge } from "../ui/DevBuildBadge";
import { useWindowChrome } from "./useWindowChrome";
import "./topbar.css";

export function TopBar({ buildInfo }: { buildInfo: AppBuildInfo }) {
  const gt = useGT();
  const hasMedia = useViewerStore(selectHasMedia);
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const statusText = useViewerStore(selectStatusText);
  const toggleFilmstrip = useViewerStore((state) => state.toggleFilmstrip);
  useWindowChrome(window.pixvitta);

  if (!hasMedia) return null;
  const label = isFilmstripVisible ? gt("Hide filmstrip") : gt("Show filmstrip");
  return (
    <header className="topbar" data-testid="title-bar" aria-label="Window title">
      <div className="topbar-traffic-space" aria-hidden />
      <IconButton label={label} aria-pressed={isFilmstripVisible} className="topbar-filmstrip-toggle" data-testid="filmstrip-toggle" onClick={toggleFilmstrip}>
        {isFilmstripVisible ? <PanelLeftClose size={17} aria-hidden /> : <PanelLeftOpen size={17} aria-hidden />}
      </IconButton>
      <DevBuildBadge buildInfo={buildInfo} />
      <div className="topbar-fill" aria-hidden />
      <div className="topbar-counter" data-testid="counter">{statusText}</div>
    </header>
  );
}
