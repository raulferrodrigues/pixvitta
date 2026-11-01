import { FolderOpen, StepForward } from "lucide-react";
import { T, useGT } from "gt-react";
import type { MediaItem } from "../../../shared/media";
import { WebSourceDialog } from "../controls/WebSourceDialog";
import { DownloadActivityIndicator } from "../downloads/DownloadActivityIndicator";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectCurrentItem, selectIsCurrentItemBroken } from "../../state/viewerSelectors";
import { PrimaryButton } from "../../ui/PrimaryButton";
import { ContinuousViewer } from "./ContinuousViewer";
import { ImageViewer } from "./ImageViewer";
import { MediaFilenameOverlay } from "./MediaFilenameOverlay";
import { VideoViewer } from "./VideoViewer";
import "./media-viewer.css";

export function MediaViewer() {
  const loadState = useViewerStore((state) => state.loadState);
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const currentItem = useViewerStore(selectCurrentItem);
  const openFolder = useViewerStore((state) => state.openFolder);
  const viewMode = useViewerStore((state) => state.viewMode);
  const downloadActivityState = useViewerStore((state) =>
    currentItem
      ? state.downloadActivity.itemStates[currentItem.id]
      : undefined
  );
  const readyItem = loadState === "ready" ? currentItem : undefined;

  return (
    <section className="media-viewer" aria-live="polite">
      {loadState === "loading" && <div className="text-pix-state"><T>Loading...</T></div>}
      {loadState === "empty" && (
        <div className="flex flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="empty-state">
          <p><T>No supported media in this folder.</T></p>
          <div className="flex flex-wrap justify-center gap-3">
            <PrimaryButton disabled={isSourceLoading} onClick={() => void openFolder()}><FolderOpen size={20} aria-hidden /><span><T>Open Folder</T></span></PrimaryButton>
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
      {readyItem ? (
        <>
          {viewMode === "continuous" ? <ContinuousViewer /> : <SingleMedia item={readyItem} />}
          <MediaFilenameOverlay />
          <div className="media-download-activity">
            <DownloadActivityIndicator state={downloadActivityState} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function SingleMedia({ item }: { item: MediaItem }) {
  const gt = useGT();
  const isBroken = useViewerStore(selectIsCurrentItemBroken);
  const goNext = useViewerStore((state) => state.goNext);

  if (isBroken) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="media-error">
        <p>{gt("Could not load")} {item.name}.</p>
        <PrimaryButton onClick={goNext}><StepForward size={20} aria-hidden /><span>{gt("Next")}</span></PrimaryButton>
      </div>
    );
  }
  return item.kind === "image" ? <ImageViewer item={item} /> : <VideoViewer item={item} />;
}
