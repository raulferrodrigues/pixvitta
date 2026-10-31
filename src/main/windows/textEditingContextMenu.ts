import { BrowserWindow, Menu } from "electron";

/**
 * Electron does not create Chromium's text-editing context menu automatically.
 * Install one native menu per window and let Electron roles target whichever
 * input, textarea, or contenteditable element invoked it.
 */
export function installTextEditingContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) return;

    const flags = params.editFlags;
    const menu = Menu.buildFromTemplate([
      { role: "undo", enabled: flags.canUndo },
      { role: "redo", enabled: flags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: flags.canCut },
      { role: "copy", enabled: flags.canCopy },
      { role: "paste", enabled: flags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: flags.canSelectAll }
    ]);
    menu.popup({ window });
  });
}
