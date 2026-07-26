import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { MediaItem } from "../../shared/media";
import { classNames } from "../ui/classNames";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { MediaLoadingOverlay } from "./MediaLoadingOverlay";
import { useImageZoomInteractions } from "./useImageZoomInteractions";

export function ImageViewer({ item }: { item: MediaItem }) {
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);
  const settings = useViewerStore((state) => state.settings);
  const markMediaBroken = useViewerStore((state) => state.markMediaBroken);
  const interactions = useImageZoomInteractions(true);
  const isLoaded = loadedItemId === item.id;

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
      {!isLoaded ? <MediaLoadingOverlay item={item} /> : null}
      <img
        key={item.id}
        ref={interactions.imageRef}
        className={classNames(
          "media-object",
          "image-object",
          `media-scale-${settings.mediaScaleMode}`,
          !isLoaded && "is-media-loading"
        )}
        style={interactions.imageStyle}
        data-testid="image-media"
        src={item.url}
        alt={item.name}
        onLoad={() => setLoadedItemId(item.id)}
        onError={() => markMediaBroken(item.id)}
      />
    </div>
  );
}
