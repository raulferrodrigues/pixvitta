import { LoaderCircle } from "lucide-react";
import { T } from "gt-react";
import { useEffect } from "react";
import type { AppBuildInfo } from "../shared/appBuild";
import { useAppLifecycle } from "./app/useAppLifecycle";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import { useWindowChrome } from "./app/useWindowChrome";
import { SourceOpenError } from "./folder-picker/SourceOpenError";
import { SourcePicker } from "./folder-picker/SourcePicker";
import { layouts } from "./layouts";
import { SettingsModal } from "./parts/settings/SettingsModal";
import { ReplaceConfirmationDialog } from "./parts/sources/ReplaceConfirmation";
import { SourceNotice } from "./parts/sources/SourceNotice";
import { useViewerStore } from "./state/ViewerStoreProvider";

export function App({ buildInfo }: { buildInfo: AppBuildInfo }) {
  useAppLifecycle(window.pixvitta);
  useKeyboardShortcuts();
  useWindowChrome(window.pixvitta);
  const source = useViewerStore((state) => state.source);
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const isSourcesPanelOpen = useViewerStore((state) => state.isSourcesPanelOpen);
  const viewerLayout = useViewerStore((state) => state.settings.viewerLayout);
  const glowEffects = useViewerStore((state) => state.settings.glowEffects);

  // The glow rules key off this attribute, so the setting reaches every part,
  // including the modal dialog in the top layer, without threading props.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-glow", glowEffects);
  }, [glowEffects]);

  if (!source) {
    return (
      <>
        <SourcePicker buildInfo={buildInfo} />
        <SettingsModal />
      </>
    );
  }

  const Layout = layouts[viewerLayout];
  return (
    <>
      <Layout buildInfo={buildInfo} />
      <SettingsModal />
      <ReplaceConfirmationDialog />
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
      {/* The open sources panel shows source errors and notices beside its add form. */}
      {isSourcesPanelOpen ? null : (
        <>
          <SourceOpenError presentation="toast" />
          <SourceNotice presentation="toast" />
        </>
      )}
    </>
  );
}
