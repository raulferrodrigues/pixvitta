import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  MediaCollection,
  MediaItem,
  MediaSource,
  OpenSourceError,
  OpenSourceRequest
} from "../../shared/media";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import type { RecentFolder } from "../../shared/recentFolders";
import { defaultSettings, type AppSettings, type FileOrder } from "../../shared/settings";
import { clampImageZoom, MIN_IMAGE_ZOOM, roundImageTransformValue } from "./imageView";
import { nextIndex, previousIndex } from "./navigation";
import { createVideoController, type VideoController } from "./videoController";
import { selectCurrentItem } from "./viewerSelectors";

export type ViewerLoadState = "idle" | "loading" | "ready" | "empty" | "error";
export type MediaDownloadState = "idle" | "downloading" | "downloaded" | "error";

export const DEFAULT_FILMSTRIP_WIDTH = 168;
export const MIN_FILMSTRIP_WIDTH = 128;
export const MAX_FILMSTRIP_WIDTH = 320;

export type ViewerState = {
  source: MediaSource | null;
  items: MediaItem[];
  index: number;
  loadState: ViewerLoadState;
  mediaErrors: Set<string>;
  isVideoPlaying: boolean;
  isVideoLooping: boolean;
  imageZoom: number;
  imagePanX: number;
  imagePanY: number;
  settings: AppSettings;
  recentFolders: RecentFolder[];
  filmstripWidth: number;
  isFilmstripVisible: boolean;
  sourceOpenError: OpenSourceError | null;
  downloadState: MediaDownloadState;
  downloadedFileName: string | null;
};

export type ViewerActions = {
  initialize(): Promise<void>;
  openFolder(): Promise<void>;
  openLocation(location: string): Promise<void>;
  openRecentFolder(folderPath: string): Promise<void>;
  removeRecentFolder(folderPath: string): Promise<void>;
  openCollection(collection: MediaCollection): void;
  refreshSource(): Promise<void>;
  downloadCurrentMedia(): Promise<void>;
  refreshRecentFolders(): Promise<void>;
  loadSettings(): Promise<void>;
  applySettings(settings: AppSettings): void;
  setFileOrder(fileOrder: FileOrder): Promise<void>;
  toggleUnobtrusiveControls(): Promise<void>;
  goNext(): void;
  goPrevious(): void;
  selectMedia(index: number): void;
  markMediaBroken(id: string): void;
  attachVideoElement(element: HTMLVideoElement | null): void;
  toggleVideoPlayback(): Promise<void>;
  seekVideoBy(seconds: number): boolean;
  setVideoPlaying(isPlaying: boolean): void;
  toggleVideoLoop(): void;
  zoomCurrentImage(multiplier: number): void;
  setImageView(zoom: number, panX: number, panY: number): void;
  resizeFilmstrip(width: number): void;
  toggleFilmstrip(): void;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
};

export type ViewerStore = ViewerState & ViewerActions;
export type ViewerStoreApi = StoreApi<ViewerStore>;

function applyCollection(collection: MediaCollection): Partial<ViewerState> {
  const selectedIndex = collection.selectedId === null
    ? -1
    : collection.items.findIndex((item) => item.id === collection.selectedId);

  return {
    source: collection.source,
    items: collection.items,
    index: selectedIndex >= 0 ? selectedIndex : 0,
    mediaErrors: new Set(),
    isVideoPlaying: false,
    imageZoom: MIN_IMAGE_ZOOM,
    imagePanX: 0,
    imagePanY: 0,
    sourceOpenError: null,
    downloadState: "idle",
    downloadedFileName: null,
    loadState: collection.items.length > 0 ? "ready" : "empty"
  };
}

function settingsRequireSourceRefresh(previousSettings: AppSettings, nextSettings: AppSettings): boolean {
  return previousSettings.fileOrder !== nextSettings.fileOrder || previousSettings.includeHidden !== nextSettings.includeHidden;
}

export function createViewerStore(
  api: PixvittaApi,
  videoController: VideoController = createVideoController()
): ViewerStoreApi {
  let sourceRequestId = 0;
  let settingsSaveRevision = 0;
  const nextSourceRequestId = () => {
    sourceRequestId += 1;
    return sourceRequestId;
  };
  const isCurrentSourceRequest = (requestId: number) => requestId === sourceRequestId;

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
      set(applyCollection(collection));
      void get().refreshRecentFolders();
    };

    const openSourceRequest = async (request: OpenSourceRequest) => {
      const requestId = nextSourceRequestId();
      const isOpeningInitialSource = get().source === null;
      set(
        isOpeningInitialSource
          ? { loadState: "loading", sourceOpenError: null }
          : { sourceOpenError: null }
      );

      try {
        const result = await api.openSource(request);
        if (!isCurrentSourceRequest(requestId)) return;
        if (!result.ok) {
          set({
            loadState: isOpeningInitialSource ? "idle" : get().loadState,
            sourceOpenError: result.error
          });
          return;
        }
        if (!result.collection) {
          if (isOpeningInitialSource) set({ loadState: "idle" });
          return;
        }
        applyOpenedCollection(result.collection);
      } catch (error) {
        if (!isCurrentSourceRequest(requestId)) return;
        console.error(error);
        set({
          loadState: isOpeningInitialSource ? "idle" : get().loadState,
          sourceOpenError: "unavailable"
        });
      }
    };

    return {
      source: null,
      items: [],
      index: 0,
      loadState: "idle",
      mediaErrors: new Set(),
      isVideoPlaying: false,
      isVideoLooping: defaultSettings.videoLoopByDefault,
      imageZoom: MIN_IMAGE_ZOOM,
      imagePanX: 0,
      imagePanY: 0,
      settings: defaultSettings,
      recentFolders: [],
      filmstripWidth: DEFAULT_FILMSTRIP_WIDTH,
      isFilmstripVisible: true,
      sourceOpenError: null,
      downloadState: "idle",
      downloadedFileName: null,

      async initialize() {
        await Promise.all([get().loadSettings(), get().refreshRecentFolders()]);
      },

      async openFolder() {
        await openSourceRequest({ kind: "pick-directory" });
      },

      async openLocation(location: string) {
        await openSourceRequest({ kind: "location", location });
      },

      async openRecentFolder(folderPath: string) {
        await openSourceRequest({ kind: "location", location: folderPath });
      },

      async removeRecentFolder(folderPath: string) {
        try {
          set({ recentFolders: await api.removeRecentFolder(folderPath) });
        } catch (error) {
          console.error(error);
        }
      },

      openCollection(collection: MediaCollection) {
        nextSourceRequestId();
        applyOpenedCollection(collection);
      },

      async refreshSource() {
        const { source } = get();
        if (!source?.capabilities.canRefresh) return;

        const requestId = nextSourceRequestId();
        try {
          const result = await api.refreshSource(source.id);
          if (!isCurrentSourceRequest(requestId)) return;
          if (!result.ok || !result.collection) {
            set({
              loadState: "error",
              sourceOpenError: result.ok ? "unavailable" : result.error
            });
            return;
          }
          set(applyCollection(result.collection));
        } catch (error) {
          if (!isCurrentSourceRequest(requestId)) return;
          console.error(error);
          set({ loadState: "error" });
        }
      },

      async downloadCurrentMedia() {
        const state = get();
        const item = selectCurrentItem(state);
        if (
          !item ||
          !state.source?.capabilities.canDownload ||
          state.downloadState === "downloading"
        ) {
          return;
        }

        set({ downloadState: "downloading", downloadedFileName: null });
        try {
          const result = await api.downloadMedia(item.id);
          if (selectCurrentItem(get())?.id !== item.id) return;
          set(
            result.ok
              ? {
                  downloadState: "downloaded",
                  downloadedFileName: result.fileName
                }
              : { downloadState: "error", downloadedFileName: null }
          );
        } catch (error) {
          console.error(error);
          if (selectCurrentItem(get())?.id === item.id) {
            set({ downloadState: "error", downloadedFileName: null });
          }
        }
      },

      async refreshRecentFolders() {
        try {
          set({ recentFolders: await api.getRecentFolders() });
        } catch (error) {
          console.error(error);
          set({ recentFolders: [] });
        }
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

      async setFileOrder(fileOrder: FileOrder) {
        const currentSettings = get().settings;
        if (fileOrder === currentSettings.fileOrder) return;
        const revision = settingsSaveRevision + 1;
        settingsSaveRevision = revision;
        try {
          const savedSettings = await api.saveSettings({ ...currentSettings, fileOrder });
          if (revision === settingsSaveRevision) applySettingsState(savedSettings);
        } catch (error) {
          if (revision === settingsSaveRevision) console.error(error);
        }
      },

      async toggleUnobtrusiveControls() {
        const previousSettings = get().settings;
        const nextSettings = {
          ...previousSettings,
          unobtrusiveViewerControls: !previousSettings.unobtrusiveViewerControls
        };
        const revision = settingsSaveRevision + 1;
        settingsSaveRevision = revision;
        applySettingsState(nextSettings);
        try {
          const savedSettings = await api.saveSettings(nextSettings);
          if (revision === settingsSaveRevision) applySettingsState(savedSettings);
        } catch (error) {
          if (revision !== settingsSaveRevision) return;
          console.error(error);
          applySettingsState(previousSettings);
        }
      },

      goNext() {
        set((state) => {
          const index = nextIndex(state.index, state.items.length, state.settings.wrapNavigation);
          return {
            index,
            isVideoPlaying: false,
            downloadState: "idle",
            downloadedFileName: null,
            imageZoom: index === state.index ? state.imageZoom : MIN_IMAGE_ZOOM,
            imagePanX: index === state.index ? state.imagePanX : 0,
            imagePanY: index === state.index ? state.imagePanY : 0
          };
        });
      },

      goPrevious() {
        set((state) => {
          const index = previousIndex(state.index, state.items.length, state.settings.wrapNavigation);
          return {
            index,
            isVideoPlaying: false,
            downloadState: "idle",
            downloadedFileName: null,
            imageZoom: index === state.index ? state.imageZoom : MIN_IMAGE_ZOOM,
            imagePanX: index === state.index ? state.imagePanX : 0,
            imagePanY: index === state.index ? state.imagePanY : 0
          };
        });
      },

      selectMedia(index: number) {
        set((state) => ({
          index,
          isVideoPlaying: false,
          downloadState: "idle",
          downloadedFileName: null,
          imageZoom: index === state.index ? state.imageZoom : MIN_IMAGE_ZOOM,
          imagePanX: index === state.index ? state.imagePanX : 0,
          imagePanY: index === state.index ? state.imagePanY : 0
        }));
      },

      markMediaBroken(id: string) {
        set((state) => ({ mediaErrors: new Set(state.mediaErrors).add(id) }));
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

      resizeFilmstrip(width: number) {
        set({ filmstripWidth: Math.min(MAX_FILMSTRIP_WIDTH, Math.max(MIN_FILMSTRIP_WIDTH, Math.round(width))) });
      },

      toggleFilmstrip() {
        set((state) => ({ isFilmstripVisible: !state.isFilmstripVisible }));
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
