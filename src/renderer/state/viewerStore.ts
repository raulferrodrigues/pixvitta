import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  AddSourceRequest,
  AddSourceResult,
  DownloadActivitySnapshot,
  MediaCollection,
  MediaItem,
  MediaSource,
  OpenSourceError,
  OpenSourceRequest,
  ReplaceConfirmation
} from "../../shared/media";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { isRecentMix, type RecentEntry } from "../../shared/recentSources";
import { defaultSettings, type AppSettings, type FileOrder } from "../../shared/settings";
import type { UpdateState } from "../../shared/updates";
import { clampImageZoom, MIN_IMAGE_ZOOM, roundImageTransformValue } from "./imageView";
import { nextIndex, previousIndex } from "./navigation";
import { createVideoController, type VideoController } from "./videoController";
import { selectCurrentItem } from "./viewerSelectors";

export type ViewerLoadState = "idle" | "loading" | "ready" | "empty" | "error";
export type ViewMode = "single" | "continuous";

export const DEFAULT_FILMSTRIP_WIDTH = 168;
export const MIN_FILMSTRIP_WIDTH = 128;
export const MAX_FILMSTRIP_WIDTH = 320;
export const MIN_CONTINUOUS_COLUMN_SCALE = 0.3;
export const MAX_CONTINUOUS_COLUMN_SCALE = 1;
const VIDEO_AUDIO_SAVE_DELAY_MS = 250;

export type ViewerState = {
  source: MediaSource | null;
  items: MediaItem[];
  index: number;
  loadState: ViewerLoadState;
  isSourceLoading: boolean;
  mediaErrors: Set<string>;
  isVideoPlaying: boolean;
  isVideoLooping: boolean;
  imageZoom: number;
  imagePanX: number;
  imagePanY: number;
  viewMode: ViewMode;
  continuousColumnScale: number;
  settings: AppSettings;
  // Sources and saved mixes, in main's order.
  recentSources: RecentEntry[];
  // The saved mix whose name is being edited, wherever it is listed.
  renamingMixId: string | null;
  filmstripWidth: number;
  isFilmstripVisible: boolean;
  sourceOpenError: OpenSourceError | null;
  // Not an error: main's word that a source being added is already a member.
  // Shown where errors are, until the next source request, collection, or
  // error.
  sourceNotice: SourceNotice | null;
  pendingAuthenticationLocation: string | null;
  // Main's question before an open replaces a mix, until the user answers.
  replaceConfirmation: ReplaceConfirmation | null;
  downloadActivity: DownloadActivitySnapshot;
  isDownloadPanelOpen: boolean;
  isSourcesPanelOpen: boolean;
  // The settings modal shows either the settings list or the keyboard
  // shortcuts; null means it is closed.
  settingsView: SettingsView | null;
  // Main owns the update state and sends every change; null until it answers.
  updateState: UpdateState | null;
};

export type ViewerActions = {
  initialize(): Promise<void>;
  openFolder(): Promise<void>;
  openLocation(location: string): Promise<void>;
  addFolder(): Promise<AddSourceResult>;
  addLocation(location: string): Promise<AddSourceResult>;
  removeSource(memberId: string): Promise<void>;
  openRecentSource(location: string): Promise<void>;
  openSavedMix(id: string): Promise<void>;
  signInExHentai(): Promise<void>;
  // Signs in for a member of the open collection that failed because it
  // needs it, then refreshes the collection so the member is tried again.
  signInAndRefresh(): Promise<void>;
  removeRecentSource(location: string): Promise<void>;
  removeSavedMix(id: string): Promise<void>;
  pinSavedMix(id: string, pinned: boolean): Promise<void>;
  showSavedMixMenu(id: string, position?: { x: number; y: number }): void;
  startRenamingMix(id: string): void;
  // Saves the name, or with null leaves it as it was.
  finishRenamingMix(name: string | null): Promise<void>;
  openCollection(collection: MediaCollection): void;
  setSourceLoading(isLoading: boolean): void;
  showSourceError(error: OpenSourceError): void;
  dismissSourceNotice(): void;
  askToReplace(confirmation: ReplaceConfirmation): void;
  answerReplace(replace: boolean): void;
  refreshSource(): Promise<void>;
  downloadCurrentMedia(): Promise<void>;
  downloadCollection(): Promise<void>;
  loadDownloadActivity(): Promise<void>;
  applyDownloadActivity(snapshot: DownloadActivitySnapshot): void;
  refreshRecentSources(): Promise<void>;
  applyRecentSources(sources: RecentEntry[]): void;
  loadSettings(): Promise<void>;
  applySettings(settings: AppSettings): void;
  setFileOrder(fileOrder: FileOrder): Promise<void>;
  toggleUnobtrusiveControls(): Promise<void>;
  updateSettings(changes: Partial<AppSettings>): Promise<void>;
  goNext(): void;
  goPrevious(): void;
  selectMedia(index: number): void;
  markMediaBroken(id: string): void;
  attachVideoElement(element: HTMLVideoElement | null): void;
  toggleVideoPlayback(): Promise<void>;
  seekVideoBy(seconds: number): boolean;
  setVideoPlaying(isPlaying: boolean): void;
  setVideoAudio(volume: number, muted: boolean): void;
  toggleVideoLoop(): void;
  zoomCurrentImage(multiplier: number): void;
  setImageView(zoom: number, panX: number, panY: number): void;
  toggleViewMode(): void;
  scaleContinuousColumn(multiplier: number): void;
  resizeFilmstrip(width: number): void;
  toggleFilmstrip(): void;
  toggleDownloadPanel(): void;
  toggleSourcesPanel(): void;
  openSettings(view?: SettingsView): void;
  closeSettings(): void;
  loadUpdateState(): Promise<void>;
  applyUpdateState(state: UpdateState): void;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
};

export type SourceNotice = "already-added";

// "updates" is the settings list, scrolled to the update row.
export type SettingsView = "settings" | "updates" | "shortcuts";

export type ViewerStore = ViewerState & ViewerActions;
export type ViewerStoreApi = StoreApi<ViewerStore>;

// Every transition that swaps the media element for a new one. Elements report
// nothing once they are unmounted, so these transitions must reset this state.
const FRESH_MEDIA_VIEW = {
  isVideoPlaying: false,
  imageZoom: MIN_IMAGE_ZOOM,
  imagePanX: 0,
  imagePanY: 0
} satisfies Partial<ViewerState>;

function applyCollection(state: ViewerState, collection: MediaCollection): Partial<ViewerState> {
  const selectedIndex = collection.selectedId === null
    ? -1
    : collection.items.findIndex((item) => item.id === collection.selectedId);
  const index = selectedIndex >= 0 ? selectedIndex : 0;
  // A refresh keeps item IDs, so a selected video keeps its element and plays on
  // without firing another play event.
  const keepsCurrentElement = state.items[state.index]?.id === collection.items[index]?.id;

  return {
    source: collection.source,
    items: collection.items,
    index,
    mediaErrors: new Set(),
    ...FRESH_MEDIA_VIEW,
    isVideoPlaying: keepsCurrentElement && state.isVideoPlaying,
    sourceOpenError: null,
    sourceNotice: null,
    // A question about replacing another collection no longer applies.
    ...(state.source?.id === collection.source.id ? {} : { replaceConfirmation: null }),
    loadState: collection.items.length > 0 ? "ready" : "empty"
  };
}

function settingsRequireSourceRefresh(previousSettings: AppSettings, nextSettings: AppSettings): boolean {
  return previousSettings.fileOrder !== nextSettings.fileOrder || previousSettings.includeHidden !== nextSettings.includeHidden;
}

function exHentaiLocation(request: OpenSourceRequest): string | null {
  if (request.kind !== "location") return null;
  try {
    return new URL(request.location.trim()).hostname === "exhentai.org"
      ? request.location
      : null;
  } catch {
    return null;
  }
}

export function createViewerStore(
  api: PixvittaApi,
  videoController: VideoController = createVideoController()
): ViewerStoreApi {
  let settingsSaveRevision = 0;
  let recentSourcesRevision = 0;
  let updateStateRevision = 0;
  let sourceRequestRevision = 0;
  // Signing in retries the request that needed it the same way: an open, an
  // open the user already confirmed would replace a mix, or an add.
  let pendingAuthenticationMode: "open" | "replace" | "add" = "open";
  let videoAudioSaveTimer: ReturnType<typeof setTimeout> | null = null;

  return createStore<ViewerStore>((set, get) => {
    const applySettingsState = (settings: AppSettings) => {
      const previousSettings = get().settings;
      const shouldRefreshSource = settingsRequireSourceRefresh(previousSettings, settings);
      const shouldResetVideoLoop = previousSettings.videoLoopByDefault !== settings.videoLoopByDefault;

      set({
        settings,
        ...(shouldResetVideoLoop ? { isVideoLooping: settings.videoLoopByDefault } : {})
      });

      if (shouldRefreshSource && get().source?.capabilities.canSort) {
        void get().refreshSource();
      }
    };

    // A change to recents answers with the new list, unless main has
    // published a newer one in the meantime.
    const changeRecents = async (change: () => Promise<RecentEntry[]>) => {
      const revision = ++recentSourcesRevision;
      try {
        const recentSources = await change();
        if (revision === recentSourcesRevision) set({ recentSources });
      } catch (error) {
        console.error(error);
      }
    };

    const applyOpenedCollection = (collection: MediaCollection) => {
      sourceRequestRevision += 1;
      set((state) => applyCollection(state, collection));
    };

    const failSourceRequest = (error: unknown) => {
      console.error(error);
      set({
        isSourceLoading: false,
        loadState: get().source ? get().loadState : "idle",
        sourceOpenError: "unavailable"
      });
    };

    const openSourceRequest = async (request: OpenSourceRequest, replaceConfirmed = false) => {
      sourceRequestRevision += 1;
      try {
        set({ pendingAuthenticationLocation: exHentaiLocation(request), sourceNotice: null });
        pendingAuthenticationMode = replaceConfirmed ? "replace" : "open";
        if (replaceConfirmed) api.openSource(request, { replaceConfirmed });
        else api.openSource(request);
      } catch (error) {
        failSourceRequest(error);
      }
    };

    // Main answers an add once it is done with it, so the caller always learns
    // how it ended. Whether a source is already a member is main's call. The
    // answer may arrive before or after main's loading and collection
    // messages, which travel separately, so the notice is not tied to them.
    const addSourceRequest = async (request: AddSourceRequest): Promise<AddSourceResult> => {
      const revision = ++sourceRequestRevision;
      try {
        set({ pendingAuthenticationLocation: exHentaiLocation(request), sourceNotice: null });
        pendingAuthenticationMode = "add";
        const result = await api.addSource(request);
        if (result === "already-added" && revision === sourceRequestRevision) {
          set({ sourceNotice: "already-added" });
        }
        return result;
      } catch (error) {
        failSourceRequest(error);
        return "not-added";
      }
    };

    return {
      source: null,
      items: [],
      index: 0,
      loadState: "idle",
      isSourceLoading: false,
      mediaErrors: new Set(),
      isVideoPlaying: false,
      isVideoLooping: defaultSettings.videoLoopByDefault,
      imageZoom: MIN_IMAGE_ZOOM,
      imagePanX: 0,
      imagePanY: 0,
      viewMode: "single",
      continuousColumnScale: MAX_CONTINUOUS_COLUMN_SCALE,
      settings: defaultSettings,
      recentSources: [],
      renamingMixId: null,
      filmstripWidth: DEFAULT_FILMSTRIP_WIDTH,
      isFilmstripVisible: true,
      sourceOpenError: null,
      sourceNotice: null,
      pendingAuthenticationLocation: null,
      replaceConfirmation: null,
      downloadActivity: {
        revision: 0,
        rows: [],
        itemStates: {},
        collectionActive: false
      },
      isDownloadPanelOpen: false,
      isSourcesPanelOpen: false,
      settingsView: null,
      updateState: null,

      async initialize() {
        await Promise.all([
          get().loadSettings(),
          get().refreshRecentSources(),
          get().loadDownloadActivity(),
          get().loadUpdateState()
        ]);
      },

      async openFolder() {
        await openSourceRequest({ kind: "pick-directory" });
      },

      async openLocation(location: string) {
        await openSourceRequest({ kind: "location", location });
      },

      async addFolder() {
        return addSourceRequest({ kind: "pick-directory" });
      },

      async addLocation(location: string) {
        return addSourceRequest({ kind: "location", location });
      },

      async removeSource(memberId: string) {
        if ((get().source?.members.length ?? 0) < 2) return;
        sourceRequestRevision += 1;
        get().dismissSourceNotice();
        try {
          api.removeSource(memberId);
        } catch (error) {
          console.error(error);
          set({ isSourceLoading: false, sourceOpenError: "unavailable" });
        }
      },

      async openRecentSource(location: string) {
        await openSourceRequest({ kind: "location", location });
      },

      async openSavedMix(id: string) {
        await openSourceRequest({ kind: "saved-mix", id });
      },

      async signInExHentai() {
        const location = get().pendingAuthenticationLocation;
        const revision = sourceRequestRevision;
        try {
          const signedIn = await api.signInExHentai();
          if (signedIn && location && revision === sourceRequestRevision) {
            const request: AddSourceRequest = { kind: "location", location };
            if (pendingAuthenticationMode === "add") await addSourceRequest(request);
            else await openSourceRequest(request, pendingAuthenticationMode === "replace");
          }
        } catch (error) {
          console.error(error);
        }
      },

      // No request is pending here, unlike signInExHentai: the member already
      // failed in a refresh or a reopen, and the next refresh retries it.
      async signInAndRefresh() {
        const sourceId = get().source?.id;
        try {
          const signedIn = await api.signInExHentai();
          if (signedIn && sourceId !== undefined && get().source?.id === sourceId) {
            await get().refreshSource();
          }
        } catch (error) {
          console.error(error);
        }
      },

      async removeRecentSource(location: string) {
        await changeRecents(() => api.removeRecentSource(location));
      },

      async removeSavedMix(id: string) {
        await changeRecents(() => api.removeSavedMix(id));
      },

      async pinSavedMix(id: string, pinned: boolean) {
        await changeRecents(() => api.pinSavedMix(id, pinned));
      },

      showSavedMixMenu(id: string, position?: { x: number; y: number }) {
        try {
          if (position) api.showSavedMixMenu(id, position);
          else api.showSavedMixMenu(id);
        } catch (error) {
          console.error(error);
        }
      },

      // Main says which mixes can be renamed by listing them as pinned.
      startRenamingMix(id: string) {
        const mix = get().recentSources.find((entry) => isRecentMix(entry) && entry.id === id);
        if (mix && isRecentMix(mix) && mix.pinned) set({ renamingMixId: id });
      },

      async finishRenamingMix(name: string | null) {
        const id = get().renamingMixId;
        if (id === null) return;
        set({ renamingMixId: null });
        if (name !== null) await changeRecents(() => api.renameSavedMix(id, name));
      },

      openCollection(collection: MediaCollection) {
        applyOpenedCollection(collection);
      },

      setSourceLoading(isSourceLoading: boolean) {
        set((state) => ({
          isSourceLoading,
          sourceOpenError: isSourceLoading ? null : state.sourceOpenError,
          loadState:
            state.source === null
              ? isSourceLoading
                ? "loading"
                : state.loadState === "loading"
                  ? "idle"
                  : state.loadState
              : state.loadState
        }));
      },

      showSourceError(sourceOpenError: OpenSourceError) {
        set((state) => ({
          sourceOpenError,
          sourceNotice: null,
          loadState: state.source ? state.loadState : "idle"
        }));
      },

      dismissSourceNotice() {
        if (get().sourceNotice) set({ sourceNotice: null });
      },

      askToReplace(replaceConfirmation: ReplaceConfirmation) {
        set({ replaceConfirmation });
      },

      // Going ahead sends main's request back, confirmed; main still decides
      // whether it can open now.
      answerReplace(replace: boolean) {
        const confirmation = get().replaceConfirmation;
        if (!confirmation) return;
        set({ replaceConfirmation: null });
        if (replace) void openSourceRequest(confirmation.request, true);
      },

      async refreshSource() {
        const { source } = get();
        if (!source?.capabilities.canRefresh) return;

        sourceRequestRevision += 1;
        get().dismissSourceNotice();
        try {
          api.refreshSource();
        } catch (error) {
          console.error(error);
          set({ isSourceLoading: false, sourceOpenError: "unavailable" });
        }
      },

      async downloadCurrentMedia() {
        const state = get();
        const item = selectCurrentItem(state);
        if (!item || !state.source?.capabilities.canDownload) return;
        try {
          await api.downloadMedia(item.id);
        } catch (error) {
          console.error(error);
        }
      },

      async downloadCollection() {
        const state = get();
        if (
          !state.source?.capabilities.canDownloadCollection ||
          state.downloadActivity.collectionActive
        ) {
          return;
        }
        try {
          await api.downloadCollection(
            state.source.title,
            state.items.map((item) => item.id)
          );
        } catch (error) {
          console.error(error);
        }
      },

      async loadDownloadActivity() {
        try {
          get().applyDownloadActivity(await api.getDownloadActivity());
        } catch (error) {
          console.error(error);
        }
      },

      applyDownloadActivity(downloadActivity) {
        set((state) => {
          if (
            downloadActivity.revision < state.downloadActivity.revision
          ) {
            return state;
          }
          return {
            downloadActivity,
            isDownloadPanelOpen:
              downloadActivity.rows.length > 0 &&
              state.isDownloadPanelOpen
          };
        });
      },

      async refreshRecentSources() {
        const revision = recentSourcesRevision;
        try {
          const recentSources = await api.getRecentSources();
          if (revision === recentSourcesRevision) set({ recentSources });
        } catch (error) {
          console.error(error);
          if (revision === recentSourcesRevision) set({ recentSources: [] });
        }
      },

      applyRecentSources(recentSources: RecentEntry[]) {
        recentSourcesRevision += 1;
        set({ recentSources });
      },

      async loadSettings() {
        try {
          const settings = await api.getSettings();
          set({ settings, isVideoLooping: settings.videoLoopByDefault });
        } catch (error) {
          console.error(error);
        }
      },

      applySettings(settings: AppSettings) {
        settingsSaveRevision += 1;
        applySettingsState(settings);
      },

      setVideoAudio(volume: number, muted: boolean) {
        const videoVolume = Math.min(1, Math.max(0, volume));
        const currentSettings = get().settings;
        if (
          currentSettings.videoVolume === videoVolume &&
          currentSettings.videoMuted === muted
        ) {
          return;
        }

        set({
          settings: {
            ...currentSettings,
            videoVolume,
            videoMuted: muted
          }
        });

        if (videoAudioSaveTimer) clearTimeout(videoAudioSaveTimer);
        videoAudioSaveTimer = setTimeout(() => {
          videoAudioSaveTimer = null;
          const settings = get().settings;
          const revision = settingsSaveRevision + 1;
          settingsSaveRevision = revision;
          void api.saveSettings(settings).then(
            (savedSettings) => {
              if (revision === settingsSaveRevision) {
                applySettingsState(savedSettings);
              }
            },
            (error: unknown) => {
              if (revision === settingsSaveRevision) console.error(error);
            }
          );
        }, VIDEO_AUDIO_SAVE_DELAY_MS);
      },

      async setFileOrder(fileOrder: FileOrder) {
        if (fileOrder === get().settings.fileOrder) return;
        await get().updateSettings({ fileOrder });
      },

      async toggleUnobtrusiveControls() {
        await get().updateSettings({ unobtrusiveViewerControls: !get().settings.unobtrusiveViewerControls });
      },

      async updateSettings(changes: Partial<AppSettings>) {
        const previousSettings = get().settings;
        const nextSettings = { ...previousSettings, ...changes };
        const revision = settingsSaveRevision + 1;
        settingsSaveRevision = revision;
        // Order and hidden-file changes refresh the source, and main reads the
        // saved settings to do that, so those apply only once the save lands.
        // Everything else shows right away and rolls back if the save fails.
        const waitsForSave = settingsRequireSourceRefresh(previousSettings, nextSettings);
        if (!waitsForSave) applySettingsState(nextSettings);
        try {
          const savedSettings = await api.saveSettings(nextSettings);
          if (revision === settingsSaveRevision) applySettingsState(savedSettings);
        } catch (error) {
          if (revision !== settingsSaveRevision) return;
          console.error(error);
          if (!waitsForSave) applySettingsState(previousSettings);
        }
      },

      goNext() {
        set((state) => {
          const index = nextIndex(state.index, state.items.length, state.settings.wrapNavigation);
          if (index === state.index) return state;
          return { index, ...FRESH_MEDIA_VIEW };
        });
      },

      goPrevious() {
        set((state) => {
          const index = previousIndex(state.index, state.items.length, state.settings.wrapNavigation);
          if (index === state.index) return state;
          return { index, ...FRESH_MEDIA_VIEW };
        });
      },

      selectMedia(index: number) {
        set((state) => {
          if (index === state.index) return state;
          return { index, ...FRESH_MEDIA_VIEW };
        });
      },

      markMediaBroken(id: string) {
        set((state) => {
          // An obsolete media request can fail after navigation cancels it.
          // Continuous view keeps each mounted item's request alive instead.
          if (state.viewMode === "single" && selectCurrentItem(state)?.id !== id) return state;
          return { mediaErrors: new Set(state.mediaErrors).add(id) };
        });
      },

      attachVideoElement(element: HTMLVideoElement | null) {
        videoController.attach(element);
      },

      async toggleVideoPlayback() {
        if (selectCurrentItem(get())?.kind !== "video") return;
        try {
          await videoController.togglePlayback();
        } catch (error) {
          console.error(error);
          set({ isVideoPlaying: false });
        }
      },

      seekVideoBy(seconds: number) {
        if (selectCurrentItem(get())?.kind !== "video") return false;
        return videoController.seekBy(seconds);
      },

      setVideoPlaying(isVideoPlaying: boolean) {
        set({ isVideoPlaying });
      },

      toggleVideoLoop() {
        if (selectCurrentItem(get())?.kind !== "video") return;
        set((state) => ({ isVideoLooping: !state.isVideoLooping }));
      },

      zoomCurrentImage(multiplier: number) {
        if (selectCurrentItem(get())?.kind !== "image" || !Number.isFinite(multiplier) || multiplier <= 0) return;
        set((state) => {
          const imageZoom = clampImageZoom(state.imageZoom * multiplier);
          const zoomRatio = state.imageZoom <= 0 ? 1 : imageZoom / state.imageZoom;
          return {
            imageZoom,
            imagePanX: imageZoom === MIN_IMAGE_ZOOM ? 0 : roundImageTransformValue(state.imagePanX * zoomRatio),
            imagePanY: imageZoom === MIN_IMAGE_ZOOM ? 0 : roundImageTransformValue(state.imagePanY * zoomRatio)
          };
        });
      },

      setImageView(zoom: number, panX: number, panY: number) {
        if (selectCurrentItem(get())?.kind !== "image") return;
        const imageZoom = clampImageZoom(zoom);
        set({
          imageZoom,
          imagePanX: imageZoom === MIN_IMAGE_ZOOM ? 0 : panX,
          imagePanY: imageZoom === MIN_IMAGE_ZOOM ? 0 : panY
        });
      },

      toggleViewMode() {
        set((state) => ({
          viewMode: state.viewMode === "single" ? "continuous" : "single",
          ...FRESH_MEDIA_VIEW
        }));
      },

      scaleContinuousColumn(multiplier: number) {
        if (!Number.isFinite(multiplier) || multiplier <= 0) return;
        set((state) => ({
          continuousColumnScale: Math.min(
            MAX_CONTINUOUS_COLUMN_SCALE,
            Math.max(MIN_CONTINUOUS_COLUMN_SCALE, roundImageTransformValue(state.continuousColumnScale * multiplier))
          )
        }));
      },

      resizeFilmstrip(width: number) {
        set({ filmstripWidth: Math.min(MAX_FILMSTRIP_WIDTH, Math.max(MIN_FILMSTRIP_WIDTH, Math.round(width))) });
      },

      toggleFilmstrip() {
        set((state) => ({ isFilmstripVisible: !state.isFilmstripVisible }));
      },

      toggleDownloadPanel() {
        set((state) => ({
          isDownloadPanelOpen:
            state.downloadActivity.rows.length > 0 &&
            !state.isDownloadPanelOpen
        }));
      },

      toggleSourcesPanel() {
        set((state) => ({ isSourcesPanelOpen: !state.isSourcesPanelOpen }));
      },

      openSettings(view = "settings") {
        set({ settingsView: view });
      },

      closeSettings() {
        set({ settingsView: null });
      },

      async loadUpdateState() {
        const revision = updateStateRevision;
        try {
          const updateState = await api.getUpdateState();
          // A pushed change that arrived first is newer than this answer.
          if (revision === updateStateRevision) set({ updateState });
        } catch (error) {
          console.error(error);
        }
      },

      applyUpdateState(updateState: UpdateState) {
        updateStateRevision += 1;
        set({ updateState });
      },

      // Main pushes each state change, so these only ask for the step.
      async checkForUpdates() {
        try {
          await api.checkForUpdates();
        } catch (error) {
          console.error(error);
        }
      },

      async downloadUpdate() {
        try {
          await api.downloadUpdate();
        } catch (error) {
          console.error(error);
        }
      },

      async installUpdate() {
        try {
          await api.installUpdate();
        } catch (error) {
          console.error(error);
        }
      },

      async toggleFullscreen() {
        await api.toggleFullscreen();
      },

      async exitFullscreen() {
        await api.exitFullscreen();
      }
    };
  });
}
