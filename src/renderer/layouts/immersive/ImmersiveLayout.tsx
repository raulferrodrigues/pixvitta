import type { CSSProperties } from "react";
import { useGT } from "gt-react";
import { ControlGroup } from "../../parts/controls/ControlGroup";
import { DownloadButtons } from "../../parts/controls/DownloadButtons";
import { NextButton, PreviousButton } from "../../parts/controls/NavigationButtons";
import { FileOrderButton, OpenFolderButton, RefreshButton } from "../../parts/controls/SourceActions";
import { Counter, SourceOrigin, SourceTitle } from "../../parts/controls/SourceInfo";
import { LoopButton, PlayButton } from "../../parts/controls/VideoButtons";
import { DownloadPanelToggle, FilmstripToggle, FullscreenButton, ViewModeToggle } from "../../parts/controls/ViewButtons";
import { WebSourceDialog } from "../../parts/controls/WebSourceDialog";
import { DownloadPanel } from "../../parts/downloads/DownloadPanel";
import { Filmstrip } from "../../parts/filmstrip/Filmstrip";
import { MediaViewer } from "../../parts/media-viewer/MediaViewer";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectHasMedia } from "../../state/viewerSelectors";
import { BuildFlavorBadge } from "../../ui/BuildFlavorBadge";
import type { LayoutProps } from "../types";
import { RevealZone } from "./RevealZone";
import "./immersive.css";

// The media fills the window and the controls float over it in separate
// zones that fade out and come back when the pointer moves over them. Only the
// download panel takes space of its own. Unobtrusive mode has no effect here,
// since the controls already fade.
export function ImmersiveLayout({ buildInfo }: LayoutProps) {
  const gt = useGT();
  const hasMedia = useViewerStore(selectHasMedia);
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const isDownloadPanelOpen = useViewerStore(
    (state) => state.isDownloadPanelOpen
  );
  const hasDownloadActivity = useViewerStore(
    (state) => state.downloadActivity.rows.length > 0
  );

  const showDownloadPanel = isDownloadPanelOpen && hasDownloadActivity;
  const style = {
    "--download-panel-width": showDownloadPanel ? "248px" : "0px"
  } as CSSProperties;

  return (
    <main className="immersive-shell" style={style} data-testid="app-shell">
      <div className="immersive-stage">
        <MediaViewer />
        <div className="immersive-drag-region" aria-hidden />
        {hasMedia ? (
          <>
            <RevealZone className="immersive-zone-title">
              <BuildFlavorBadge buildInfo={buildInfo} />
              <SourceTitle />
              <SourceOrigin />
              <Counter />
            </RevealZone>
            <RevealZone className="immersive-zone-actions" role="toolbar" aria-label={gt("Viewer controls")}>
              <ControlGroup label={gt("Media controls")}>
                <PlayButton />
                <LoopButton />
              </ControlGroup>
              <ControlGroup label={gt("Library controls")}>
                <OpenFolderButton />
                <WebSourceDialog />
                <RefreshButton />
                <FileOrderButton />
              </ControlGroup>
              <ControlGroup label={gt("Viewing options")}>
                <DownloadButtons />
                <ViewModeToggle />
                <FilmstripToggle />
                <DownloadPanelToggle />
                <FullscreenButton />
              </ControlGroup>
            </RevealZone>
            <RevealZone className="immersive-zone-previous">
              <PreviousButton />
            </RevealZone>
            <RevealZone className="immersive-zone-next">
              <NextButton />
            </RevealZone>
            {isFilmstripVisible ? (
              <RevealZone className="immersive-zone-filmstrip">
                <Filmstrip orientation="horizontal" />
              </RevealZone>
            ) : null}
          </>
        ) : null}
      </div>
      {showDownloadPanel ? <DownloadPanel /> : null}
    </main>
  );
}
