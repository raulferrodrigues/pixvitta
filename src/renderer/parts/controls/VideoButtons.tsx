import { Pause, Play, Repeat, Repeat1 } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectCurrentItem } from "../../state/viewerSelectors";
import { IconButton } from "../../ui/IconButton";

// Video buttons render nothing on images. Layouts that keep their controls in
// fixed positions pass keepSpace to show a disabled placeholder instead.
type VideoButtonProps = { keepSpace?: boolean };

export function PlayButton({ keepSpace = false }: VideoButtonProps) {
  const gt = useGT();
  const isVideo = useViewerStore((state) => selectCurrentItem(state)?.kind === "video");
  const isVideoPlaying = useViewerStore((state) => state.isVideoPlaying);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const button = isVideo ? (
    <IconButton label={gt("Play or pause video")} variant="prominent" onClick={() => void toggleVideoPlayback()}>{isVideoPlaying ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}</IconButton>
  ) : keepSpace ? (
    <IconButton label={gt("Play or pause video")} variant="prominent" className="video-control-placeholder" disabled data-testid="video-playback-placeholder"><Play size={20} aria-hidden /></IconButton>
  ) : null;
  if (!keepSpace) return button;
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center max-[420px]:h-[38px] max-[420px]:w-[38px]" data-testid="video-playback-slot" aria-hidden={isVideo ? undefined : true}>
      {button}
    </span>
  );
}

export function LoopButton({ keepSpace = false }: VideoButtonProps) {
  const gt = useGT();
  const isVideo = useViewerStore((state) => selectCurrentItem(state)?.kind === "video");
  const isVideoLooping = useViewerStore((state) => state.isVideoLooping);
  const toggleVideoLoop = useViewerStore((state) => state.toggleVideoLoop);
  const loopLabel = isVideoLooping ? gt("Disable video loop") : gt("Enable video loop");
  const button = isVideo ? (
    <IconButton label={loopLabel} aria-pressed={isVideoLooping} data-testid="video-loop-button" onClick={toggleVideoLoop}>{isVideoLooping ? <Repeat size={18} aria-hidden data-testid="video-loop-icon-on" /> : <Repeat1 size={18} aria-hidden data-testid="video-loop-icon-off" />}</IconButton>
  ) : keepSpace ? (
    <IconButton label={gt("Enable video loop")} className="video-control-placeholder" disabled data-testid="video-loop-placeholder"><Repeat1 size={18} aria-hidden /></IconButton>
  ) : null;
  if (!keepSpace) return button;
  return (
    <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center max-[420px]:h-8 max-[420px]:w-8" data-testid="video-loop-slot" aria-hidden={isVideo ? undefined : true}>
      {button}
    </span>
  );
}
