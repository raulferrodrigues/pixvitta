/*
 * This is the public settings boundary for main-process callers.
 *
 * The tiny surface is intentional: callers can read settings, save settings, and
 * share the AppSettings type. They should not know about the JSON store, the
 * lazy load promise, the userData path, or renderer broadcast mechanics.
 *
 * Re-exporting from settingsFeature.ts also evaluates that module, which is how
 * the settings feature registers its own IPC channels when "../settings" is
 * imported.
 */
export { getSettings, saveSettings } from "./settingsFeature";
export type { AppSettings } from "../../shared/settings";
