import { createAppBuildInfo } from "../../shared/appBuild";
import type {
  AddSourceResult,
  DownloadActivitySnapshot,
  MediaCollection,
  OpenSourceError,
  OpenSourceRequest
} from "../../shared/media";
import type { PixvittaApi, PixvittaCommand, WindowChromeState } from "../../shared/pixvittaApi";
import type { RecentSource } from "../../shared/recentSources";
import { defaultSettings, type AppSettings } from "../../shared/settings";
import { createUpdateState, type UpdateState } from "../../shared/updates";

/*
 * A stand-in for the main process, implementing the whole PixvittaApi. It keeps
 * the one rule of the real library that the renderer can break: every delivered
 * collection must be acknowledged exactly once, and within the deadline. The real
 * app quits on a violation; the stage records it in `violations`.
 *
 * The controls below are the stage's whole surface. Tests reach them through
 * page.evaluate and agents through preview_evaluate, as window.pixvittaStage.
 */

const ACKNOWLEDGEMENT_TIMEOUT_MS = 1_000;
const EMPTY_DOWNLOADS: DownloadActivitySnapshot = { revision: 0, rows: [], itemStates: {}, collectionActive: false };

type StageCall = { method: string; args: unknown[] };

/**
 * What opening a location does: a collection appears, or it fails with an
 * error. "already-added" is main's answer to adding a source that is already
 * a member: nothing changes, and the add says so.
 */
export type StageSource = MediaCollection | OpenSourceError | "already-added";

export type StageControls = {
  readonly calls: StageCall[];
  readonly violations: string[];
  /** Every PixvittaApi method the renderer called, with arguments, in order. */
  callsTo(method: string): unknown[][];
  isViewerReady(): boolean;
  /** Defines what openSource and addSource do for a location, or for the folder picker with "pick-directory". */
  defineSource(location: string, source: StageSource): void;
  setRecentSources(sources: RecentSource[]): void;
  setSettings(settings: Partial<AppSettings>): void;
  /** Pushes an update state, as main does on every change. Update calls only record. */
  setUpdateState(state: Partial<UpdateState>): void;
  /** Holds openSource in its loading state until releaseOpen is called. */
  holdOpens(): void;
  releaseOpens(): void;
  deliverCollection(collection: MediaCollection): void;
  setLoading(isLoading: boolean): void;
  showSourceError(error: OpenSourceError): void;
  setDownloadActivity(snapshot: DownloadActivitySnapshot): void;
  sendCommand(command: PixvittaCommand): void;
};

type Listeners<T> = Set<(value: T) => void>;

function subscribe<T>(listeners: Listeners<T>, callback: (value: T) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function createStage(): { api: PixvittaApi; controls: StageControls } {
  const calls: StageCall[] = [];
  const violations: string[] = [];
  const sources = new Map<string, StageSource>();
  let settings: AppSettings = defaultSettings;
  let recentSources: RecentSource[] = [];
  let downloadActivity = EMPTY_DOWNLOADS;
  let updateState: UpdateState = createUpdateState("0.0.0-stage", "latest", null);
  let chrome: WindowChromeState = { zoomFactor: 1, isFullScreen: false, hasMacTrafficLights: false };
  let currentCollection: MediaCollection | null = null;
  let viewerReady = false;
  let acknowledgementTimer: ReturnType<typeof setTimeout> | null = null;
  let held: Array<() => void> | null = null;
  const beforeReady: Array<() => void> = [];

  const collectionListeners: Listeners<MediaCollection> = new Set();
  const loadingListeners: Listeners<boolean> = new Set();
  const errorListeners: Listeners<OpenSourceError> = new Set();
  const commandListeners: Listeners<PixvittaCommand> = new Set();
  const chromeListeners: Listeners<WindowChromeState> = new Set();
  const downloadListeners: Listeners<DownloadActivitySnapshot> = new Set();
  const recentListeners: Listeners<RecentSource[]> = new Set();
  const settingsListeners: Listeners<AppSettings> = new Set();
  const updateListeners: Listeners<UpdateState> = new Set();

  function record(method: string, ...args: unknown[]): void {
    calls.push({ method, args });
  }

  // Like the real main process, nothing reaches the renderer before viewer:ready,
  // and like real IPC, each message arrives in its own task, never during a render.
  function whenViewerReady(deliver: () => void): void {
    if (viewerReady) setTimeout(deliver);
    else beforeReady.push(deliver);
  }

  function deliverCollection(collection: MediaCollection): void {
    whenViewerReady(() => {
      if (acknowledgementTimer !== null) {
        violations.push("A collection was delivered while another was still unacknowledged.");
      }
      currentCollection = collection;
      acknowledgementTimer = setTimeout(() => {
        violations.push(`The renderer did not acknowledge a collection within ${ACKNOWLEDGEMENT_TIMEOUT_MS}ms.`);
        acknowledgementTimer = null;
      }, ACKNOWLEDGEMENT_TIMEOUT_MS);
      for (const listener of collectionListeners) listener(collection);
    });
  }

  function setLoading(isLoading: boolean): void {
    whenViewerReady(() => {
      for (const listener of loadingListeners) listener(isLoading);
    });
  }

  function showSourceError(error: OpenSourceError): void {
    whenViewerReady(() => {
      for (const listener of errorListeners) listener(error);
    });
  }

  // Resolves as main answers an add: after the collection or the error it
  // produced has been sent.
  function open(key: string): Promise<AddSourceResult> {
    setLoading(true);
    return new Promise((resolve) => {
      const finish = () => {
        const source = sources.get(key) ?? "not-found";
        if (source === "already-added") {
          setLoading(false);
          whenViewerReady(() => resolve("already-added"));
        } else if (typeof source === "string") {
          setLoading(false);
          showSourceError(source);
          whenViewerReady(() => resolve("not-added"));
        } else {
          deliverCollection(source);
          whenViewerReady(() => resolve("added"));
        }
      };
      if (held) held.push(finish);
      else finish();
    });
  }

  const api: PixvittaApi = {
    async getBuildInfo() {
      return createAppBuildInfo({ flavorOverride: "dev", version: "0.0.0-stage" });
    },
    openSource(request: OpenSourceRequest) {
      record("openSource", request);
      void open(request.kind === "location" ? request.location : "pick-directory");
    },
    // The stage delivers whatever collection the scenario defined for the
    // location, so a scenario defines the merged collection an add produces.
    addSource(request: OpenSourceRequest) {
      record("addSource", request);
      return open(request.kind === "location" ? request.location : "pick-directory");
    },
    // Removing needs the library's merge, which the stage does not have; a
    // scenario delivers the resulting collection itself if it needs one.
    removeSource(memberId: string) {
      record("removeSource", memberId);
    },
    refreshSource() {
      record("refreshSource");
      if (!currentCollection) return;
      setLoading(true);
      deliverCollection(currentCollection);
    },
    async openSourceOrigin(sourceId) {
      record("openSourceOrigin", sourceId);
      return true;
    },
    async signInExHentai() {
      record("signInExHentai");
      return false;
    },
    async getRecentSources() {
      return recentSources;
    },
    async removeRecentSource(location) {
      record("removeRecentSource", location);
      recentSources = recentSources.filter((source) => source.location !== location);
      return recentSources;
    },
    async getSettings() {
      return settings;
    },
    async saveSettings(next) {
      record("saveSettings", next);
      settings = next;
      return settings;
    },
    async downloadMedia(mediaId) {
      record("downloadMedia", mediaId);
      return true;
    },
    async downloadCollection(collectionName, mediaIds) {
      record("downloadCollection", collectionName, mediaIds);
      return true;
    },
    async getDownloadActivity() {
      return downloadActivity;
    },
    async showMediaContextMenu(mediaId) {
      record("showMediaContextMenu", mediaId);
      return true;
    },
    async saveMediaThumbnail(thumbnailReference) {
      record("saveMediaThumbnail", thumbnailReference);
      return true;
    },
    async toggleFullscreen() {
      record("toggleFullscreen");
      chrome = { ...chrome, isFullScreen: !chrome.isFullScreen };
      for (const listener of chromeListeners) listener(chrome);
    },
    async exitFullscreen() {
      record("exitFullscreen");
      chrome = { ...chrome, isFullScreen: false };
      for (const listener of chromeListeners) listener(chrome);
    },
    async getWindowChromeState() {
      return chrome;
    },
    async markViewerReady() {
      viewerReady = true;
      for (const deliver of beforeReady.splice(0)) setTimeout(deliver);
    },
    acknowledgeCollection() {
      record("acknowledgeCollection");
      if (acknowledgementTimer === null) {
        violations.push("The renderer acknowledged a collection that was not awaiting acknowledgement.");
        return;
      }
      clearTimeout(acknowledgementTimer);
      acknowledgementTimer = null;
      setLoading(false);
    },
    setSelectedMedia(mediaId) {
      record("setSelectedMedia", mediaId);
    },
    setTextEntryFocused(focused) {
      record("setTextEntryFocused", focused);
    },
    async getUpdateState() {
      return updateState;
    },
    async checkForUpdates() {
      record("checkForUpdates");
      return updateState;
    },
    async downloadUpdate() {
      record("downloadUpdate");
      return updateState;
    },
    async installUpdate() {
      record("installUpdate");
    },
    onWindowChromeChanged: (callback) => subscribe(chromeListeners, callback),
    onCommand: (callback) => subscribe(commandListeners, callback),
    onCollectionChanged: (callback) => subscribe(collectionListeners, callback),
    onSourceLoadingChanged: (callback) => subscribe(loadingListeners, callback),
    onSourceError: (callback) => subscribe(errorListeners, callback),
    onDownloadActivityChanged: (callback) => subscribe(downloadListeners, callback),
    onRecentSourcesChanged: (callback) => subscribe(recentListeners, callback),
    onSettingsChanged: (callback) => subscribe(settingsListeners, callback),
    onUpdateStateChanged: (callback) => subscribe(updateListeners, callback)
  };

  const controls: StageControls = {
    calls,
    violations,
    callsTo: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
    isViewerReady: () => viewerReady,
    defineSource(location, source) {
      sources.set(location, source);
    },
    setRecentSources(next) {
      recentSources = next;
      for (const listener of recentListeners) listener(next);
    },
    setSettings(next) {
      settings = { ...settings, ...next };
      for (const listener of settingsListeners) listener(settings);
    },
    setUpdateState(next) {
      updateState = { ...updateState, ...next };
      for (const listener of updateListeners) listener(updateState);
    },
    holdOpens() {
      held ??= [];
    },
    releaseOpens() {
      const pending = held ?? [];
      held = null;
      for (const finish of pending) finish();
    },
    deliverCollection,
    setLoading,
    showSourceError,
    setDownloadActivity(snapshot) {
      downloadActivity = snapshot;
      for (const listener of downloadListeners) listener(snapshot);
    },
    sendCommand(command) {
      for (const listener of commandListeners) listener(command);
    }
  };

  return { api, controls };
}
