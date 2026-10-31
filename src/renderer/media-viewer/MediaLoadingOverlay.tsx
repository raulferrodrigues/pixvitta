import { LoaderCircle } from "lucide-react";
import { useGT } from "gt-react";
import type { MediaItem } from "../../shared/media";

export function MediaLoadingOverlay({ item }: { item: MediaItem }) {
  const gt = useGT();

  return (
    <div
      className="media-loading-overlay"
      role="status"
      aria-label={gt("Loading {name}", { name: item.name })}
    >
      {item.thumbnailUrl ? (
        <img
          className="media-loading-backdrop"
          src={item.thumbnailUrl}
          alt=""
          aria-hidden
          crossOrigin="anonymous"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      <div className="media-loading-shade" aria-hidden />
      <LoaderCircle
        className="media-loading-spinner"
        size={34}
        strokeWidth={2.2}
        aria-hidden
      />
    </div>
  );
}
