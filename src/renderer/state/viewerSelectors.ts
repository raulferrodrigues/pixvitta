import type { MediaItem } from "../../shared/media";
import type { ViewerState } from "./viewerStore";

export function selectCurrentItem(state: ViewerState): MediaItem | undefined {
  return state.items[state.index];
}

export function selectHasMedia(state: ViewerState): boolean {
  return state.items.length > 0;
}

export function selectStatusText(state: ViewerState): string {
  return state.items.length > 0 ? `${state.index + 1}/${state.items.length}` : "";
}

export function selectIsCurrentItemBroken(state: ViewerState): boolean {
  const currentItem = selectCurrentItem(state);
  return currentItem ? state.mediaErrors.has(currentItem.id) : false;
}
