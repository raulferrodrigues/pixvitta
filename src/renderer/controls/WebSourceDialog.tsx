import { Globe2, X } from "lucide-react";
import { useGT } from "gt-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LocationPicker } from "../folder-picker/LocationPicker";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { IconButton } from "../ui/IconButton";
import { PrimaryButton } from "../ui/PrimaryButton";

export function WebSourceDialog({
  trigger = "icon"
}: {
  trigger?: "icon" | "button";
}) {
  const gt = useGT();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const sourceIdWhenOpenedRef = useRef<string | null>(null);
  const sourceId = useViewerStore((state) => state.source?.id ?? null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (
      dialog?.open &&
      sourceIdWhenOpenedRef.current !== sourceId
    ) {
      dialog.close();
    }
  }, [sourceId]);

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    sourceIdWhenOpenedRef.current = sourceId;
    dialog.showModal();
    window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  return (
    <>
      {trigger === "icon" ? (
        <IconButton
          label={gt("Open from the web")}
          data-testid="open-web-source"
          onClick={openDialog}
        >
          <Globe2 size={17} aria-hidden />
        </IconButton>
      ) : (
        <PrimaryButton onClick={openDialog}>
          <Globe2 size={18} aria-hidden />
          <span>{gt("Open from the web")}</span>
        </PrimaryButton>
      )}
      {createPortal(
        <dialog
          ref={dialogRef}
          className="m-auto w-[min(600px,calc(100vw-32px))] rounded-xl border border-pix-border bg-pix-bg p-0 text-pix-text shadow-2xl backdrop:bg-black/70"
          aria-labelledby="web-source-dialog-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              event.currentTarget.close();
            }
          }}
        >
          <div className="grid gap-5 p-5">
            <header className="flex items-center justify-between gap-4">
              <h2
                id="web-source-dialog-title"
                className="m-0 text-lg font-semibold text-pix-heading"
              >
                {gt("Open from the web")}
              </h2>
              <IconButton
                label={gt("Close")}
                onClick={() => dialogRef.current?.close()}
              >
                <X size={17} aria-hidden />
              </IconButton>
            </header>
            <LocationPicker showHeading={false} />
          </div>
        </dialog>,
        document.body
      )}
    </>
  );
}
