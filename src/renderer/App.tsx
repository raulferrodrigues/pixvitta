import { LoaderCircle } from "lucide-react";
import { T } from "gt-react";
import type { AppBuildInfo } from "../shared/appBuild";
import { useAppLifecycle } from "./app/useAppLifecycle";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import { useWindowChrome } from "./app/useWindowChrome";
import { SourceOpenError } from "./folder-picker/SourceOpenError";
import { SourcePicker } from "./folder-picker/SourcePicker";
import { layouts } from "./layouts";
import { useViewerStore } from "./state/ViewerStoreProvider";

export function App({ buildInfo }: { buildInfo: AppBuildInfo }) {
  useAppLifecycle(window.pixvitta);
  useKeyboardShortcuts(window.pixvitta);
  useWindowChrome(window.pixvitta);
  const source = useViewerStore((state) => state.source);
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const viewerLayout = useViewerStore((state) => state.settings.viewerLayout);

  if (!source) return <SourcePicker buildInfo={buildInfo} />;

  const Layout = layouts[viewerLayout];
  return (
    <>
      <Layout buildInfo={buildInfo} />
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
    </>
  );
}
