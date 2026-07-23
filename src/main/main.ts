import { app, BrowserWindow } from "electron";
import { configureAppIdentity } from "./app/buildInfo";
import { createAppMenu } from "./menus";
import { registerIpcHandlers } from "./ipc";
import { openFileAsFolder } from "./library";
import { startAutomaticUpdates } from "./updates";
import { createMainWindow, createPreferencesWindow } from "./windows";

function fileArguments(argv: string[]): string[] {
  const start = app.isPackaged ? 1 : 2;
  return argv.slice(start).filter((argument) => argument.length > 0 && !argument.startsWith("-"));
}

async function openFileArgument(argv: string[]): Promise<boolean> {
  for (const filePath of fileArguments(argv)) {
    const folder = await openFileAsFolder(filePath);
    if (folder) {
      createMainWindow(folder);
      return true;
    }
  }
  return false;
}

/*
 * This file is the Electron main process entry point. If you come from regular
 * web development, this is the "server-side" half of the desktop app: it owns
 * real operating-system access, creates browser windows, talks to the file
 * system, builds native menus, and decides what the renderer is allowed to do.
 *
 * The React app in the renderer should feel like normal browser code. It does
 * not get Node.js globals or raw filesystem paths. Instead, it asks this main
 * process for work through IPC, and this file answers with plain data or custom
 * app URLs that Chromium can load safely.
 */

// Configure product naming and per-flavor storage before taking Electron's
// single-instance lock. This lets stable and development builds run together
// without sharing settings, recent folders, thumbnails, or process locks.
configureAppIdentity();

// IPC handlers are registered before app readiness because they do not touch
// BrowserWindow state directly. The handlers receive dependencies as callbacks
// and services, which keeps the channel definitions testable and avoids making
// ipcHandlers.ts import this whole entry point.
registerIpcHandlers({
  createPreferencesWindow
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    void app.whenReady().then(() => openFileArgument(argv)).then((opened) => {
      if (!opened && BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

// macOS sends this when the user double-clicks an associated image/video file
// in Finder or chooses "Open With Pixvitta". preventDefault tells Electron that
// we handled the open request ourselves.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void app
    .whenReady()
    .then(() => openFileAsFolder(filePath))
    .then((folder) => {
      if (folder) createMainWindow(folder);
    })
    .catch((error: unknown) => console.error(error));
});

// app.whenReady is the point where Electron has initialized native APIs. Anything
// that relies on OS integration, such as protocol handlers and windows, starts
// here instead of at module load time.
void app.whenReady().then(async () => {
  // Menus are global/native in Electron. Creating the application menu here
  // wires macOS menu items to either native actions or renderer commands.
  createAppMenu();

  if (!(await openFileArgument(process.argv))) createMainWindow();
  startAutomaticUpdates();

  // macOS keeps apps open after their windows close. When the dock icon is
  // clicked again, activate should recreate the viewer window.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
});
