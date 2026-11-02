import { useGT } from "gt-react";
import { ControlGroup } from "../../parts/controls/ControlGroup";
import { NextButton, PreviousButton } from "../../parts/controls/NavigationButtons";
import { FileOrderButton } from "../../parts/controls/SourceActions";
import { LoopButton, PlayButton } from "../../parts/controls/VideoButtons";

// File order and loop flank the transport the way shuffle and repeat flank a
// music player's: both change what plays next. Both sit in fixed-width slots
// so the transport stays centered when either is missing.
export function ClassicControls() {
  const gt = useGT();
  return (
    <div className="viewer-controls" role="toolbar" aria-label={gt("Viewer controls")}>
      <div className="viewer-controls-slot">
        <FileOrderButton />
      </div>
      <ControlGroup label={gt("Media controls")} className="viewer-controls-transport">
        <PreviousButton />
        <PlayButton keepSpace />
        <NextButton />
      </ControlGroup>
      <div className="viewer-controls-slot">
        <LoopButton keepSpace />
      </div>
    </div>
  );
}
