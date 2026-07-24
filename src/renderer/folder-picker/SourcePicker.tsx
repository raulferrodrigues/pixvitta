import { FolderOpen } from "lucide-react";
import { T } from "gt-react";
import type { AppBuildInfo } from "../../shared/appBuild";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { DevBuildBadge } from "../ui/DevBuildBadge";
import { PrimaryButton } from "../ui/PrimaryButton";
import { RecentFolders } from "./RecentFolders";
import { LocationPicker } from "./LocationPicker";

export function SourcePicker({ buildInfo }: { buildInfo: AppBuildInfo }) {
  const loadState = useViewerStore((state) => state.loadState);
  const openFolder = useViewerStore((state) => state.openFolder);

  if (loadState === "loading") {
    return <main className="flex h-screen w-screen items-center justify-center text-pix-state"><T>Loading...</T></main>;
  }

  if (loadState === "error") {
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 text-center text-pix-state" data-testid="app-error">
        <p><T>Something went wrong.</T></p>
        <PrimaryButton onClick={() => void openFolder()}><FolderOpen size={20} aria-hidden /><span><T>Open Folder</T></span></PrimaryButton>
      </main>
    );
  }

  return (
    <main className="flex h-screen w-screen items-center justify-center">
      <div className="grid max-h-[min(620px,calc(100vh-128px))] w-[min(720px,calc(100vw-48px))] gap-[22px] text-pix-soft" data-testid="project-picker">
        <div className="flex items-center justify-between gap-[18px]">
          <div className="flex items-center gap-3">
            <h1 className="m-0 text-[32px] leading-[1.1] text-pix-heading">{buildInfo.name}</h1>
            <DevBuildBadge buildInfo={buildInfo} />
          </div>
          <PrimaryButton data-testid="open-folder-empty" onClick={() => void openFolder()}>
            <FolderOpen size={20} aria-hidden /><span><T>Open Folder</T></span>
          </PrimaryButton>
        </div>
        <LocationPicker />
        <RecentFolders />
      </div>
    </main>
  );
}
