/*
 * Generic IPC still has one public entry point because these handlers are the
 * remaining cross-feature renderer channels. Feature-owned channels live inside
 * their feature modules instead of growing this file.
 */
export { registerIpcHandlers } from "./ipcHandlers";
