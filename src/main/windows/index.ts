/*
 * Public windows surface.
 *
 * Callers get app-level window commands, not BrowserWindow references. The live
 * native windows, readiness queue, close policy, and chrome notifications stay
 * inside windows.ts.
 */
export {
  closeAppWindow,
  createMainWindow,
  createPreferencesWindow,
  resetFocusedWindowZoom,
  sendMenuCommand,
  showAppMessageBox,
  zoomFocusedWindowIn,
  zoomFocusedWindowOut
} from "./windows";
export type { WindowMenuCommand } from "./windows";
