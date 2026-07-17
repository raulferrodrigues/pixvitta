import { Eye, EyeOff, FolderOpen, Maximize, Pause, Play, RefreshCw, Repeat, Repeat1, StepBack, StepForward } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectCurrentItem, selectHasMedia } from "../state/viewerSelectors";
import { IconButton } from "../ui/IconButton";
import { ControlGroup } from "./ControlGroup";
import { FileOrderMenu } from "./FileOrderMenu";
import "./controls.css";

export function Controls() {
  const gt = useGT();
  const currentItem = useViewerStore(selectCurrentItem);
  const hasMedia = useViewerStore(selectHasMedia);
  const folderPath = useViewerStore((state) => state.folderPath);
  const isVideoPlaying = useViewerStore((state) => state.isVideoPlaying);
  const isVideoLooping = useViewerStore((state) => state.isVideoLooping);
  const settings = useViewerStore((state) => state.settings);
  const openFolder = useViewerStore((state) => state.openFolder);
  const rescanFolder = useViewerStore((state) => state.rescanFolder);
  const setFileOrder = useViewerStore((state) => state.setFileOrder);
  const goPrevious = useViewerStore((state) => state.goPrevious);
  const goNext = useViewerStore((state) => state.goNext);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const toggleVideoLoop = useViewerStore((state) => state.toggleVideoLoop);
  const toggleFullscreen = useViewerStore((state) => state.toggleFullscreen);
  const toggleUnobtrusiveControls = useViewerStore((state) => state.toggleUnobtrusiveControls);

  if (!hasMedia) return null;
  const isVideo = currentItem?.kind === "video";
  const loopLabel = isVideoLooping ? gt("Disable video loop") : gt("Enable video loop");
  const unobtrusiveLabel = settings.unobtrusiveViewerControls ? gt("Disable unobtrusive controls") : gt("Enable unobtrusive controls");

  return (
    <div className="viewer-controls pointer-events-none px-3 max-[420px]:px-2" role="toolbar" aria-label={gt("Viewer controls")}>
      <div className="viewer-controls-content min-w-0">
        <div className="viewer-controls-leading">
          <ControlGroup label={gt("Library controls")}>
            <IconButton label={gt("Open folder")} onClick={() => void openFolder()}><FolderOpen size={18} aria-hidden /></IconButton>
            <IconButton label={gt("Rescan folder")} onClick={() => void rescanFolder()} disabled={!folderPath}><RefreshCw size={17} aria-hidden /></IconButton>
          </ControlGroup>
          <FileOrderMenu value={settings.fileOrder} onChange={(fileOrder) => void setFileOrder(fileOrder)} />
        </div>

        <ControlGroup label={gt("Media controls")} className="viewer-controls-transport">
          <IconButton label={gt("Previous media")} variant="primary" onClick={goPrevious} disabled={!hasMedia}><StepBack size={20} aria-hidden /></IconButton>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center max-[420px]:h-[38px] max-[420px]:w-[38px]" data-testid="video-playback-slot" aria-hidden={isVideo ? undefined : true}>
            {isVideo ? (
              <IconButton label={gt("Play or pause video")} variant="prominent" onClick={() => void toggleVideoPlayback()}>{isVideoPlaying ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}</IconButton>
            ) : (
              <IconButton label={gt("Play or pause video")} variant="prominent" className="video-control-placeholder" disabled data-testid="video-playback-placeholder"><Play size={20} aria-hidden /></IconButton>
            )}
          </span>
          <IconButton label={gt("Next media")} variant="primary" onClick={goNext} disabled={!hasMedia}><StepForward size={20} aria-hidden /></IconButton>
        </ControlGroup>

        <ControlGroup label={gt("Viewing options")} className="viewer-controls-trailing">
          <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center max-[420px]:h-8 max-[420px]:w-8" data-testid="video-loop-slot" aria-hidden={isVideo ? undefined : true}>
            {isVideo ? (
              <IconButton label={loopLabel} aria-pressed={isVideoLooping} data-testid="video-loop-button" onClick={toggleVideoLoop}>{isVideoLooping ? <Repeat size={18} aria-hidden data-testid="video-loop-icon-on" /> : <Repeat1 size={18} aria-hidden data-testid="video-loop-icon-off" />}</IconButton>
            ) : (
              <IconButton label={gt("Enable video loop")} className="video-control-placeholder" disabled data-testid="video-loop-placeholder"><Repeat1 size={18} aria-hidden /></IconButton>
            )}
          </span>
          <IconButton label={gt("Toggle fullscreen")} onClick={() => void toggleFullscreen()}><Maximize size={17} aria-hidden /></IconButton>
          <IconButton label={unobtrusiveLabel} aria-pressed={settings.unobtrusiveViewerControls} data-testid="unobtrusive-controls-toggle" onClick={() => void toggleUnobtrusiveControls()}>
            {settings.unobtrusiveViewerControls ? <Eye size={17} aria-hidden /> : <EyeOff size={17} aria-hidden />}
          </IconButton>
        </ControlGroup>
      </div>
    </div>
  );
}
