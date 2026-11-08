import { useGT } from "gt-react";
import { useEffect, useRef } from "react";
import { resolveUpdateAction, type UpdateState } from "../../../shared/updates";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { classNames } from "../../ui/classNames";

type Translate = ReturnType<typeof useGT>;

// One row, like T3 Code's About row: the version, what the updater is doing,
// and one button for the next step, from checking through restarting.
export function UpdateRow() {
  const gt = useGT();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const updateState = useViewerStore((state) => state.updateState);
  const isRevealed = useViewerStore((state) => state.settingsView === "updates");
  const checkForUpdates = useViewerStore((state) => state.checkForUpdates);
  const downloadUpdate = useViewerStore((state) => state.downloadUpdate);
  const installUpdate = useViewerStore((state) => state.installUpdate);
  const hasState = updateState !== null;

  // "Check for Updates..." in the app menu opens Settings at this row. Child
  // effects run before the modal's, so wait a frame for it to call showModal;
  // a closed dialog has no layout to scroll.
  useEffect(() => {
    if (!isRevealed) return;
    const frame = requestAnimationFrame(() => rowRef.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [isRevealed, hasState]);

  if (!updateState) return null;

  const action = resolveUpdateAction(updateState);
  const onClick = () => {
    if (action === "check") void checkForUpdates();
    if (action === "download") void downloadUpdate();
    if (action === "install") void installUpdate();
  };

  return (
    <div
      ref={rowRef}
      className="grid min-h-14 scroll-mb-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5"
      data-testid="update-row"
      data-status={updateState.status}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id="update-row-label" className="flex items-baseline gap-2 text-sm text-pix-text">
          {gt("Version")}
          <code className="text-xs text-pix-muted" data-testid="update-current-version">{updateState.currentVersion}</code>
          {updateState.channel === "nightly" ? (
            <span className="rounded border border-pix-border px-1.5 text-[11px] uppercase tracking-wide text-pix-section">
              {gt("Nightly")}
            </span>
          ) : null}
        </span>
        <span
          id="update-row-description"
          className={classNames("text-xs", updateState.status === "error" ? "text-pix-text" : "text-pix-muted")}
          role={updateState.status === "error" ? "alert" : undefined}
          data-testid="update-description"
        >
          {describe(gt, updateState)}
        </span>
        {updateState.status === "downloading" ? (
          <div
            className="mt-1 h-1 overflow-hidden rounded-full bg-pix-control-muted"
            role="progressbar"
            aria-label={gt("Download progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(updateState.downloadPercent ?? 0)}
          >
            <div className="h-full bg-pix-accent transition-[width]" style={{ width: `${updateState.downloadPercent ?? 0}%` }} />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={classNames(
          "inline-flex min-h-8 cursor-pointer items-center rounded-lg border px-3 text-sm [font:inherit] disabled:cursor-default disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent",
          action === "download" || action === "install"
            ? "border-pix-accent/60 bg-pix-accent/15 text-pix-text hover:bg-pix-accent/25"
            : "border-pix-control-border bg-pix-control text-pix-text hover:bg-pix-panel-hover"
        )}
        aria-describedby="update-row-description"
        data-testid="update-button"
        data-action={action}
        disabled={action === "none"}
        onClick={onClick}
      >
        {buttonLabel(gt, updateState)}
      </button>
    </div>
  );
}

function buttonLabel(gt: Translate, state: UpdateState): string {
  if (state.status === "checking") return gt("Checking...");
  if (state.status === "downloading") return gt("Downloading...");
  const action = resolveUpdateAction(state);
  if (action === "download") return gt("Download");
  if (action === "install") return gt("Restart to update");
  return gt("Check for updates");
}

function describe(gt: Translate, state: UpdateState): string {
  const available = state.availableVersion ?? "";
  const downloaded = state.downloadedVersion ?? available;
  const reason = state.message ?? "";
  switch (state.status) {
    case "unavailable":
      if (state.unavailableReason === "unsigned-macos") return gt("Updates are not available on macOS yet.");
      if (state.unavailableReason === "unsupported-linux-package") {
        return gt("This package can't update itself. Install the AppImage or Debian package to get updates.");
      }
      return gt("Updates are only available in packaged builds.");
    case "idle":
      return state.channel === "nightly" ? gt("Following Nightly releases.") : gt("Following stable releases.");
    case "checking":
      return gt("Checking for updates...");
    case "up-to-date":
      return gt("You're up to date.");
    case "available":
      return gt("Version {version} is available.", { version: available });
    case "downloading":
      return gt("Downloading version {version} ({percent}%)", {
        version: available,
        percent: Math.floor(state.downloadPercent ?? 0)
      });
    case "downloaded":
      return gt("Version {version} is ready. Restart to finish, or it installs when you quit.", { version: downloaded });
    case "error":
      if (state.errorContext === "download") return gt("Couldn't download version {version}: {reason}", { version: available, reason });
      if (state.errorContext === "install") return gt("Couldn't install version {version}: {reason}", { version: downloaded, reason });
      return gt("Couldn't check for updates: {reason}", { reason });
  }
}
