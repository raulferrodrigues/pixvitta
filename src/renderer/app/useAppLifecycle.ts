import { useEffect } from "react";
import { flushSync } from "react-dom";
import type { PixvittaApi, PixvittaCommand } from "../../shared/pixvittaApi";
import { useViewerStore, useViewerStoreApi } from "../state/ViewerStoreProvider";
import { watchTextEntryFocus } from "./textEntryFocus";

export const VIDEO_SEEK_SECONDS = 5;
const MODAL_BLOCKED_COMMANDS: ReadonlySet<PixvittaCommand> = new Set([
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
  const addFolder = useViewerStore((state) => state.addFolder);
  const refreshSource = useViewerStore((state) => state.refreshSource);
  const goNext = useViewerStore((state) => state.goNext);
  const goPrevious = useViewerStore((state) => state.goPrevious);
  const seekVideoBy = useViewerStore((state) => state.seekVideoBy);
  const toggleVideoPlayback = useViewerStore((state) => state.toggleVideoPlayback);
  const openSettings = useViewerStore((state) => state.openSettings);
  const openCollection = useViewerStore((state) => state.openCollection);
  const setSourceLoading = useViewerStore((state) => state.setSourceLoading);
  const showSourceError = useViewerStore((state) => state.showSourceError);
  const askToReplace = useViewerStore((state) => state.askToReplace);
  const applyDownloadActivity = useViewerStore(
    (state) => state.applyDownloadActivity
  );
  const applyRecentSources = useViewerStore((state) => state.applyRecentSources);
  const applySettings = useViewerStore((state) => state.applySettings);
  const applyUpdateState = useViewerStore((state) => state.applyUpdateState);
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
    const runCommand = (command: PixvittaCommand) => {
      // Keys the main process forwards should not act behind an open modal.
      const { settingsView, replaceConfirmation } = store.getState();
      if ((settingsView || replaceConfirmation) && MODAL_BLOCKED_COMMANDS.has(command)) return;
      if (command === "open-folder") void openFolder();
      if (command === "add-folder") void addFolder();
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
    };
    const unsubscribeCommand = api.onCommand(runCommand);
    const stopWatchingTextEntry = watchTextEntryFocus(api, runCommand);
    const unsubscribeCollection = api.onCollectionChanged((collection) => {
      flushSync(() => openCollection(collection));
      api.acknowledgeCollection();
    });
    const unsubscribeLoading = api.onSourceLoadingChanged(setSourceLoading);
    const unsubscribeSourceError = api.onSourceError(showSourceError);
    const unsubscribeReplaceConfirmation = api.onReplaceConfirmation(askToReplace);
    const unsubscribeDownloadActivity =
      api.onDownloadActivityChanged(applyDownloadActivity);
    const unsubscribeRecentSources =
      api.onRecentSourcesChanged(applyRecentSources);
    const unsubscribeSettings = api.onSettingsChanged(applySettings);
    const unsubscribeUpdateState = api.onUpdateStateChanged(applyUpdateState);
    void api.markViewerReady();
    return () => {
      unsubscribeCommand();
      stopWatchingTextEntry();
      unsubscribeCollection();
      unsubscribeLoading();
      unsubscribeSourceError();
      unsubscribeReplaceConfirmation();
      unsubscribeDownloadActivity();
      unsubscribeRecentSources();
      unsubscribeSettings();
      unsubscribeUpdateState();
    };
  }, [addFolder, api, applyDownloadActivity, askToReplace, applyRecentSources, applySettings, applyUpdateState, checkForUpdates, goNext, goPrevious, openCollection, openFolder, openSettings, refreshSource, seekVideoBy, setSourceLoading, showSourceError, toggleVideoPlayback]);
}
