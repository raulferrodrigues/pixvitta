/*
 * The app update state machine. Main owns the one live state and sends every
 * change to the renderer, which only draws it and asks for the next step. The
 * transitions are pure so the rules stay readable apart from electron-updater.
 */

/** electron-updater's channel name. Stable builds follow "latest". */
export type UpdateChannel = "latest" | "nightly";

export type UpdateStatus =
  | "unavailable"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateErrorContext = "check" | "download" | "install";

/** Why a build cannot update itself. The renderer turns it into a sentence. */
export type UpdateUnavailableReason = "unpackaged" | "unsigned-macos" | "unsupported-linux-package";

export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  channel: UpdateChannel;
  availableVersion: string | null;
  downloadedVersion: string | null;
  /** 0 to 100 while downloading, otherwise null. */
  downloadPercent: number | null;
  unavailableReason: UpdateUnavailableReason | null;
  /** What went wrong, as the updater reported it. */
  message: string | null;
  errorContext: UpdateErrorContext | null;
};

/** The one step the update button offers next, if any. */
export type UpdateAction = "check" | "download" | "install" | "none";

export function createUpdateState(
  currentVersion: string,
  channel: UpdateChannel,
  unavailableReason: UpdateUnavailableReason | null
): UpdateState {
  return {
    status: unavailableReason ? "unavailable" : "idle",
    currentVersion,
    channel,
    unavailableReason,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    message: null,
    errorContext: null
  };
}

export function onCheckStart(state: UpdateState): UpdateState {
  return { ...state, status: "checking", message: null, errorContext: null };
}

export function onUpdateAvailable(state: UpdateState, version: string): UpdateState {
  return { ...state, status: "available", availableVersion: version, message: null, errorContext: null };
}

export function onNoUpdate(state: UpdateState): UpdateState {
  return { ...state, status: "up-to-date", availableVersion: null, message: null, errorContext: null };
}

export function onCheckFailure(state: UpdateState, message: string): UpdateState {
  return { ...state, status: "error", message, errorContext: "check" };
}

export function onDownloadStart(state: UpdateState): UpdateState {
  return { ...state, status: "downloading", downloadPercent: 0, message: null, errorContext: null };
}

export function onDownloadProgress(state: UpdateState, percent: number): UpdateState {
  if (state.status !== "downloading") return state;
  return { ...state, downloadPercent: Math.min(100, Math.max(0, percent)) };
}

export function onDownloaded(state: UpdateState, version: string): UpdateState {
  return {
    ...state,
    status: "downloaded",
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    message: null,
    errorContext: null
  };
}

// The available version is kept, so the button offers the download again.
export function onDownloadFailure(state: UpdateState, message: string): UpdateState {
  return { ...state, status: "error", downloadPercent: null, message, errorContext: "download" };
}

// The downloaded version is kept, so the button offers the install again.
export function onInstallFailure(state: UpdateState, message: string): UpdateState {
  return { ...state, status: "error", message, errorContext: "install" };
}

export function resolveUpdateAction(state: UpdateState): UpdateAction {
  switch (state.status) {
    case "unavailable":
    case "checking":
    case "downloading":
      return "none";
    case "available":
      return "download";
    case "downloaded":
      return "install";
    case "error":
      if (state.errorContext === "install" && state.downloadedVersion) return "install";
      if (state.errorContext === "download" && state.availableVersion) return "download";
      return "check";
    case "idle":
    case "up-to-date":
      return "check";
  }
}

/** Whether there is something new for the user to act on. */
export function hasPendingUpdate(state: UpdateState | null): boolean {
  if (!state) return false;
  const action = resolveUpdateAction(state);
  return action === "download" || action === "install";
}
