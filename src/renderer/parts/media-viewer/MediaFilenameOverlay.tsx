import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectCurrentItem } from "../../state/viewerSelectors";

export function MediaFilenameOverlay() {
  const currentItem = useViewerStore(selectCurrentItem);
  if (!currentItem) return null;
  const label = currentItem.sourceLabel ? `${currentItem.name} · ${currentItem.sourceLabel}` : currentItem.name;
  return (
    <div key={currentItem.id} className="media-filename-overlay" aria-hidden>
      <div className="media-filename" title={label}>
        <span data-testid="filename">{currentItem.name}</span>
        {currentItem.sourceLabel ? <span className="media-filename-source"> · {currentItem.sourceLabel}</span> : null}
      </div>
    </div>
  );
}
