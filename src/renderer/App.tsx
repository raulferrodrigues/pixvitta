import type { CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import { T } from "gt-react";
import type { AppBuildInfo } from "../shared/appBuild";
import { useAppLifecycle } from "./app/useAppLifecycle";
import { useAutoHideControls } from "./app/useAutoHideControls";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import { Controls } from "./controls/Controls";
import { Filmstrip } from "./filmstrip/Filmstrip";
import { SourceOpenError } from "./folder-picker/SourceOpenError";
import { SourcePicker } from "./folder-picker/SourcePicker";
import { MediaViewer } from "./media-viewer/MediaViewer";
import { useViewerStore } from "./state/ViewerStoreProvider";
import { selectHasMedia } from "./state/viewerSelectors";
import { TopBar } from "./topbar/TopBar";
import { classNames } from "./ui/classNames";
import "./App.css";

export function App({ buildInfo }: { buildInfo: AppBuildInfo }) {
  useAppLifecycle(window.pixvitta);
  useKeyboardShortcuts(window.pixvitta);
  const source = useViewerStore((state) => state.source);
  const hasMedia = useViewerStore(selectHasMedia);
  const filmstripWidth = useViewerStore((state) => state.filmstripWidth);
  const isFilmstripVisible = useViewerStore((state) => state.isFilmstripVisible);
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const usesUnobtrusiveControls = useViewerStore((state) => state.settings.unobtrusiveViewerControls);
  const isControlsRevealed = useAutoHideControls(usesUnobtrusiveControls && hasMedia);

  if (!source) return <SourcePicker buildInfo={buildInfo} />;

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
      <TopBar buildInfo={buildInfo} />
      <Controls />
      {showFilmstrip ? <Filmstrip /> : null}
      <MediaViewer />
      {isSourceLoading ? (
        <div
          className="fixed left-1/2 top-[calc(var(--pix-topbar-height)+12px)] z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-pix-border bg-pix-panel/95 px-4 py-2.5 text-sm text-pix-text shadow-xl"
          role="status"
          data-testid="source-loading"
        >
          <LoaderCircle className="animate-spin" size={17} aria-hidden />
          <span><T>Loading source...</T></span>
        </div>
      ) : null}
      <SourceOpenError presentation="toast" />
    </main>
  );
}
