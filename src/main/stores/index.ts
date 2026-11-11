/*
 * Public persistence surface for main-process features.
 *
 * Stores expose plain read/save verbs. Store classes, JSON file names, lazy load
 * promises, and userData paths stay hidden behind stores.ts.
 */
export {
  getRecentSources,
  getSavedMix,
  getSettings,
  pinSavedMix,
  removeRecentSource,
  removeSavedMix,
  renameSavedMix,
  saveMix,
  saveRecentSource,
  saveSettings
} from "./stores";
