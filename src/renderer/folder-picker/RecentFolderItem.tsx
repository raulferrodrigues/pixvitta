import { FolderOpen, X } from "lucide-react";
import { useGT } from "gt-react";
import type { RecentFolder } from "../../shared/recentFolders";
import { useViewerStore } from "../state/ViewerStoreProvider";

type RecentFolderItemProps = { folder: RecentFolder; index: number };

export function RecentFolderItem({ folder, index }: RecentFolderItemProps) {
  const gt = useGT();
  const openRecentFolder = useViewerStore((state) => state.openRecentFolder);
  const removeRecentFolder = useViewerStore((state) => state.removeRecentFolder);

  return (
    <div className="group grid min-h-[58px] grid-cols-[minmax(0,1fr)_36px] items-center rounded-lg border border-pix-recent-border bg-pix-recent text-pix-recent-text hover:bg-pix-recent-hover">
      <button
        className="grid h-full min-w-0 cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 rounded-l-lg px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-pix-accent"
        type="button"
        title={folder.folderPath}
        data-testid={`recent-folder-item-${index}`}
        onClick={() => void openRecentFolder(folder.folderPath)}
      >
        <FolderOpen size={18} aria-hidden />
        <span className="grid min-w-0 gap-[3px]">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">{folder.name}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-pix-recent-path">{folder.folderPath}</span>
        </span>
      </button>
      <button
        className="flex size-8 cursor-pointer items-center justify-center rounded-md text-pix-recent-path opacity-60 hover:bg-white/10 hover:text-pix-recent-text hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pix-accent"
        type="button"
        title={gt("Remove from recent folders")}
        aria-label={gt("Remove from recent folders")}
        onClick={() => void removeRecentFolder(folder.folderPath)}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
