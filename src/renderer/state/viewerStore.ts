import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  DownloadActivitySnapshot,
  MediaCollection,
  MediaItem,
  MediaSource,
  OpenSourceError,
  OpenSourceRequest
} from "../../shared/media";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import type { RecentSource } from "../../shared/recentSources";
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
  recentSources: RecentSource[];
  filmstripWidth: number;
  isFilmstripVisible: boolean;
  sourceOpenError: OpenSourceError | null;
  pendingAuthenticationLocation: string | null;
  downloadActivity: DownloadActivitySnapshot;
  isDownloadPanelOpen: boolean;
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
  openRecentSource(location: string): Promise<void>;
  signInExHentai(): Promise<void>;
  removeRecentSource(location: string): Promise<void>;
  openCollection(collection: MediaCollection): void;
  setSourceLoading(isLoading: boolean): void;
  showSourceError(error: OpenSourceError): void;
  refreshSource(): Promise<void>;
  downloadCurrentMedia(): Promise<void>;
  downloadCollection(): Promise<void>;
  loadDownloadActivity(): Promise<void>;
  applyDownloadActivity(snapshot: DownloadActivitySnapshot): void;
  refreshRecentSources(): Promise<void>;
  applyRecentSources(sources: RecentSource[]): void;
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

    const applyOpenedCollection = (collection: MediaCollection) => {
      sourceRequestRevision += 1;
      set((state) => applyCollection(state, collection));
    };

    const openSourceRequest = async (request: OpenSourceRequest) => {
      sourceRequestRevision += 1;
      try {
        set({ pendingAuthenticationLocation: exHentaiLocation(request) });
        api.openSource(request);
      } catch (error) {
        console.error(error);
        set({
          isSourceLoading: false,
          loadState: get().source ? get().loadState : "idle",
          sourceOpenError: "unavailable"
        });
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
      filmstripWidth: DEFAULT_FILMSTRIP_WIDTH,
      isFilmstripVisible: true,
      sourceOpenError: null,
      pendingAuthenticationLocation: null,
      downloadActivity: {
        revision: 0,
        rows: [],
        itemStates: {},
        collectionActive: false
      },
      isDownloadPanelOpen: false,
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

      async openRecentSource(location: string) {
        await openSourceRequest({ kind: "location", location });
      },

      async signInExHentai() {
        const location = get().pendingAuthenticationLocation;
        const revision = sourceRequestRevision;
        try {
          const signedIn = await api.signInExHentai();
          if (signedIn && location && revision === sourceRequestRevision) {
            await openSourceRequest({ kind: "location", location });
          }
        } catch (error) {
          console.error(error);
        }
      },

      async removeRecentSource(location: string) {
        const revision = ++recentSourcesRevision;
        try {
          const recentSources = await api.removeRecentSource(location);
          if (revision === recentSourcesRevision) set({ recentSources });
        } catch (error) {
          console.error(error);
        }
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
          loadState: state.source ? state.loadState : "idle"
        }));
      },

      async refreshSource() {
        const { source } = get();
        if (!source?.capabilities.canRefresh) return;

        sourceRequestRevision += 1;
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

      applyRecentSources(recentSources: RecentSource[]) {
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
