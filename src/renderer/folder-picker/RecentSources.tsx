import { T } from "gt-react";
import { isRecentMix } from "../../shared/recentSources";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { RecentMixItem, RecentSourceItem } from "./RecentSourceItem";
import "./folder-picker.css";

export function RecentSources() {
  const recentSources = useViewerStore((state) => state.recentSources);
  return (
    <div className="min-h-44" data-testid="recent-sources">
      <h2 className="mb-2.5 mt-0 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-pix-section"><T>Recent sources</T></h2>
      {recentSources.length > 0 ? (
        <div className="recent-sources-scrollbar -mr-2.5 grid max-h-[min(330px,calc(100vh-420px))] gap-1.5 overflow-x-hidden overflow-y-auto">
          {recentSources.map((entry, index) =>
            isRecentMix(entry) ? (
              <RecentMixItem key={`mix:${entry.id}`} mix={entry} index={index} />
            ) : (
              <RecentSourceItem key={entry.location} source={entry} index={index} />
            )
          )}
        </div>
      ) : (
        <p className="m-0 rounded-xl border border-dashed border-pix-recent-border px-4 py-6 text-center text-sm text-pix-empty"><T>No recent sources yet.</T></p>
      )}
    </div>
  );
}
