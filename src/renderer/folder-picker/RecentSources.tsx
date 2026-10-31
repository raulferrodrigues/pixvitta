import { T } from "gt-react";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { RecentSourceItem } from "./RecentSourceItem";
import "./folder-picker.css";

export function RecentSources() {
  const recentSources = useViewerStore((state) => state.recentSources);
  return (
    <div className="min-h-44" data-testid="recent-sources">
      <h2 className="mb-2.5 mt-0 text-xs font-bold uppercase text-pix-section"><T>Recent sources</T></h2>
      {recentSources.length > 0 ? (
        <div className="recent-sources-scrollbar grid max-h-[min(330px,calc(100vh-390px))] gap-2 overflow-x-hidden overflow-y-auto">
          {recentSources.map((source, index) => (
            <RecentSourceItem
              key={source.location}
              source={source}
              index={index}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-pix-empty"><T>No recent sources yet.</T></p>
      )}
    </div>
  );
}
