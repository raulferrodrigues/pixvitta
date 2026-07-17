import { createStore, type StoreApi } from "zustand/vanilla";
import type { Folder, MediaItem } from "../../shared/media";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import type { RecentFolder } from "../../shared/recentFolders";
import { defaultSettings, type AppSettings, type FileOrder } from "../../shared/settings";
import { clampImageZoom, MIN_IMAGE_ZOOM, roundImageTransformValue } from "./imageView";
import { nextIndex, previousIndex } from "./navigation";
import { createVideoController, type VideoController } from "./videoController";
import { selectCurrentItem } from "./viewerSelectors";

export type ViewerLoadState = "idle" | "loading" | "ready" | "empty" | "error";

export const DEFAULT_FILMSTRIP_WIDTH = 168;
export const MIN_FILMSTRIP_WIDTH = 128;
export const MAX_FILMSTRIP_WIDTH = 320;

export type ViewerState = {
  folderPath: string | null;
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
};

export type ViewerActions = {
  initialize(): Promise<void>;
  openFolder(): Promise<void>;
  openRecentFolder(folderPath: string): Promise<void>;
  removeRecentFolder(folderPath: string): Promise<void>;
  openScannedFolder(folder: Folder): void;
  rescanFolder(): Promise<void>;
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

function applyFolder(folder: Folder): Partial<ViewerState> {
  const selectedIndex = folder.selectedId === null ? -1 : folder.items.findIndex((item) => item.id === folder.selectedId);

  return {
    folderPath: folder.folderPath,
    items: folder.items,
    index: selectedIndex >= 0 ? selectedIndex : 0,
    mediaErrors: new Set(),
    isVideoPlaying: false,
    imageZoom: MIN_IMAGE_ZOOM,
    imagePanX: 0,
    imagePanY: 0,
    loadState: folder.items.length > 0 ? "ready" : "empty"
  };
}

function settingsRequireFolderRescan(previousSettings: AppSettings, nextSettings: AppSettings): boolean {
  return previousSettings.fileOrder !== nextSettings.fileOrder || previousSettings.includeHidden !== nextSettings.includeHidden;
}

export function createViewerStore(
  api: PixvittaApi,
  videoController: VideoController = createVideoController()
): ViewerStoreApi {
  let folderRequestId = 0;
  let settingsSaveRevision = 0;
  const nextFolderRequestId = () => {
    folderRequestId += 1;
    return folderRequestId;
  };
  const isCurrentFolderRequest = (requestId: number) => requestId === folderRequestId;

  return createStore<ViewerStore>((set, get) => {
    const applySettingsState = (settings: AppSettings) => {
      const previousSettings = get().settings;
      const shouldRescanFolder = settingsRequireFolderRescan(previousSettings, settings);
      const shouldResetVideoLoop = previousSettings.videoLoopByDefault !== settings.videoLoopByDefault;

      set({
        settings,
        ...(shouldResetVideoLoop ? { isVideoLooping: settings.videoLoopByDefault } : {})
      });

      if (shouldRescanFolder && get().folderPath) void get().rescanFolder();
    };

    const applyScannedFolder = (folder: Folder) => {
      set(applyFolder(folder));
      void get().refreshRecentFolders();
    };

    return {
      folderPath: null,
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

      async initialize() {
        await Promise.all([get().loadSettings(), get().refreshRecentFolders()]);
      },

      async openFolder() {
        const requestId = nextFolderRequestId();
        const isOpeningInitialFolder = get().folderPath === null;
        if (isOpeningInitialFolder) set({ loadState: "loading" });

        try {
          const result = await api.openFolder();
          if (!isCurrentFolderRequest(requestId)) return;
          if (!result) {
            if (isOpeningInitialFolder) set({ loadState: "idle" });
            return;
          }
          applyScannedFolder(result);
        } catch (error) {
          if (!isCurrentFolderRequest(requestId)) return;
          console.error(error);
          set({ loadState: "error" });
        }
      },

      async openRecentFolder(folderPath: string) {
        const requestId = nextFolderRequestId();
        const isOpeningInitialFolder = get().folderPath === null;
        if (isOpeningInitialFolder) set({ loadState: "loading" });
        try {
          const result = await api.openRecentFolder(folderPath);
          if (!isCurrentFolderRequest(requestId)) return;
          applyScannedFolder(result);
        } catch (error) {
          if (!isCurrentFolderRequest(requestId)) return;
          console.error(error);
          set({ loadState: "error" });
        }
      },

      async removeRecentFolder(folderPath: string) {
        try {
          set({ recentFolders: await api.removeRecentFolder(folderPath) });
        } catch (error) {
          console.error(error);
        }
      },

      openScannedFolder(folder: Folder) {
        nextFolderRequestId();
        applyScannedFolder(folder);
      },

      async rescanFolder() {
        const { folderPath } = get();
        if (!folderPath) return;

        const requestId = nextFolderRequestId();
        try {
          const result = await api.rescanFolder(folderPath);
          if (!isCurrentFolderRequest(requestId)) return;
          set(applyFolder(result));
        } catch (error) {
          if (!isCurrentFolderRequest(requestId)) return;
          console.error(error);
          set({ loadState: "error" });
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
