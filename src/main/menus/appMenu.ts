import { app, BrowserWindow, Menu } from "electron";
import { MAIN_HOTKEYS } from "../app";
import { checkForUpdates } from "../updates";
import {
  closeAppWindow,
  createPreferencesWindow,
  resetFocusedWindowZoom,
  sendMenuCommand,
  type WindowMenuCommand,
  zoomFocusedWindowIn,
  zoomFocusedWindowOut
} from "../windows";

/*
 * Electron menus are real native application menus, not React components. On
 * macOS that means the menu bar at the top of the screen belongs to the app even
 * when focus moves between windows. This module wires those native menu items to
 * either BrowserWindow actions or small messages the renderer already knows how
 * to handle.
 *
 * The menu imports the app capabilities it commands instead of accepting an
 * options object from main.ts. That keeps the public menu surface honest:
 * creating the menu is one app-shell action, not a pile of wiring.
 */

function sendViewerCommand(command: WindowMenuCommand): void {
  sendMenuCommand(command);
}

export function createAppMenu(): void {
  // Menu.buildFromTemplate turns this plain object tree into native menu items.
  // Roles like "about", "quit", and "togglefullscreen" let Electron provide the
  // platform-correct behavior and labels.
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: "preferences",
          label: "Settings...",
          accelerator: MAIN_HOTKEYS.preferences,
          // Settings are native-window state, so this menu item calls directly
          // into the main process instead of asking React first.
          click: () => createPreferencesWindow()
        },
        {
          id: "check-for-updates",
          label: "Check for Updates...",
          click: () => {
            void checkForUpdates();
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          id: "close-window",
          label: "Close Window",
          accelerator: MAIN_HOTKEYS.closeWindow,
          // The clicked window argument is sometimes absent depending on focus,
          // so fall back to Electron's focused-window lookup.
          click: (_menuItem, window) =>
            closeAppWindow(window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow())
        },
        { type: "separator" },
        {
          label: "Open Folder...",
          accelerator: MAIN_HOTKEYS.openFolder,
          // Folder state lives in the renderer store, but the menu is native.
          // A command event lets the viewer reuse the same flow as its toolbar.
          click: () => sendViewerCommand("open-folder")
        },
        {
          label: "Rescan Folder",
          accelerator: MAIN_HOTKEYS.rescanFolder,
          click: () => sendViewerCommand("rescan-folder")
        }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          id: "app-reset-zoom",
          label: "Actual Size",
          accelerator: MAIN_HOTKEYS.appActualSize,
          // These are app zoom controls, not image zoom controls. They change
          // Chromium's page zoom for the focused BrowserWindow.
          click: () => resetFocusedWindowZoom()
        },
        {
          id: "app-zoom-in",
          label: "Zoom In",
          accelerator: MAIN_HOTKEYS.appZoomIn,
          click: () => zoomFocusedWindowIn()
        },
        {
          id: "app-zoom-out",
          label: "Zoom Out",
          accelerator: MAIN_HOTKEYS.appZoomOut,
          click: () => zoomFocusedWindowOut()
        },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      id: "window-menu",
      label: "Window",
      role: "windowMenu"
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
