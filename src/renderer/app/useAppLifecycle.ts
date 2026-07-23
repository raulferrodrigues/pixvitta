import { useEffect } from "react";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { useViewerStore } from "../state/ViewerStoreProvider";

const VIDEO_SEEK_SECONDS = 5;

export function useAppLifecycle(api: PixvittaApi) {
  const initialize = useViewerStore((state) => state.initialize);
  const openFolder = useViewerStore((state) => state.openFolder);
  const refreshSource = useViewerStore((state) => state.refreshSource);
  const goNext = useViewerStore((state) => state.goNext);
  const goPrevious = useViewerStore((state) => state.goPrevious);
  const seekVideoBy = useViewerStore((state) => state.seekVideoBy);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const openCollection = useViewerStore((state) => state.openCollection);
  const applySettings = useViewerStore((state) => state.applySettings);

  useEffect(() => { void initialize(); }, [initialize]);

  useEffect(() => {
    const unsubscribeCommand = api.onCommand((command) => {
      if (command === "open-folder") void openFolder();
      if (command === "refresh-source") void refreshSource();
      if (command === "open-preferences") void api.openPreferences();
      if (command === "previous-media") goPrevious();
      if (command === "next-media") goNext();
      if (command === "seek-video-backward") seekVideoBy(-VIDEO_SEEK_SECONDS);
      if (command === "seek-video-forward") seekVideoBy(VIDEO_SEEK_SECONDS);
      if (command === "toggle-video-playback") void toggleVideoPlayback();
    });
    const unsubscribeOpenedFile = api.onOpenedFile(openCollection);
    const unsubscribeSettings = api.onSettingsChanged(applySettings);
    void api.markViewerReady();
    return () => { unsubscribeCommand(); unsubscribeOpenedFile(); unsubscribeSettings(); };
  }, [api, applySettings, goNext, goPrevious, openCollection, openFolder, refreshSource, seekVideoBy, toggleVideoPlayback]);
}
