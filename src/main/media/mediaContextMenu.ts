import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { BrowserWindow, clipboard, ClipboardItem, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import type { MediaKind } from "../../shared/media";
import { encodeImageAsPng } from "./clipboardImage";

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
    // Chromium and Qt apps read text/uri-list; GTK file managers (Nautilus,
    // Nemo, Caja, Thunar) only paste files from x-special/gnome-copied-files.
    const fileUrl = pathToFileURL(filePath).href;
    await clipboard.write([
      new ClipboardItem({
        "text/uri-list": `${fileUrl}\r\n`,
        'electron application/osclipboard;format="x-special/gnome-copied-files"': new Blob([`copy\n${fileUrl}`])
      })
    ]);
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

// Copies image data only, like a browser's Copy Image. Chat apps such as
// Discord paste this, but fail to paste anything when the clipboard also lists
// files, which is why Copy File and Copy Image are separate actions.
async function copyImageToClipboard(window: BrowserWindow, filePath: string): Promise<void> {
  const png = await encodeImageAsPng(window.webContents, filePath);
  if (!png) throw new Error("Only images can be copied as image data.");
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
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

const canCopyFile = process.platform === "darwin" || process.platform === "linux";

// Copy Image and Copy File take the media's local file, which remote media
// only has after it is fetched, so both receive a function that provides it.
function copyItems(
  window: BrowserWindow,
  kind: MediaKind,
  getFilePath: () => Promise<string>
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  if (kind === "image") {
    items.push({
      label: "Copy Image",
      click: () => {
        void getFilePath()
          .then((filePath) => copyImageToClipboard(window, filePath))
          .catch((error: unknown) => showMenuActionError(window, "Copy Image Failed", error));
      }
    });
  }
  items.push({
    label: canCopyFile ? "Copy File" : "Copy File (unsupported)",
    enabled: canCopyFile,
    click: () => {
      void getFilePath()
        .then(copyFileToClipboard)
        .catch((error: unknown) => showMenuActionError(window, "Copy File Failed", error));
    }
  });
  return items;
}

export type RemoteMediaActions = {
  download(): void;
  // Resolves to a local copy of the media, fetched through its provider.
  saveFile(): Promise<string>;
  getMediaUrl?: () => Promise<string>;
};

export function showLocalMediaContextMenu(window: BrowserWindow, filePath: string, kind: MediaKind): void {
  // Menu.popup anchors the native context menu to the BrowserWindow that invoked
  // it, preserving focus and modality expectations on macOS.
  const menu = Menu.buildFromTemplate([
    {
      label: process.platform === "darwin" ? "Open in Finder" : "Show in Folder",
      click: () => shell.showItemInFolder(filePath)
    },
    { type: "separator" },
    ...copyItems(window, kind, () => Promise.resolve(filePath)),
    {
      label: "Copy Path",
      click: () => {
        void clipboard.writeText(filePath).catch((error: unknown) => showMenuActionError(window, "Copy Path Failed", error));
      }
    }
  ]);
  menu.popup({ window });
}

export function showRemoteMediaContextMenu(window: BrowserWindow, kind: MediaKind, actions: RemoteMediaActions): void {
  const { getMediaUrl } = actions;
  const menu = Menu.buildFromTemplate([
    {
      label: "Download File",
      click: () => {
        try {
          actions.download();
        } catch (error) {
          showMenuActionError(window, "Download Failed", error);
        }
      }
    },
    { type: "separator" },
    ...copyItems(window, kind, actions.saveFile),
    ...(getMediaUrl
      ? [{
          label: "Copy Media URL",
          click: () => {
            void getMediaUrl()
              .then((mediaUrl) => clipboard.writeText(mediaUrl))
              .catch((error: unknown) => showMenuActionError(window, "Copy URL Failed", error));
          }
        }]
      : [])
  ]);
  menu.popup({ window });
}
