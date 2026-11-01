import { FolderOpen, RefreshCw } from "lucide-react";
import { useGT } from "gt-react";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { IconButton } from "../../ui/IconButton";
import { FileOrderMenu } from "./FileOrderMenu";

export function OpenFolderButton() {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const openFolder = useViewerStore((state) => state.openFolder);
  return <IconButton label={gt("Open folder")} disabled={isSourceLoading} onClick={() => void openFolder()}><FolderOpen size={18} aria-hidden /></IconButton>;
}

export function RefreshButton() {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const canRefresh = useViewerStore((state) => state.source?.capabilities.canRefresh ?? false);
  const refreshSource = useViewerStore((state) => state.refreshSource);
  return (
    <IconButton
      label={gt("Refresh source")}
      onClick={() => void refreshSource()}
      disabled={isSourceLoading || !canRefresh}
    >
      <RefreshCw className={isSourceLoading ? "animate-spin" : undefined} size={17} aria-hidden />
    </IconButton>
  );
}

export function FileOrderButton() {
  const canSort = useViewerStore((state) => state.source?.capabilities.canSort ?? false);
  const fileOrder = useViewerStore((state) => state.settings.fileOrder);
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const setFileOrder = useViewerStore((state) => state.setFileOrder);
  if (!canSort) return null;
  return <FileOrderMenu value={fileOrder} disabled={isSourceLoading} onChange={(nextFileOrder) => void setFileOrder(nextFileOrder)} />;
}
