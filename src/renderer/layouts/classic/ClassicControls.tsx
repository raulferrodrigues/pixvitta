import { useGT } from "gt-react";
import { ControlGroup } from "../../parts/controls/ControlGroup";
import { DownloadButtons } from "../../parts/controls/DownloadButtons";
import { NextButton, PreviousButton } from "../../parts/controls/NavigationButtons";
import { FileOrderButton, OpenFolderButton, RefreshButton } from "../../parts/controls/SourceActions";
import { LoopButton, PlayButton } from "../../parts/controls/VideoButtons";
import { FullscreenButton, UnobtrusiveToggle } from "../../parts/controls/ViewButtons";
import { WebSourceDialog } from "../../parts/controls/WebSourceDialog";

export function ClassicControls() {
  const gt = useGT();
  return (
    <div className="viewer-controls pointer-events-none px-3 max-[420px]:px-2" role="toolbar" aria-label={gt("Viewer controls")}>
      <div className="viewer-controls-content min-w-0">
        <div className="viewer-controls-leading">
          <ControlGroup label={gt("Library controls")}>
            <OpenFolderButton />
            <WebSourceDialog />
            <RefreshButton />
          </ControlGroup>
          <FileOrderButton />
        </div>

        <ControlGroup label={gt("Media controls")} className="viewer-controls-transport">
          <PreviousButton />
          <PlayButton keepSpace />
          <NextButton />
        </ControlGroup>

        <ControlGroup label={gt("Viewing options")} className="viewer-controls-trailing">
          <LoopButton keepSpace />
          <DownloadButtons />
          <FullscreenButton />
          <UnobtrusiveToggle />
        </ControlGroup>
      </div>
    </div>
  );
}
