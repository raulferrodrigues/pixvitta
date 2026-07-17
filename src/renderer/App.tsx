import type { CSSProperties } from "react";
import { useAppLifecycle } from "./app/useAppLifecycle";
import { useAutoHideControls } from "./app/useAutoHideControls";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import { Controls } from "./controls/Controls";
import { Filmstrip } from "./filmstrip/Filmstrip";
import { FolderPicker } from "./folder-picker/FolderPicker";
import { MediaViewer } from "./media-viewer/MediaViewer";
import { useViewerStore } from "./state/ViewerStoreProvider";
import { selectHasMedia } from "./state/viewerSelectors";
import { TopBar } from "./topbar/TopBar";
import { classNames } from "./ui/classNames";
import "./App.css";

export function App() {
  useAppLifecycle(window.pixvitta);
  useKeyboardShortcuts(window.pixvitta);
  const folderPath = useViewerStore((state) => state.folderPath);
  const hasMedia = useViewerStore(selectHasMedia);
  const filmstripWidth = useViewerStore((state) => state.filmstripWidth);
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const usesUnobtrusiveControls = useViewerStore((state) => state.settings.unobtrusiveViewerControls);
  const isControlsRevealed = useAutoHideControls(usesUnobtrusiveControls && hasMedia);

  if (!folderPath) return <FolderPicker />;

  const showFilmstrip = hasMedia && isFilmstripVisible;
  const style = { "--filmstrip-width": showFilmstrip ? `${filmstripWidth}px` : "0px" } as CSSProperties;

  return (
    <main
      className={classNames(
        "app-shell",
        hasMedia && "has-media",
        usesUnobtrusiveControls && hasMedia && "has-unobtrusive-controls",
        isControlsRevealed && "is-controls-revealed"
      )}
      style={style}
      data-testid="app-shell"
    >
      <TopBar />
      <Controls />
      {showFilmstrip ? <Filmstrip /> : null}
      <MediaViewer />
    </main>
  );
}
