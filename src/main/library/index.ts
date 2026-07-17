/*
 * This is the public library/session boundary for the main process.
 *
 * The implementation deliberately stays behind librarySession.ts. Callers get a
 * tiny set of app-level operations: open a folder, treat an opened file as its
 * containing folder, rescan, and read recent folders. They should not know about
 * dialog parenting, recent-folder persistence, settings lookups, or media scan
 * details.
 *
 * Keeping this barrel small also makes the import side effect clear. Importing
 * "../library" evaluates librarySession.ts, which registers the library IPC
 * channels owned by that feature.
 */
export { getRecentFolders, openFileAsFolder, openFolder, openRecentFolder, removeRecentFolder, rescanFolder } from "./librarySession";
