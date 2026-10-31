import type { CSSProperties } from "react";
import { DownloadPanel } from "../../parts/downloads/DownloadPanel";
import { Filmstrip } from "../../parts/filmstrip/Filmstrip";
import { MediaViewer } from "../../parts/media-viewer/MediaViewer";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectHasMedia } from "../../state/viewerSelectors";
import { classNames } from "../../ui/classNames";
import type { LayoutProps } from "../types";
import { ClassicControls } from "./ClassicControls";
import { ClassicTopBar } from "./ClassicTopBar";
import { useAutoHideControls } from "./useAutoHideControls";
import "./classic.css";

// A top bar with the controls centered in it, the filmstrip in a column on the
// left and the download panel in a column on the right. Unobtrusive mode lets
// the media fill the window and fades the bar until the pointer reaches it.
export function ClassicLayout({ buildInfo }: LayoutProps) {
  const hasMedia = useViewerStore(selectHasMedia);
  const filmstripWidth = useViewerStore((state) => state.filmstripWidth);
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const isDownloadPanelOpen = useViewerStore(
    (state) => state.isDownloadPanelOpen
  );
  const hasDownloadActivity = useViewerStore(
    (state) => state.downloadActivity.rows.length > 0
  );
  const usesUnobtrusiveControls = useViewerStore((state) => state.settings.unobtrusiveViewerControls);
  const isControlsRevealed = useAutoHideControls(usesUnobtrusiveControls && hasMedia);

  const showFilmstrip = hasMedia && isFilmstripVisible;
  const style = {
    "--filmstrip-width": showFilmstrip ? `${filmstripWidth}px` : "0px",
    "--download-panel-width":
      isDownloadPanelOpen && hasDownloadActivity ? "248px" : "0px"
  } as CSSProperties;

  return (
    <main
      className={classNames(
        "app-shell",
        hasMedia && "has-media",
        usesUnobtrusiveControls && hasMedia && "has-unobtrusive-controls",
        isControlsRevealed && "is-controls-revealed"
      )}
      style={style}
      data-testid="app-shell"
    >
      {hasMedia ? <ClassicTopBar buildInfo={buildInfo} /> : null}
      {hasMedia ? <ClassicControls /> : null}
      {showFilmstrip ? <Filmstrip orientation="vertical" /> : null}
      <MediaViewer />
      {isDownloadPanelOpen && hasDownloadActivity ? (
        <DownloadPanel />
      ) : null}
    </main>
  );
}
