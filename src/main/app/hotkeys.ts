/*
 * Main-process callers import hotkeys through "../app" with the rest of the app
 * shell helpers. The canonical table lives in shared because low-level window
 * hooks and renderer tests need the same accelerator strings.
 */
export { MAIN_HOTKEYS } from "../../shared/hotkeys";
