import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { DownloadActivityState } from "../../shared/media";
import { classNames } from "../ui/classNames";
import "./downloads.css";

export function DownloadActivityIndicator({
  state,
  compact = false
}: {
  state: DownloadActivityState | undefined;
  compact?: boolean;
}) {
  if (!state || state === "queued") return null;

  return (
    <span
      className={classNames(
        "download-activity-indicator",
        compact && "is-compact",
        `is-${state}`
      )}
      aria-hidden
    >
      {state === "active" ? (
        <LoaderCircle className="download-activity-spinner" />
      ) : state === "complete" ? (
        <Check />
      ) : (
        <CircleAlert />
      )}
    </span>
  );
}
