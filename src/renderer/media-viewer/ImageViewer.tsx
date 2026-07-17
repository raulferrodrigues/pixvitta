import type { MouseEvent as ReactMouseEvent } from "react";
import type { MediaItem } from "../../shared/media";
import { classNames } from "../ui/classNames";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { useImageZoomInteractions } from "./useImageZoomInteractions";

export function ImageViewer({ item }: { item: MediaItem }) {
  const settings = useViewerStore((state) => state.settings);
  const markMediaBroken = useViewerStore((state) => state.markMediaBroken);
  const interactions = useImageZoomInteractions(true);

  function showContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void window.pixvitta.showMediaContextMenu(item.id);
  }

  return (
    <div
      className={classNames("media-viewer-interaction", interactions.isImageZoomed && "is-image-zoomed", interactions.isImagePanning && "is-image-panning")}
      onContextMenu={showContextMenu}
      {...interactions.stageInteractionProps}
    >
      <img
        ref={interactions.imageRef}
        className={`media-object image-object media-scale-${settings.mediaScaleMode}`}
        style={interactions.imageStyle}
        data-testid="image-media"
        src={item.url}
        alt={item.name}
        onError={() => markMediaBroken(item.id)}
      />
    </div>
  );
}
