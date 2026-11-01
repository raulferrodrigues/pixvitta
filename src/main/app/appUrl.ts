import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

/*
 * BrowserWindow.loadURL needs a real URL in both development and packaged
 * builds. This helper hides the difference so window creation can simply ask
 * for the renderer page.
 */

export function rendererUrl(): string {
  // Development loads Vite directly so renderer edits refresh quickly and HMR
  // works like a normal React app.
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }

  // Packaged builds load the compiled renderer from the app bundle. pathToFileURL
  // handles spaces and platform path separators correctly.
  return pathToFileURL(path.join(app.getAppPath(), "dist", "index.html")).toString();
}
