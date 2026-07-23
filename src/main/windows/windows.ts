import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { MediaCollection } from "../../shared/media";
import type { PixvittaCommand } from "../../shared/pixvittaApi";
import { rendererUrl } from "../app";
import { createPreferencesBrowserWindow } from "./preferencesWindow";
import { createMainWindow as createMainBrowserWindow } from "./mainWindow";
import { notifyWindowChromeChanged } from "./windowChrome";

/*
 * Windows are a main-process feature, not an object main.ts should assemble.
 *
 * This module owns the live BrowserWindow references and exposes only app-level
 * window capabilities. Other features, like the app menu or update dialogs, can
 * import these operations directly without receiving a custom "window manager"
 * bag from the entry point.
 *
 * There are two native windows in Pixvitta today:
 * - the main window, which displays the media viewer route;
 * - the preferences window, which displays the settings route.
 *
 * They intentionally share one boundary because some behavior is cross-window:
 * the app menu can close whichever Pixvitta window is focused, closing the main
 * window should quit the app, and closing a preferences-only window should not
 * accidentally make the app feel like the viewer quit. The construction details
 * for each BrowserWindow still live in focused files; this file owns the live
 * references and the policy around them.
 *
 * A few Electron handlers are registered at import time. That is deliberate:
 * importing "../windows" means the windows feature is present, including its
 * renderer readiness IPC and app-wide window-close policy. Callers should invoke
 * capabilities such as createMainWindow() and createPreferencesWindow(), not
 * remember a separate "register window handlers" step.
 */

export type WindowMenuCommand = PixvittaCommand;

// Pixvitta currently behaves like a document-style viewer: if all normal
// windows are closed, the app quits. Keeping this as an explicit policy constant
// makes a future macOS-style "stay resident with no windows" change local to
// this module instead of scattering that decision through main.ts.
const SHOULD_KEEP_OPEN_AFTER_LAST_WINDOW_CLOSED = false;

// App zoom controls change Chromium page zoom for the focused native window.
// Keeping the step here means menu labels and accelerators do not own window
// rendering policy.
const WINDOW_ZOOM_STEP = 0.5;

// BrowserWindow references are kept private so outside modules cannot mutate
// native window state directly. They ask for app-level operations instead.
let mainWindow: BrowserWindow | null = null;

// loadURL finishing is not the same as React being ready to receive app events.
// Both gates are tracked separately before queued folders are sent to renderer.
let mainWindowLoaded = false;
let mainWindowReady = false;

let preferencesWindow: BrowserWindow | null = null;

// Closing the preferences window when it is the only open window triggers
// Electron's window-all-closed event. That event should be ignored once so the
// user does not quit the whole app just by closing settings.
let skipNextWindowAllClosedQuit = false;

// Folders can arrive before the main window exists, while it is loading, or
// before React has registered its file-open listener. The queue lets callers say
// "show this folder in the main window" without learning any of that timing.
const pendingMainWindowCollections: MediaCollection[] = [];

function flushMainWindowFolders(): void {
  // The renderer only gets folder deliveries after two conditions are true:
  // BrowserWindow.loadURL has completed and React has called viewer:ready from
  // preload. Sending before either point risks dropping the IPC message.
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindowLoaded || !mainWindowReady) return;

  while (pendingMainWindowCollections.length > 0) {
    mainWindow.webContents.send("file:opened", pendingMainWindowCollections.shift()!);
  }
  mainWindow.focus();
}

export function createMainWindow(collection?: MediaCollection): void {
  // The optional folder is the high-level "show this opened folder" command.
  // Delivery timing remains private to this module; callers do not need a
  // separate "wait until viewer ready" API.
  if (collection) pendingMainWindowCollections.push(collection);

  if (mainWindow && !mainWindow.isDestroyed()) {
    flushMainWindowFolders();
    mainWindow.focus();
    return;
  }

  // A newly-created BrowserWindow starts with both readiness gates closed. The
  // load gate opens when loadURL resolves inside createViewerWindow; the React
  // gate opens through the viewer:ready IPC handler below.
  mainWindowLoaded = false;
  mainWindowReady = false;
  const window = createMainBrowserWindow({
    rendererUrl,
    onClosed(closedWindow) {
      if (mainWindow !== closedWindow) return;
      mainWindow = null;
      mainWindowLoaded = false;
      mainWindowReady = false;
    },
    onLoaded(loadedWindow) {
      if (mainWindow !== loadedWindow || loadedWindow.isDestroyed()) return;
      mainWindowLoaded = true;
      flushMainWindowFolders();
    },
    onCloseShortcut: closeAppWindow,
    onOpenPreferences: createPreferencesWindow
  });

  mainWindow = window;
}

export function createPreferencesWindow(): void {
  // Preferences are single-instance. Reusing the existing native window matches
  // macOS settings-window expectations and avoids duplicate settings screens
  // racing to save the same JSON-backed settings.
  if (preferencesWindow && !preferencesWindow.isDestroyed()) {
    preferencesWindow.focus();
    return;
  }

  preferencesWindow = createPreferencesBrowserWindow({
    rendererUrl,
    onClosed() {
      preferencesWindow = null;
    },
    onCloseShortcut() {
      closeAppWindow(preferencesWindow);
    }
  });
}

export async function showAppMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  // Dialog parenting is a native-window detail. Callers ask the app to show a
  // message, while this module decides whether the main viewer can own it.
  if (mainWindow && !mainWindow.isDestroyed()) {
    return dialog.showMessageBox(mainWindow, options);
  }
  return dialog.showMessageBox(options);
}

export function closeAppWindow(window: BrowserWindow | null | undefined): void {
  if (!window || window.isDestroyed()) return;

  if (window === preferencesWindow) {
    // If preferences is the last window, Electron will emit window-all-closed
    // after close(). Mark the next event as intentional so the app stays alive
    // instead of treating a settings close as a viewer close.
    const hasOtherWindows = BrowserWindow.getAllWindows().some((openWindow) => openWindow !== window && !openWindow.isDestroyed());
    skipNextWindowAllClosedQuit = !hasOtherWindows;
    window.close();
    return;
  }

  if (window === mainWindow) {
    // The main viewer is the primary document surface. Closing it is equivalent
    // to quitting Pixvitta, even on macOS where many apps stay resident after
    // closing all windows.
    app.quit();
    return;
  }

  // Unknown BrowserWindows are not owned by Pixvitta's window feature. If one
  // reaches this helper from a menu event, close it normally rather than trying
  // to apply main/preference-specific policy.
  window.close();
}

export function sendMenuCommand(command: WindowMenuCommand): void {
  // Native menu items are outside React, but many commands should reuse the
  // viewer's existing toolbar/store flows. A tiny command message keeps that
  // bridge narrow and avoids moving folder UI state into main.
  mainWindow?.webContents.send("menu:command", command);
}

function adjustFocusedWindowZoom(delta: number): void {
  // Zoom is native Chromium webContents state. The renderer can display the
  // current value, but the main process changes it because BrowserWindow is the
  // source of truth.
  const window = BrowserWindow.getFocusedWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.setZoomLevel(window.webContents.getZoomLevel() + delta);
  notifyWindowChromeChanged(window);
}

export function zoomFocusedWindowIn(): void {
  adjustFocusedWindowZoom(WINDOW_ZOOM_STEP);
}

export function zoomFocusedWindowOut(): void {
  adjustFocusedWindowZoom(-WINDOW_ZOOM_STEP);
}

export function resetFocusedWindowZoom(): void {
  // Resetting zoom is the same native operation as zooming in/out. After
  // changing it, notify the renderer so custom chrome stays accurate.
  const window = BrowserWindow.getFocusedWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.setZoomLevel(0);
  notifyWindowChromeChanged(window);
}

ipcMain.handle("viewer:ready", (event) => {
  // The page load event only says the bundle loaded. viewer:ready says React has
  // mounted and registered the file-open listener exposed by preload.
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== mainWindow) return;
  mainWindowReady = true;
  flushMainWindowFolders();
});

// Window-close policy belongs with the windows feature. The rest of the app
// should not ask whether a close event should quit; it should just let this
// module own the native BrowserWindow rules.
app.on("window-all-closed", () => {
  if (skipNextWindowAllClosedQuit) {
    skipNextWindowAllClosedQuit = false;
    return;
  }

  if (SHOULD_KEEP_OPEN_AFTER_LAST_WINDOW_CLOSED) return;
  app.quit();
});
