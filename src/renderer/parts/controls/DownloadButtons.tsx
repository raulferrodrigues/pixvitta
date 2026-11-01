import { Check, CircleAlert, Download, FolderDown, LoaderCircle } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectCurrentItem } from "../../state/viewerSelectors";
import { IconButton } from "../../ui/IconButton";

// Downloading the current item and the whole collection are separate buttons
// because layouts place them apart: one acts on the item, the other on the
// source.
export function DownloadMediaButton() {
  const gt = useGT();
  const canDownload = useViewerStore((state) => state.source?.capabilities.canDownload ?? false);
  const currentItem = useViewerStore(selectCurrentItem);
  const downloadCurrentMedia = useViewerStore(
    (state) => state.downloadCurrentMedia
  );
  const downloadActivityState = useViewerStore((state) =>
    currentItem
      ? state.downloadActivity.itemStates[currentItem.id]
      : undefined
  );

  if (!canDownload) return null;
  const isDownloadActive =
    downloadActivityState === "queued" ||
    downloadActivityState === "active";
  const downloadLabel =
    isDownloadActive
      ? gt("Downloading media")
      : downloadActivityState === "complete"
        ? gt("Download complete")
        : downloadActivityState === "failed"
          ? gt("Download failed. Try again")
          : gt("Download media to Downloads");

  return (
    <IconButton
      label={downloadLabel}
      disabled={isDownloadActive}
      data-testid="download-media"
      onClick={() => void downloadCurrentMedia()}
    >
      {isDownloadActive ? (
        <LoaderCircle className="animate-spin" size={17} aria-hidden />
      ) : downloadActivityState === "complete" ? (
        <Check size={17} aria-hidden />
      ) : downloadActivityState === "failed" ? (
        <CircleAlert size={17} aria-hidden />
      ) : (
        <Download size={17} aria-hidden />
      )}
    </IconButton>
  );
}

export function DownloadCollectionButton() {
  const gt = useGT();
  const canDownloadCollection = useViewerStore(
    (state) => state.source?.capabilities.canDownloadCollection ?? false
  );
  const downloadCollection = useViewerStore(
    (state) => state.downloadCollection
  );
  const isCollectionDownloadActive = useViewerStore(
    (state) => state.downloadActivity.collectionActive
  );

  if (!canDownloadCollection) return null;
  return (
    <IconButton
      label={gt("Download collection")}
      disabled={isCollectionDownloadActive}
      data-testid="download-collection"
      onClick={() => void downloadCollection()}
    >
      <FolderDown size={17} aria-hidden />
    </IconButton>
  );
}
