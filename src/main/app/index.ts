/*
 * Small app-shell helpers that are not a feature by themselves.
 *
 * Keeping this barrel explicit prevents other modules from reaching into
 * appUrl.ts, dialogResponses.ts, or hotkeys.ts just because those files happen
 * to exist. If a helper is meant for another main-process module, it appears
 * here; otherwise it stays private to this folder.
 */
export { rendererUrl } from "./appUrl";
export { parseDialogResponses } from "./dialogResponses";
export { MAIN_HOTKEYS } from "./hotkeys";
