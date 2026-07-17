import { useEffect } from "react";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { useViewerStore } from "../state/ViewerStoreProvider";

export function useAppLifecycle(api: PixvittaApi) {
  const initialize = useViewerStore((state) => state.initialize);
  const openFolder = useViewerStore((state) => state.openFolder);
  const rescanFolder = useViewerStore((state) => state.rescanFolder);
  const openScannedFolder = useViewerStore((state) => state.openScannedFolder);
  const applySettings = useViewerStore((state) => state.applySettings);

  useEffect(() => { void initialize(); }, [initialize]);

  useEffect(() => {
    const unsubscribeCommand = api.onCommand((command) => {
      if (command === "open-folder") void openFolder();
      if (command === "rescan-folder") void rescanFolder();
      if (command === "open-preferences") void api.openPreferences();
    });
    const unsubscribeOpenedFile = api.onOpenedFile(openScannedFolder);
    const unsubscribeSettings = api.onSettingsChanged(applySettings);
    void api.markViewerReady();
    return () => { unsubscribeCommand(); unsubscribeOpenedFile(); unsubscribeSettings(); };
  }, [api, applySettings, openFolder, openScannedFolder, rescanFolder]);
}
