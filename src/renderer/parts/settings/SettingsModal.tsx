import { ArrowLeft, Keyboard, Settings, X } from "lucide-react";
import { useGT } from "gt-react";
import { useEffect, useRef } from "react";
import { hasPendingUpdate } from "../../../shared/updates";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { IconButton } from "../../ui/IconButton";
import { SettingsList } from "./SettingsList";
import { ShortcutsList } from "./ShortcutsList";
import "./settings.css";

export function SettingsToggle() {
  const gt = useGT();
  const isOpen = useViewerStore((state) => state.settingsView !== null);
  const openSettings = useViewerStore((state) => state.openSettings);
  const closeSettings = useViewerStore((state) => state.closeSettings);
  // A found or downloaded update waits on the button in Settings, so the gear
  // carries a dot until it is handled.
  const updatePending = useViewerStore((state) => hasPendingUpdate(state.updateState));
  return (
    <IconButton
      label={updatePending ? gt("Settings, update available") : gt("Settings")}
      aria-pressed={isOpen}
      className="settings-toggle relative"
      data-testid="settings-toggle"
      data-update-pending={updatePending || undefined}
      onClick={() => (isOpen ? closeSettings() : openSettings(updatePending ? "updates" : "settings"))}
    >
      <Settings size={17} aria-hidden />
      {updatePending ? (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-pix-accent ring-2 ring-pix-bg" aria-hidden />
      ) : null}
    </IconButton>
  );
}

// Mounted once by the app, outside the layouts. The store owns which view is
// open, so the layout buttons, Cmd/Ctrl+, the "?" key, and the app menus all
// drive this one dialog. The shortcuts view replaces the settings list inside
// the same dialog rather than stacking a second one.
export function SettingsModal() {
  const gt = useGT();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headerButtonRef = useRef<HTMLButtonElement | null>(null);
  // A click only dismisses when it also started on the backdrop, so a text
  // selection or drag that ends outside the panel keeps it open.
  const backdropPressRef = useRef(false);
  const view = useViewerStore((state) => state.settingsView);
  const openSettings = useViewerStore((state) => state.openSettings);
  const closeSettings = useViewerStore((state) => state.closeSettings);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!view) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      // Focus the panel rather than its first control, so opening with a
      // shortcut does not paint a focus ring on the header button.
      dialog.focus();
      return;
    }
    // Switching views swaps the header button, so keep focus on it instead of
    // letting it fall back to the dialog.
    headerButtonRef.current?.focus();
  }, [view]);

  const isShortcuts = view === "shortcuts";
  const title = isShortcuts ? gt("Keyboard shortcuts") : gt("Settings");

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-xl border border-pix-border bg-pix-bg p-0 text-pix-text shadow-2xl outline-none backdrop:bg-black/70"
      tabIndex={-1}
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
      data-view={view ?? undefined}
      onClose={closeSettings}
      onPointerDown={(event) => {
        backdropPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPressRef.current && event.target === event.currentTarget) closeSettings();
        backdropPressRef.current = false;
      }}
    >
      <div className="flex max-h-[min(900px,88vh)] flex-col">
        <header className="flex items-center gap-2 border-b border-pix-border px-4 py-3">
          {isShortcuts ? (
            <IconButton
              ref={headerButtonRef}
              label={gt("Back to settings")}
              data-testid="settings-modal-back"
              onClick={() => openSettings("settings")}
            >
              <ArrowLeft size={17} aria-hidden />
            </IconButton>
          ) : null}
          <h2 id="settings-modal-title" className="m-0 flex-1 text-base font-semibold text-pix-heading">
            {title}
          </h2>
          {isShortcuts ? null : (
            <button
              ref={headerButtonRef}
              type="button"
              className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-pix-border bg-pix-control-muted px-3 text-sm text-pix-muted [font:inherit] hover:text-pix-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent"
              data-testid="settings-modal-shortcuts"
              onClick={() => openSettings("shortcuts")}
            >
              <Keyboard size={16} aria-hidden />
              {gt("Keyboard shortcuts")}
            </button>
          )}
          <IconButton label={gt("Close")} onClick={closeSettings}>
            <X size={17} aria-hidden />
          </IconButton>
        </header>
        <div className="settings-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-gutter:stable]">
          {isShortcuts ? <ShortcutsList /> : view ? <SettingsList /> : null}
        </div>
      </div>
    </dialog>
  );
}
