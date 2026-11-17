import { useGT } from "gt-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { PrimaryButton } from "../../ui/PrimaryButton";

// Main's question before an open from inside the app replaces a mix, however
// the open started: a folder, a web address, a recent source or mix, or the
// menu. Enter
// replaces and Escape keeps the mix. Mounted once by the app; as a modal
// dialog it sits above any other open dialog, such as the web source one.
export function ReplaceConfirmationDialog() {
  const gt = useGT();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const replaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmation = useViewerStore((state) => state.replaceConfirmation);
  const answerReplace = useViewerStore((state) => state.answerReplace);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!confirmation) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    replaceButtonRef.current?.focus();
  }, [confirmation]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-xl border border-pix-border bg-pix-bg p-0 text-pix-text shadow-2xl backdrop:bg-black/60"
      aria-labelledby="replace-confirmation-title"
      aria-describedby="replace-confirmation-message"
      data-testid="replace-confirmation"
      // Escape, or the dialog closing any other way, keeps the mix.
      onClose={() => answerReplace(false)}
    >
      {confirmation ? (
        <div className="grid gap-4 p-5">
          <h2 id="replace-confirmation-title" className="m-0 text-base font-semibold text-pix-heading">
            {gt("Replace the mix?")}
          </h2>
          <p id="replace-confirmation-message" className="m-0 text-sm leading-relaxed text-pix-muted">
            {gt("This closes {title}, a mix of {count} sources.", {
              title: confirmation.title,
              count: confirmation.sourceCount
            })}{" "}
            {/* Main says whether the mix is saved: it needs two sources recents keep. */}
            {confirmation.saved
              ? gt("It stays in your recent sources, so you can open it again.")
              : gt("It is not saved, so it cannot be opened again.")}
          </p>
          <div className="flex justify-end gap-2">
            <PrimaryButton
              type="button"
              className="min-h-9 border-transparent bg-transparent px-3 font-normal text-pix-muted hover:text-pix-text"
              data-testid="keep-mix"
              onClick={() => answerReplace(false)}
            >
              {gt("Keep the mix")}
            </PrimaryButton>
            <PrimaryButton
              ref={replaceButtonRef}
              type="button"
              className="min-h-9 px-3"
              data-testid="replace-mix"
              onClick={() => answerReplace(true)}
            >
              {gt("Replace")}
            </PrimaryButton>
          </div>
        </div>
      ) : null}
    </dialog>,
    document.body
  );
}
