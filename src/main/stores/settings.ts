import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultSettings, type AppSettings, type FileOrder, type MediaScaleMode } from "../../shared/settings";

/*
 * Settings are plain JSON on disk, owned by the main process. The renderer can
 * request and save settings through IPC, but it never reads this file directly.
 * That keeps filesystem access in one place and lets this module sanitize old or
 * malformed settings before the UI uses them.
 */

// Stored values can outlive the code that wrote them. This normalizer accepts
// the current values plus a few legacy names, then maps everything to today's
// settings shape.
function normalizeFileOrder(value: unknown): FileOrder | null {
  if (value === "none") return "name";
  if (
    value === "name" ||
    value === "kind" ||
    value === "last-opened" ||
    value === "date-added" ||
    value === "modified" ||
    value === "created" ||
    value === "size" ||
    value === "random"
  ) {
    return value;
  }
  if (value === "name-asc" || value === "name-desc") return "name";
  if (value === "modified-newest" || value === "modified-oldest") return "modified";
  return null;
}

function isMediaScaleMode(value: unknown): value is MediaScaleMode {
  return value === "native-or-smaller" || value === "fit-window";
}

// Treat settings loaded from disk, or received over IPC, as untrusted input. The
// renderer gets back a complete AppSettings object even if the JSON file was
// manually edited or came from an older Pixvitta build.
export function sanitizeSettings(value: unknown): AppSettings {
  const raw = value && typeof value === "object" ? (value as Partial<AppSettings>) : {};
  return {
    videoAutoplay: typeof raw.videoAutoplay === "boolean" ? raw.videoAutoplay : defaultSettings.videoAutoplay,
    videoLoopByDefault:
      typeof raw.videoLoopByDefault === "boolean" ? raw.videoLoopByDefault : defaultSettings.videoLoopByDefault,
    fileOrder: normalizeFileOrder(raw.fileOrder) ?? defaultSettings.fileOrder,
    wrapNavigation: typeof raw.wrapNavigation === "boolean" ? raw.wrapNavigation : defaultSettings.wrapNavigation,
    includeHidden: typeof raw.includeHidden === "boolean" ? raw.includeHidden : defaultSettings.includeHidden,
    showVideoControls:
      typeof raw.showVideoControls === "boolean" ? raw.showVideoControls : defaultSettings.showVideoControls,
    unobtrusiveViewerControls:
      typeof raw.unobtrusiveViewerControls === "boolean"
        ? raw.unobtrusiveViewerControls
        : defaultSettings.unobtrusiveViewerControls,
    mediaScaleMode: isMediaScaleMode(raw.mediaScaleMode)
      ? raw.mediaScaleMode
      : isMediaScaleMode((raw as { videoScaleMode?: unknown }).videoScaleMode)
        ? (raw as { videoScaleMode: MediaScaleMode }).videoScaleMode
        : defaultSettings.mediaScaleMode
  };
}

export class SettingsStore {
  private settings: AppSettings = defaultSettings;

  constructor(private readonly settingsPath: string) {}

  // Loading failure is not fatal. A missing, unreadable, or invalid settings file
  // simply means the app starts with defaults.
  async load(): Promise<AppSettings> {
    try {
      const contents = await readFile(this.settingsPath, "utf8");
      this.settings = sanitizeSettings(JSON.parse(contents));
    } catch {
      this.settings = defaultSettings;
    }
    return this.settings;
  }

  // Callers get the already-sanitized in-memory snapshot. Disk I/O happens only
  // on load/save, not every time React needs current settings.
  get(): AppSettings {
    return this.settings;
  }

  // Save sanitizes again because IPC input is just data from another process.
  // The JSON is formatted for easy manual inspection while debugging.
  async save(nextSettings: AppSettings): Promise<AppSettings> {
    this.settings = sanitizeSettings(nextSettings);
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify(this.settings, null, 2)}\n`);
    return this.settings;
  }
}
