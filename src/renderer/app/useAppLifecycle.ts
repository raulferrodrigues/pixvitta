import { useEffect } from "react";
import { flushSync } from "react-dom";
import type { PixvittaApi, PixvittaCommand } from "../../shared/pixvittaApi";
import { useViewerStore, useViewerStoreApi } from "../state/ViewerStoreProvider";

export const VIDEO_SEEK_SECONDS = 5;
const SETTINGS_BLOCKED_COMMANDS: ReadonlySet<PixvittaCommand> = new Set([
  "previous-media",
  "next-media",
  "seek-video-backward",
  "seek-video-forward",
  "toggle-video-playback"
]);

export function useAppLifecycle(api: PixvittaApi) {
  const store = useViewerStoreApi();
  const initialize = useViewerStore((state) => state.initialize);
  const openFolder = useViewerStore((state) => state.openFolder);
  const refreshSource = useViewerStore((state) => state.refreshSource);
  const goNext = useViewerStore((state) => state.goNext);
  const goPrevious = useViewerStore((state) => state.goPrevious);
  const seekVideoBy = useViewerStore((state) => state.seekVideoBy);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const openSettings = useViewerStore((state) => state.openSettings);
  const openCollection = useViewerStore((state) => state.openCollection);
  const setSourceLoading = useViewerStore((state) => state.setSourceLoading);
  const showSourceError = useViewerStore((state) => state.showSourceError);
  const applyDownloadActivity = useViewerStore(
    (state) => state.applyDownloadActivity
  );
  const applyRecentSources = useViewerStore((state) => state.applyRecentSources);
  const applySettings = useViewerStore((state) => state.applySettings);
  const applyUpdateState = useViewerStore((state) => state.applyUpdateState);
  const applyAccounts = useViewerStore((state) => state.applyAccounts);
  const checkForUpdates = useViewerStore((state) => state.checkForUpdates);

  useEffect(() => { void initialize(); }, [initialize]);

  useEffect(() => {
    // Navigation is an explicit library input, including cache-only revisits.
    let previousId: string | null | undefined;
    const publishSelection = (state: ReturnType<typeof store.getState>) => {
      const mediaId = state.items[state.index]?.id ?? null;
      if (mediaId === previousId) return;
      previousId = mediaId;
      // An already-running dev window may still have the previous preload.
      api.setSelectedMedia?.(mediaId);
    };
    publishSelection(store.getState());
    return store.subscribe(publishSelection);
  }, [api, store]);

  useEffect(() => {
    const unsubscribeCommand = api.onCommand((command) => {
      // Keys the main process forwards should not act behind the open modal.
      if (store.getState().settingsView && SETTINGS_BLOCKED_COMMANDS.has(command)) return;
      if (command === "open-folder") void openFolder();
      if (command === "refresh-source") void refreshSource();
      if (command === "open-settings") openSettings("settings");
      if (command === "previous-media") goPrevious();
      if (command === "next-media") goNext();
      if (command === "seek-video-backward") seekVideoBy(-VIDEO_SEEK_SECONDS);
      if (command === "seek-video-forward") seekVideoBy(VIDEO_SEEK_SECONDS);
      if (command === "toggle-video-playback") void toggleVideoPlayback();
      if (command === "show-shortcuts") openSettings("shortcuts");
      if (command === "check-for-updates") {
        openSettings("updates");
        void checkForUpdates();
      }
    });
    const unsubscribeCollection = api.onCollectionChanged((collection) => {
      flushSync(() => openCollection(collection));
      api.acknowledgeCollection();
    });
    const unsubscribeLoading = api.onSourceLoadingChanged(setSourceLoading);
    const unsubscribeSourceError = api.onSourceError(showSourceError);
    const unsubscribeDownloadActivity =
      api.onDownloadActivityChanged(applyDownloadActivity);
    const unsubscribeRecentSources =
      api.onRecentSourcesChanged(applyRecentSources);
    const unsubscribeSettings = api.onSettingsChanged(applySettings);
    const unsubscribeUpdateState = api.onUpdateStateChanged(applyUpdateState);
    const unsubscribeAccounts = api.onAccountsChanged(applyAccounts);
    void api.markViewerReady();
    return () => {
      unsubscribeCommand();
      unsubscribeCollection();
      unsubscribeLoading();
      unsubscribeSourceError();
      unsubscribeDownloadActivity();
      unsubscribeRecentSources();
      unsubscribeSettings();
      unsubscribeUpdateState();
      unsubscribeAccounts();
    };
  }, [api, applyAccounts, applyDownloadActivity, applyRecentSources, applySettings, applyUpdateState, checkForUpdates, goNext, goPrevious, openCollection, openFolder, openSettings, refreshSource, seekVideoBy, setSourceLoading, showSourceError, toggleVideoPlayback]);
}
