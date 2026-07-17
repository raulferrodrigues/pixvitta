import { useViewerStore } from "../state/ViewerStoreProvider";
import { selectCurrentItem } from "../state/viewerSelectors";

export function MediaFilenameOverlay() {
  const currentItem = useViewerStore(selectCurrentItem);
  if (!currentItem) return null;
  return (
    <div key={currentItem.id} className="media-filename-overlay" aria-hidden>
      <div className="media-filename" data-testid="filename" title={currentItem.name}>{currentItem.name}</div>
    </div>
  );
}
