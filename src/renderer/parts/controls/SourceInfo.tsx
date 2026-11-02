import { ExternalLink } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { selectStatusText } from "../../state/viewerSelectors";

export function SourceTitle() {
  const title = useViewerStore((state) => state.source?.title);
  if (!title) return null;
  return <span className="source-title" title={title}>{title}</span>;
}

export function SourceOrigin() {
  const gt = useGT();
  const source = useViewerStore((state) => state.source);
  if (!source?.capabilities.canOpenOrigin || !source.originLabel) return null;
  return (
    <button
      className="source-origin"
      type="button"
      title={gt("Open source in browser")}
      onClick={() => void window.pixvitta.openSourceOrigin(source.id)}
    >
      <span>{source.originLabel}</span>
      <ExternalLink size={12} aria-hidden />
    </button>
  );
}

export function Counter() {
  const statusText = useViewerStore(selectStatusText);
  return <div className="source-counter" data-testid="counter">{statusText}</div>;
}
