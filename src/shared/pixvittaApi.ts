import type { AccountState } from "./accounts";
import type { AppBuildInfo } from "./appBuild";
import type {
  AddSourceRequest,
  AddSourceResult,
  DownloadActivitySnapshot,
  MediaCollection,
  OpenSourceError,
  OpenSourceRequest,
  ReplaceConfirmation
} from "./media";
import type { RecentEntry } from "./recentSources";
import type { AppSettings } from "./settings";
import type { UpdateState } from "./updates";

export type PixvittaCommand =
  | "open-folder"
  | "add-folder"
  | "refresh-source"
  | "open-settings"
  | "previous-media"
  | "next-media"
  | "seek-video-backward"
  | "seek-video-forward"
  | "toggle-video-playback"
  | "show-shortcuts"
  | "check-for-updates";

export type WindowChromeState = {
  zoomFactor: number;
  isFullScreen: boolean;
  hasMacTrafficLights: boolean;
};

export type PixvittaApi = {
  getBuildInfo(): Promise<AppBuildInfo>;
  // Replaces the open collection with a source or a saved mix. When that would replace a mix, main asks
  // first through onReplaceConfirmation and opens only once the request comes
  // back with replaceConfirmed.
  openSource(request: OpenSourceRequest, options?: { replaceConfirmed: boolean }): void;
  // Adds a source to the open collection. Resolves once main is done with the
  // request; the reply is not ordered against main's loading and collection
  // messages.
  addSource(request: AddSourceRequest): Promise<AddSourceResult>;
  // Removes one member source, by its ID in source.members, from the open collection.
  removeSource(memberId: string): void;
  refreshSource(): void;
  openSourceOrigin(sourceId: string): Promise<boolean>;
  getAccounts(): Promise<AccountState[]>;
  signIn(accountId: string): Promise<boolean>;
  signOut(accountId: string): Promise<void>;
  getRecentSources(): Promise<RecentEntry[]>;
  removeRecentSource(location: string): Promise<RecentEntry[]>;
  // Saved mixes in recents, by their ID. Removing one leaves its sources in
  // recents. Only a pinned mix can be renamed; an empty name clears it.
  removeSavedMix(id: string): Promise<RecentEntry[]>;
  pinSavedMix(id: string, pinned: boolean): Promise<RecentEntry[]>;
  renameSavedMix(id: string, name: string): Promise<RecentEntry[]>;
  // Shows a saved mix's native menu, at a point in the page or else at the
  // pointer. Main publishes what it changes, and asks for a rename through
  // onSavedMixRenameRequested.
  showSavedMixMenu(id: string, position?: { x: number; y: number }): void;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  downloadMedia(mediaId: string): Promise<boolean>;
  downloadCollection(
    collectionName: string,
    mediaIds: string[]
  ): Promise<boolean>;
  getDownloadActivity(): Promise<DownloadActivitySnapshot>;
  showMediaContextMenu(mediaId: string): Promise<boolean>;
  saveMediaThumbnail(thumbnailReference: string, dataUrl: string): Promise<boolean>;
  toggleFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  getWindowChromeState(): Promise<WindowChromeState>;
  markViewerReady(): Promise<void>;
  acknowledgeCollection(): void;
  setSelectedMedia(mediaId: string | null): void;
  // Tells main whether a text field has focus, so it leaves viewer keys
  // (arrows, J, K, L) to the page while one does.
  setTextEntryFocused(focused: boolean): void;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onWindowChromeChanged(callback: (state: WindowChromeState) => void): () => void;
  onCommand(callback: (command: PixvittaCommand) => void): () => void;
  onCollectionChanged(callback: (collection: MediaCollection) => void): () => void;
  onSourceLoadingChanged(callback: (isLoading: boolean) => void): () => void;
  // accountId names the account to sign in to, for authentication-required.
  onSourceError(callback: (error: OpenSourceError, accountId?: string) => void): () => void;
  onReplaceConfirmation(callback: (confirmation: ReplaceConfirmation) => void): () => void;
  onDownloadActivityChanged(
    callback: (snapshot: DownloadActivitySnapshot) => void
  ): () => void;
  onRecentSourcesChanged(callback: (sources: RecentEntry[]) => void): () => void;
  onSavedMixRenameRequested(callback: (id: string) => void): () => void;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
  onUpdateStateChanged(callback: (state: UpdateState) => void): () => void;
  onAccountsChanged(callback: (accounts: AccountState[]) => void): () => void;
};
