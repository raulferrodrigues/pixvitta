import type { PixvittaApi, PixvittaCommand } from "../../shared/pixvittaApi";
import { viewerKeyCommand } from "../../shared/viewerKeys";
import { isTextEntryTarget } from "./hotkeys";

/*
 * Main takes the viewer keys (arrows, J, K, L) before the page sees them, so
 * focused native video controls cannot reinterpret them. While a text field
 * has focus it must leave them to the page, so they type and move the caret.
 * Main cannot ask the page what has focus, so the page tells it on every
 * change, and once on start.
 *
 * Should main's view go stale anyway, for instance if focus left a field
 * without a focusout, a viewer key reaches the page outside any field. The
 * page then does what main would have done and corrects main, so the keys
 * never stop working.
 */
export function watchTextEntryFocus(
  api: PixvittaApi,
  runCommand: (command: PixvittaCommand) => void
): () => void {
  let reported: boolean | null = null;
  const report = (focused: boolean) => {
    if (focused === reported) return;
    reported = focused;
    api.setTextEntryFocused(focused);
  };

  const onFocusIn = (event: FocusEvent) => report(isTextEntryTarget(event.target));
  // The element taking focus, or null when focus leaves the page or the
  // window, in which case its focusin reports it.
  const onFocusOut = (event: FocusEvent) => report(isTextEntryTarget(event.relatedTarget));
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTextEntryTarget(event.target)) return;
    const command = viewerKeyCommand({ key: event.key, meta: event.metaKey, control: event.ctrlKey, alt: event.altKey });
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    report(isTextEntryTarget(document.activeElement));
    runCommand(command);
  };

  report(isTextEntryTarget(document.activeElement));
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  // Capture, so the key is handled before it reaches focused video controls.
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
