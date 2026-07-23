import { FolderOpen, StepForward } from "lucide-react";
import { T, useGT } from "gt-react";
import { WebSourceDialog } from "../controls/WebSourceDialog";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectCurrentItem, selectIsCurrentItemBroken } from "../state/viewerSelectors";
import { PrimaryButton } from "../ui/PrimaryButton";
import { ImageViewer } from "./ImageViewer";
import { MediaFilenameOverlay } from "./MediaFilenameOverlay";
import { VideoViewer } from "./VideoViewer";
import "./media-viewer.css";

export function MediaViewer() {
  const gt = useGT();
  const loadState = useViewerStore((state) => state.loadState);
  const currentItem = useViewerStore(selectCurrentItem);
  const isCurrentItemBroken = useViewerStore(selectIsCurrentItemBroken);
  const openFolder = useViewerStore((state) => state.openFolder);
  const goNext = useViewerStore((state) => state.goNext);

  return (
    <section className="media-viewer" aria-live="polite">
      {loadState === "loading" && <div className="text-pix-state"><T>Loading...</T></div>}
      {loadState === "empty" && (
        <div className="flex flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="empty-state">
          <p><T>No supported media in this folder.</T></p>
          <div className="flex flex-wrap justify-center gap-3">
            <PrimaryButton onClick={() => void openFolder()}><FolderOpen size={20} aria-hidden /><span><T>Open Folder</T></span></PrimaryButton>
            <WebSourceDialog trigger="button" />
          </div>
        </div>
      )}
      {loadState === "error" && (
        <div className="flex flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="app-error">
          <p><T>Something went wrong.</T></p>
          <PrimaryButton onClick={() => void openFolder()}><FolderOpen size={20} aria-hidden /><span><T>Open Folder</T></span></PrimaryButton>
        </div>
      )}
      {loadState === "ready" && currentItem && (
        isCurrentItemBroken ? (
          <div className="flex flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="media-error">
            <p>{gt("Could not load")} {currentItem.name}.</p>
            <PrimaryButton onClick={goNext}><StepForward size={20} aria-hidden /><span>{gt("Next")}</span></PrimaryButton>
          </div>
        ) : currentItem.kind === "image" ? <ImageViewer item={currentItem} /> : <VideoViewer item={currentItem} />
      )}
      {loadState === "ready" && currentItem ? <MediaFilenameOverlay /> : null}
    </section>
  );
}
