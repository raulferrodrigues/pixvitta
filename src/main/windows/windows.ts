import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type {
  DownloadActivitySnapshot,
  MediaCollection,
  OpenSourceError
} from "../../shared/media";
import type { PixvittaCommand } from "../../shared/pixvittaApi";
import type { RecentSource } from "../../shared/recentSources";
import { rendererUrl } from "../app";
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
 * Pixvitta has one native window, the main viewer. Settings and the keyboard
 * shortcuts are drawn by React as a modal inside it. The BrowserWindow
 * construction details live in mainWindow.ts; this file owns the live
 * reference and the policy around it.
 *
 * A few Electron handlers are registered at import time. That is deliberate:
 * importing "../windows" means the windows feature is present, including its
 * renderer readiness IPC and app-wide window-close policy. Callers should invoke
 * capabilities such as createMainWindow(), not
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

type PendingCollectionDelivery = {
  collection: MediaCollection;
  onDelivered(): void;
};

// Authoritative library events can arrive before the main window exists, while
// it is loading, or before React has registered its listeners. Collection
// changes remain queued until both renderer readiness gates are open.
const pendingCollectionDeliveries: PendingCollectionDelivery[] = [];
let pendingLoadingState: boolean | null = null;
let pendingSourceError: OpenSourceError | null = null;

function flushMainWindowEvents(): void {
  // The renderer only gets library events after two conditions are true:
  // BrowserWindow.loadURL has completed and React has called viewer:ready from
  // preload. Sending before either point risks dropping the IPC message.
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindowLoaded || !mainWindowReady) return;

  if (pendingLoadingState !== null) {
    mainWindow.webContents.send(
      "library:loading-changed",
      pendingLoadingState
    );
    pendingLoadingState = null;
  }
  if (pendingSourceError !== null) {
    mainWindow.webContents.send("library:source-error", pendingSourceError);
    pendingSourceError = null;
  }
  while (pendingCollectionDeliveries.length > 0) {
    const delivery = pendingCollectionDeliveries.shift()!;
    mainWindow.webContents.send(
      "library:collection-changed",
      delivery.collection
    );
    delivery.onDelivered();
  }
  mainWindow.focus();
}

export function createMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    flushMainWindowEvents();
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
      flushMainWindowEvents();
    },
    onCloseShortcut: closeAppWindow
  });

  mainWindow = window;
}

export function publishMainWindowCollection(
  collection: MediaCollection,
  onDelivered: () => void
): void {
  pendingCollectionDeliveries.push({ collection, onDelivered });
  flushMainWindowEvents();
}

export function publishMainWindowLoading(isLoading: boolean): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindowLoaded &&
    mainWindowReady
  ) {
    mainWindow.webContents.send("library:loading-changed", isLoading);
    return;
  }
  pendingLoadingState = isLoading;
}

export function publishMainWindowSourceError(error: OpenSourceError): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindowLoaded &&
    mainWindowReady
  ) {
    mainWindow.webContents.send("library:source-error", error);
    return;
  }
  pendingSourceError = error;
}

export function publishMainWindowDownloadActivity(
  snapshot: DownloadActivitySnapshot
): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindowLoaded &&
    mainWindowReady
  ) {
    mainWindow.webContents.send(
      "media:download-activity-changed",
      snapshot
    );
  }
}

export function publishMainWindowRecentSources(
  sources: RecentSource[]
): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindowLoaded &&
    mainWindowReady
  ) {
    mainWindow.webContents.send("recent-sources:changed", sources);
  }
}

export function isMainWindow(window: BrowserWindow | null): boolean {
  return !!window && window === mainWindow && !window.isDestroyed();
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

  if (window === mainWindow) {
    // The main viewer is the primary document surface. Closing it is equivalent
    // to quitting Pixvitta, even on macOS where many apps stay resident after
    // closing all windows.
    app.quit();
    return;
  }

  // Unknown BrowserWindows are not owned by Pixvitta's window feature. If one
  // reaches this helper from a menu event, close it normally rather than trying
  // to apply main-window policy.
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
  flushMainWindowEvents();
});

// Window-close policy belongs with the windows feature. The rest of the app
// should not ask whether a close event should quit; it should just let this
// module own the native BrowserWindow rules.
app.on("window-all-closed", () => {
  if (SHOULD_KEEP_OPEN_AFTER_LAST_WINDOW_CLOSED) return;
  app.quit();
});
