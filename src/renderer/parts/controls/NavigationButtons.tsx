import { StepBack, StepForward } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectHasMedia } from "../../state/viewerSelectors";
import { IconButton } from "../../ui/IconButton";

export function PreviousButton() {
  const gt = useGT();
  const hasMedia = useViewerStore(selectHasMedia);
  const goPrevious = useViewerStore((state) => state.goPrevious);
  return <IconButton label={gt("Previous media")} variant="primary" onClick={goPrevious} disabled={!hasMedia}><StepBack size={20} aria-hidden /></IconButton>;
}

export function NextButton() {
  const gt = useGT();
  const hasMedia = useViewerStore(selectHasMedia);
  const goNext = useViewerStore((state) => state.goNext);
  return <IconButton label={gt("Next media")} variant="primary" onClick={goNext} disabled={!hasMedia}><StepForward size={20} aria-hidden /></IconButton>;
}
