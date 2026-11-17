import { Info } from "lucide-react";
import { useGT } from "gt-react";
import { useEffect } from "react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import "./sources.css";

// How long the toast form stays up. Under the panel's field the notice stays
// until the next source operation, or until the field is edited.
const TOAST_NOTICE_MS = 4_000;

// Main's word about a source add that is not a failure, shown where source
// errors show: under the panel's add field, or as a toast when the panel is
// closed (an add from the menu).
export function SourceNotice({ presentation }: { presentation: "compact" | "toast" }) {
  const gt = useGT();
  const sourceNotice = useViewerStore((state) => state.sourceNotice);
  const dismissSourceNotice = useViewerStore((state) => state.dismissSourceNotice);

  useEffect(() => {
    if (presentation !== "toast" || !sourceNotice) return;
    const timer = setTimeout(dismissSourceNotice, TOAST_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [dismissSourceNotice, presentation, sourceNotice]);

  if (!sourceNotice) return null;
  const message = gt("That source is already in the mix.");

  if (presentation === "toast") {
    return (
      <div className="source-notice-toast" role="status" data-testid="source-notice">
        <Info className="source-notice-icon" size={16} aria-hidden />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="source-notice" role="status" data-testid="source-notice">
      <Info className="source-notice-icon" size={13} aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
