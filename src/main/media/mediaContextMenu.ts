import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { BrowserWindow, clipboard, dialog, Menu, shell } from "electron";

/*
 * Media context menus are native UI, so they live in the main process. The
 * renderer sends only a media ID over IPC; by the time this module receives
 * a file path, the media service has already resolved it from the current scan.
 */

const execFileAsync = promisify(execFile);

// macOS supports placing real file URLs on the clipboard through AppKit. Electron
// exposes a simple text clipboard API, but copying a file as a Finder item needs
// this small JavaScript-for-Automation bridge.
const copyFileToClipboardScript = `
ObjC.import("AppKit");

function run(argv) {
  const pboard = $.NSPasteboard.generalPasteboard;
  const urls = $.NSMutableArray.alloc.init;
  urls.addObject($.NSURL.fileURLWithPath(argv[0]));

  pboard.clearContents;
  if (!pboard.writeObjects(urls)) {
    throw new Error("Could not place the file on the clipboard.");
  }
}
`;

async function copyFileToClipboard(filePath: string): Promise<void> {
  if (process.platform === "linux") {
    const uriList = `${pathToFileURL(filePath).href}\r\n`;
    clipboard.writeBuffer("text/uri-list", Buffer.from(uriList, "utf8"));
    return;
  }

  if (process.platform === "darwin") {
    // Electron can write text to the clipboard directly; file promises on macOS
    // need AppKit. execFile avoids invoking a shell with the path.
    await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", copyFileToClipboardScript, filePath]);
    return;
  }

  throw new Error("Copying files to the clipboard is not supported on this platform.");
}

// Context-menu actions happen outside React, so failures need a native dialog
// instead of renderer state.
function showMenuActionError(window: BrowserWindow, title: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  void dialog.showMessageBox(window, {
    type: "error",
    title,
    message: title,
    detail,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0
  });
}

export function showLocalMediaContextMenu(window: BrowserWindow, filePath: string): void {
  const canCopyFile = process.platform === "darwin" || process.platform === "linux";
  // Menu.popup anchors the native context menu to the BrowserWindow that invoked
  // it, preserving focus and modality expectations on macOS.
  const menu = Menu.buildFromTemplate([
    {
      label: process.platform === "darwin" ? "Open in Finder" : "Show in Folder",
      click: () => shell.showItemInFolder(filePath)
    },
    { type: "separator" },
    {
      label: canCopyFile ? "Copy File" : "Copy File (unsupported)",
      enabled: canCopyFile,
      click: () => {
        void copyFileToClipboard(filePath).catch((error: unknown) => showMenuActionError(window, "Copy File Failed", error));
      }
    },
    {
      label: "Copy Path",
      click: () => clipboard.writeText(filePath)
    }
  ]);
  menu.popup({ window });
}

export function showRemoteMediaContextMenu(
  window: BrowserWindow,
  mediaUrl: string,
  download: () => Promise<void>
): void {
  const menu = Menu.buildFromTemplate([
    {
      label: "Download File",
      click: () => {
        void download().catch((error: unknown) =>
          showMenuActionError(window, "Download Failed", error)
        );
      }
    },
    {
      label: "Copy Media URL",
      click: () => clipboard.writeText(mediaUrl)
    }
  ]);
  menu.popup({ window });
}
