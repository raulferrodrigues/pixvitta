import { Keyboard, X } from "lucide-react";
import { useGT } from "gt-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MAIN_HOTKEYS } from "../../shared/hotkeys";
import { formatAccelerator, isApplePlatform, RENDERER_HOTKEYS } from "../app/hotkeys";
import { VIDEO_SEEK_SECONDS } from "../app/useAppLifecycle";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { IconButton } from "../ui/IconButton";

// Each combo is one way to trigger the action; a row lists alternatives.
type ShortcutRow = { label: string; combos: string[][] };
type ShortcutSection = { title: string; rows: ShortcutRow[] };

function useShortcutSections(): ShortcutSection[] {
  const gt = useGT();
  const keys = formatAccelerator;
  const ctrl = isApplePlatform() ? "⌃" : "Ctrl";
  return [
    {
      title: gt("Navigation"),
      rows: [
        { label: gt("Previous media"), combos: [["←"]] },
        { label: gt("Next media"), combos: [["→"]] }
      ]
    },
    {
      title: gt("Viewing"),
      rows: [
        { label: gt("Zoom in"), combos: [keys(RENDERER_HOTKEYS.imageZoomIn.accelerator)] },
        { label: gt("Zoom out"), combos: [keys(RENDERER_HOTKEYS.imageZoomOut.accelerator)] },
        { label: gt("Zoom at pointer"), combos: [[gt("Pinch")], [ctrl, gt("Scroll")]] },
        { label: gt("Pan zoomed image"), combos: [[gt("Drag")], [gt("Scroll")]] },
        { label: gt("Toggle fullscreen"), combos: [["F"]] },
        { label: gt("Exit fullscreen"), combos: [["Esc"]] }
      ]
    },
    {
      title: gt("Continuous view"),
      rows: [
        { label: gt("Scroll"), combos: [["↑"], ["↓"]] },
        { label: gt("Scroll a page"), combos: [["Page Up"], ["Page Down"], [gt("Space")]] },
        { label: gt("Scroll back a page"), combos: [["⇧", gt("Space")]] },
        { label: gt("Jump to start or end"), combos: [["Home"], ["End"]] },
        { label: gt("Widen or narrow column"), combos: [keys(RENDERER_HOTKEYS.imageZoomIn.accelerator), keys(RENDERER_HOTKEYS.imageZoomOut.accelerator)] }
      ]
    },
    {
      title: gt("Video"),
      rows: [
        { label: gt("Play or pause"), combos: [[gt("Space")], ["K"]] },
        { label: gt("Back {seconds} seconds", { seconds: VIDEO_SEEK_SECONDS }), combos: [["J"]] },
        { label: gt("Forward {seconds} seconds", { seconds: VIDEO_SEEK_SECONDS }), combos: [["L"]] }
      ]
    },
    {
      title: gt("Library"),
      rows: [
        { label: gt("Open folder"), combos: [keys(MAIN_HOTKEYS.openFolder)] },
        { label: gt("Refresh source"), combos: [keys(MAIN_HOTKEYS.refreshSource)] },
        { label: gt("Download current media"), combos: [keys(RENDERER_HOTKEYS.downloadCurrentMedia.accelerator)] }
      ]
    },
    {
      title: gt("App"),
      rows: [
        { label: gt("Settings"), combos: [keys(MAIN_HOTKEYS.preferences)] },
        { label: gt("Close window"), combos: [keys(MAIN_HOTKEYS.closeWindow)] },
        { label: gt("Interface zoom in"), combos: [keys(MAIN_HOTKEYS.appZoomIn)] },
        { label: gt("Interface zoom out"), combos: [keys(MAIN_HOTKEYS.appZoomOut)] },
        { label: gt("Interface actual size"), combos: [keys(MAIN_HOTKEYS.appActualSize)] },
        { label: gt("Show keyboard shortcuts"), combos: [["?"]] }
      ]
    }
  ];
}

function KeyCombo({ combo }: { combo: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {combo.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-pix-control-border bg-pix-control px-1.5 font-sans text-xs leading-none text-pix-text"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsSheet({ className }: { className?: string }) {
  const gt = useGT();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const isOpen = useViewerStore((state) => state.isShortcutsSheetOpen);
  const setOpen = useViewerStore((state) => state.setShortcutsSheetOpen);
  const sections = useShortcutSections();

  // The store owns open state so the button, the "?" key, and the Help menu
  // all drive the same dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <>
      <IconButton
        label={gt("Keyboard shortcuts")}
        aria-pressed={isOpen}
        className={className}
        data-testid="shortcuts-sheet-toggle"
        onClick={() => setOpen(!isOpen)}
      >
        <Keyboard size={17} aria-hidden />
      </IconButton>
      {createPortal(
        <dialog
          ref={dialogRef}
          className="m-auto max-h-[calc(100vh-48px)] w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-xl border border-pix-border bg-pix-bg p-0 text-pix-text shadow-2xl backdrop:bg-black/70"
          aria-labelledby="shortcuts-sheet-title"
          data-testid="shortcuts-sheet"
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="grid max-h-[calc(100vh-48px)] grid-rows-[auto_1fr] gap-4 p-5">
            <header className="flex items-center justify-between gap-4">
              <h2 id="shortcuts-sheet-title" className="m-0 text-lg font-semibold text-pix-heading">
                {gt("Keyboard shortcuts")}
              </h2>
              <IconButton label={gt("Close")} onClick={() => setOpen(false)}>
                <X size={17} aria-hidden />
              </IconButton>
            </header>
            <div className="grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto sm:grid-cols-2">
              {sections.map((section) => (
                <section key={section.title} className="grid content-start gap-2">
                  <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-pix-muted">{section.title}</h3>
                  <dl className="m-0 grid gap-1.5">
                    {section.rows.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                        <dt>{row.label}</dt>
                        <dd className="m-0 flex flex-wrap items-center justify-end gap-1.5 text-xs text-pix-muted">
                          {row.combos.map((combo, index) => (
                            <span key={combo.join("+")} className="inline-flex items-center gap-1.5">
                              {index > 0 ? <span aria-hidden>/</span> : null}
                              <KeyCombo combo={combo} />
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </dialog>,
        document.body
      )}
    </>
  );
}
