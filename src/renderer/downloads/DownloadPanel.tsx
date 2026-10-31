import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { DownloadActivityIndicator } from "./DownloadActivityIndicator";
import "./downloads.css";

const ROW_HEIGHT = 54;
const OVERSCAN = 8;

export function DownloadPanel() {
  const rows = useViewerStore((state) => state.downloadActivity.rows);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: OVERSCAN
  });

  if (rows.length === 0) return null;

  return (
    <aside
      className="download-panel"
      aria-label="Downloads"
      data-testid="download-panel"
    >
      <div ref={scrollRef} className="download-panel-scroll">
        <div
          className="download-panel-spacer"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                className="download-panel-row"
                data-index={virtualRow.index}
                style={{
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <div className="download-panel-thumbnail">
                  {row.thumbnailUrl ? (
                    <img src={row.thumbnailUrl} alt="" loading="lazy" />
                  ) : null}
                </div>
                <div className="download-panel-name" title={row.name}>
                  {row.name}
                </div>
                <DownloadActivityIndicator state={row.state} compact />
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
