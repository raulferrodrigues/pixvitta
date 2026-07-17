import { T } from "gt-react";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { RecentFolderItem } from "./RecentFolderItem";

export function RecentFolders() {
  const recentFolders = useViewerStore((state) => state.recentFolders);
  return (
    <div className="min-h-44" data-testid="recent-folders">
      <h2 className="mb-2.5 mt-0 text-xs font-bold uppercase text-pix-section"><T>Recent folders</T></h2>
      {recentFolders.length > 0 ? (
        <div className="grid max-h-[min(466px,calc(100vh-258px))] gap-2 overflow-auto">
          {recentFolders.map((folder, index) => <RecentFolderItem key={folder.folderPath} folder={folder} index={index} />)}
        </div>
      ) : (
        <p className="m-0 text-sm text-pix-empty"><T>No recent folders yet.</T></p>
      )}
    </div>
  );
}
