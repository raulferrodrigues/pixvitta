// Importing thumbnailer in Electron starts the private runtime: protocol
// handlers, IPC helpers, and quit cleanup. Plain unit tests can import the same
// public API without loading Electron because process.versions.electron is not
// set there.
if (process.versions.electron) {
  void import("./thumbnailerRuntime.js");
}

export { getThumbnail } from "./thumbnailer";
export type { Thumbnail, ThumbnailFile } from "./thumbnailer";
