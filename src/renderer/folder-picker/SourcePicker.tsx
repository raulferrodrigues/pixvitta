import { FolderOpen, LoaderCircle } from "lucide-react";
import { T } from "gt-react";
import devIcon from "../../../assets/pixvitta-dev-icon.svg";
import stableIcon from "../../../assets/pixvitta-icon.svg";
import nightlyIcon from "../../../assets/pixvitta-nightly-icon.svg";
import type { AppBuildInfo, BuildFlavor } from "../../shared/appBuild";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { BuildFlavorBadge } from "../ui/BuildFlavorBadge";
import { PrimaryButton } from "../ui/PrimaryButton";
import { RecentSources } from "./RecentSources";
import { LocationPicker } from "./LocationPicker";
import "./folder-picker.css";

const appIcons: Record<BuildFlavor, string> = { stable: stableIcon, dev: devIcon, nightly: nightlyIcon };

export function SourcePicker({ buildInfo }: { buildInfo: AppBuildInfo }) {
  const loadState = useViewerStore((state) => state.loadState);
  const openFolder = useViewerStore((state) => state.openFolder);

  if (loadState === "loading") {
    return (
      <main className="source-picker flex h-screen w-screen flex-col items-center justify-center gap-3 text-sm text-pix-state">
        <LoaderCircle className="animate-spin text-pix-accent motion-reduce:animate-none" size={26} aria-hidden />
        <T>Loading...</T>
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="source-picker flex h-screen w-screen flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="app-error">
        <p><T>Something went wrong.</T></p>
        <PrimaryButton onClick={() => void openFolder()}><FolderOpen size={20} aria-hidden /><span><T>Open Folder</T></span></PrimaryButton>
      </main>
    );
  }

  return (
    <main className="source-picker flex h-screen w-screen items-center justify-center">
      <div className="grid max-h-[min(640px,calc(100vh-96px))] w-[min(720px,calc(100vw-48px))] gap-6 text-pix-soft" data-testid="project-picker">
        <div className="flex items-center justify-between gap-[18px]">
          <div className="flex min-w-0 items-center gap-4">
            <img className="size-14 shrink-0 drop-shadow-[0_8px_18px_rgb(0_0_0/45%)]" src={appIcons[buildInfo.flavor]} alt="" draggable={false} />
            <div className="grid min-w-0 gap-1">
              <div className="flex items-center gap-3">
                <h1 className="m-0 text-[30px] font-semibold leading-[1.1] tracking-tight text-pix-heading">{buildInfo.name}</h1>
                <BuildFlavorBadge buildInfo={buildInfo} />
              </div>
              <span className="text-xs tabular-nums text-pix-recent-path">v{buildInfo.version}</span>
            </div>
          </div>
          <PrimaryButton className="open-folder-button shrink-0" data-testid="open-folder-empty" onClick={() => void openFolder()}>
            <FolderOpen size={19} aria-hidden /><span><T>Open Folder</T></span>
          </PrimaryButton>
        </div>
        <div className="rounded-xl border border-pix-border bg-pix-recent p-4 shadow-[0_18px_40px_-24px_rgb(0_0_0/70%)]">
          <LocationPicker />
        </div>
        <RecentSources />
      </div>
    </main>
  );
}
