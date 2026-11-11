import { contextBridge, ipcRenderer } from "electron";
import type { AppBuildInfo } from "../shared/appBuild";
import type {
  AddSourceRequest,
  AddSourceResult,
  DownloadActivitySnapshot,
  MediaCollection,
  OpenSourceError,
  OpenSourceRequest,
  ReplaceConfirmation
} from "../shared/media";
import type { PixvittaApi, PixvittaCommand, WindowChromeState } from "../shared/pixvittaApi";
import type { RecentEntry } from "../shared/recentSources";
import type { AppSettings } from "../shared/settings";
import type { UpdateState } from "../shared/updates";

/*
 * The preload script runs in a special Electron context before the renderer's
 * web app starts. It can use ipcRenderer, but React cannot because
 * nodeIntegration is disabled and contextIsolation is enabled. contextBridge
 * exposes a tiny, typed window.pixvitta API that feels like normal browser
 * methods while still routing privileged work to the main process.
 */

const pixvittaApi = {
  getBuildInfo: (): Promise<AppBuildInfo> => ipcRenderer.invoke("app:get-build-info"),
  openSource: (request: OpenSourceRequest, options?: { replaceConfirmed: boolean }): void =>
    ipcRenderer.send("source:open", request, options),
  addSource: (request: AddSourceRequest): Promise<AddSourceResult> =>
    ipcRenderer.invoke("source:add", request),
  removeSource: (memberId: string): void =>
    ipcRenderer.send("source:remove", memberId),
  refreshSource: (): void =>
    ipcRenderer.send("source:refresh"),
  openSourceOrigin: (sourceId: string): Promise<boolean> =>
    ipcRenderer.invoke("source:open-origin", sourceId),
  signInExHentai: (): Promise<boolean> =>
    ipcRenderer.invoke("exhentai:sign-in"),

  // Persistent app data also goes through main. The renderer gets plain objects,
  // not direct access to JSON files under Electron's userData directory.
  getRecentSources: (): Promise<RecentEntry[]> =>
    ipcRenderer.invoke("recent-sources:get"),
  removeRecentSource: (location: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke("recent-sources:remove", location),
  removeSavedMix: (id: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke("saved-mixes:remove", id),
  pinSavedMix: (id: string, pinned: boolean): Promise<RecentEntry[]> =>
    ipcRenderer.invoke("saved-mixes:pin", id, pinned),
  renameSavedMix: (id: string, name: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke("saved-mixes:rename", id, name),
  showSavedMixMenu: (id: string, position?: { x: number; y: number }): void =>
    ipcRenderer.send("saved-mixes:show-menu", id, position),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("settings:save", settings),

  // Media actions pass IDs or validated data across the bridge. The main process
  // resolves IDs to paths and decides whether anything should touch disk.
  downloadMedia: (mediaId: string): Promise<boolean> =>
    ipcRenderer.invoke("media:download", mediaId),
  downloadCollection: (
    collectionName: string,
    mediaIds: string[]
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "media:download-collection",
      collectionName,
      mediaIds
    ),
  getDownloadActivity: (): Promise<DownloadActivitySnapshot> =>
    ipcRenderer.invoke("media:get-download-activity"),
  showMediaContextMenu: (mediaId: string): Promise<boolean> => ipcRenderer.invoke("media:show-context-menu", mediaId),
  saveMediaThumbnail: (thumbnailReference: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke("thumbnail:save-media", thumbnailReference, dataUrl),

  // Native window state belongs to BrowserWindow in the main process. These
  // methods give React controls without granting direct BrowserWindow access.
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke("window:toggle-fullscreen"),
  exitFullscreen: (): Promise<void> => ipcRenderer.invoke("window:exit-fullscreen"),
  getWindowChromeState: (): Promise<WindowChromeState> => ipcRenderer.invoke("window:get-chrome-state"),

  // This readiness call tells main that React has mounted and installed the
  // event subscriptions below. It prevents early file-open events from being
  // sent into the void during startup.
  markViewerReady: (): Promise<void> => ipcRenderer.invoke("viewer:ready"),
  setSelectedMedia: (mediaId: string | null): void =>
    ipcRenderer.send("library:select-media", mediaId),
  acknowledgeCollection: (): void =>
    ipcRenderer.send("library:renderer-stable"),
  setTextEntryFocused: (focused: boolean): void =>
    ipcRenderer.send("window:text-entry-focused", focused),

  // App updates run in main. The renderer reads the state and asks for the
  // next step; main decides whether that step is allowed right now.
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke("updates:get-state"),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke("updates:check"),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("updates:download"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("updates:install"),

  // Event subscriptions are push-style messages from main to renderer. Each one
  // returns an unsubscribe function so React effects can clean up listeners.
  onWindowChromeChanged: (callback: (state: WindowChromeState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WindowChromeState) => callback(state);
    ipcRenderer.on("window:chrome-changed", listener);
    return () => ipcRenderer.removeListener("window:chrome-changed", listener);
  },
  onCommand: (callback: (command: PixvittaCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: PixvittaCommand) => callback(command);
    ipcRenderer.on("menu:command", listener);
    return () => ipcRenderer.removeListener("menu:command", listener);
  },
  onCollectionChanged: (callback: (collection: MediaCollection) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, collection: MediaCollection) => callback(collection);
    ipcRenderer.on("library:collection-changed", listener);
    return () => ipcRenderer.removeListener("library:collection-changed", listener);
  },
  onSourceLoadingChanged: (callback: (isLoading: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isLoading: boolean) => callback(isLoading);
    ipcRenderer.on("library:loading-changed", listener);
    return () => ipcRenderer.removeListener("library:loading-changed", listener);
  },
  onReplaceConfirmation: (callback: (confirmation: ReplaceConfirmation) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, confirmation: ReplaceConfirmation) => callback(confirmation);
    ipcRenderer.on("library:confirm-replace", listener);
    return () => ipcRenderer.removeListener("library:confirm-replace", listener);
  },
  onSourceError: (callback: (error: OpenSourceError) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: OpenSourceError) => callback(error);
    ipcRenderer.on("library:source-error", listener);
    return () => ipcRenderer.removeListener("library:source-error", listener);
  },
  onDownloadActivityChanged: (
    callback: (snapshot: DownloadActivitySnapshot) => void
  ): (() => void) => {
    const listener = (
      event: Electron.IpcRendererEvent,
      snapshot: DownloadActivitySnapshot
    ) => {
      void event;
      callback(snapshot);
    };
    ipcRenderer.on("media:download-activity-changed", listener);
    return () =>
      ipcRenderer.removeListener(
        "media:download-activity-changed",
        listener
      );
  },
  onRecentSourcesChanged: (callback: (sources: RecentEntry[]) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      sources: RecentEntry[]
    ) => callback(sources);
    ipcRenderer.on("recent-sources:changed", listener);
    return () => ipcRenderer.removeListener("recent-sources:changed", listener);
  },
  onSavedMixRenameRequested: (callback: (id: string) => void): (() => void) => {
    const listener = (event: Electron.IpcRendererEvent, id: string) => {
      void event;
      callback(id);
    };
    ipcRenderer.on("saved-mixes:rename-requested", listener);
    return () => ipcRenderer.removeListener("saved-mixes:rename-requested", listener);
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  onUpdateStateChanged: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on("updates:state-changed", listener);
    return () => ipcRenderer.removeListener("updates:state-changed", listener);
  }
} satisfies PixvittaApi;

contextBridge.exposeInMainWorld("pixvitta", pixvittaApi);

// Copy Image needs PNG data, and the main process cannot decode WebP or AVIF,
// so it asks this context, which has Chromium's image decoders, to encode it.
// React never sees this channel.
type EncodePngRequest = { id: string; bytes: Uint8Array; mimeType: string };

const SVG_FALLBACK_SIZE = 1024;

// SVGs without their own width and height cannot be drawn until they are given
// a size. Their viewBox, when they have one, gives the shape.
function withFallbackSize(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const ratio = viewBox?.[2] && viewBox[3] && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox[2] / viewBox[3] : 1;
  root.setAttribute("width", String(ratio >= 1 ? SVG_FALLBACK_SIZE : Math.max(1, Math.round(SVG_FALLBACK_SIZE * ratio))));
  root.setAttribute("height", String(ratio >= 1 ? Math.max(1, Math.round(SVG_FALLBACK_SIZE / ratio)) : SVG_FALLBACK_SIZE));
  return new XMLSerializer().serializeToString(document);
}

// createImageBitmap cannot decode an SVG blob, but an image element can.
async function loadSvg(svg: string): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterizeSvg(blob: Blob): Promise<ImageBitmap> {
  const svg = await blob.text();
  return loadSvg(svg).catch(() => loadSvg(withFallbackSize(svg)));
}

async function encodePng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const bitmap = mimeType === "image/svg+xml" ? await rasterizeSvg(blob) : await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a canvas to encode the image.");
    context.drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

ipcRenderer.on("clipboard:encode-png", (event, request: EncodePngRequest) => {
  void event;
  void encodePng(request.bytes, request.mimeType).then(
    (png) => ipcRenderer.send("clipboard:encoded-png", { id: request.id, png }),
    (error: unknown) =>
      ipcRenderer.send("clipboard:encoded-png", {
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      })
  );
});
