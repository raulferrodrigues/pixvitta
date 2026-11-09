import type { AppSettings } from "../../../shared/settings";
import { FILE_ORDER_OPTIONS } from "../../settings/fileOrderOptions";

type SwitchSettingKey = "videoAutoplay" | "videoLoopByDefault" | "showVideoControls" | "wrapNavigation" | "includeHidden" | "glowEffects";
type SelectSettingKey = "viewerLayout" | "mediaScaleMode" | "fileOrder";

export type SwitchSettingRow = {
  kind: "switch";
  setting: SwitchSettingKey;
  testId: string;
  label: string;
  description: string;
};

export type SelectSettingRow = {
  [Key in SelectSettingKey]: {
    kind: "select";
    setting: Key;
    testId: string;
    label: string;
    description: string;
    options: ReadonlyArray<{ value: AppSettings[Key]; label: string }>;
  };
}[SelectSettingKey];

export type SettingRow = SwitchSettingRow | SelectSettingRow;
export type SettingSection = { label: string; rows: SettingRow[] };

// Labels are English source strings; the rows translate them when rendering.
export const settingSections = [
  {
    label: "Viewer",
    rows: [
      {
        kind: "select",
        setting: "viewerLayout",
        testId: "setting-viewer-layout",
        label: "Layout",
        description: "Choose how controls are arranged around the media.",
        options: [
          { value: "classic", label: "Classic" },
          { value: "immersive", label: "Immersive" }
        ]
      },
      { kind: "switch", setting: "glowEffects", testId: "setting-glow-effects", label: "Glow effects", description: "Add a soft accent glow to highlights and the start screen." }
    ]
  },
  {
    label: "Playback",
    rows: [
      { kind: "switch", setting: "videoAutoplay", testId: "setting-video-autoplay", label: "Autoplay videos", description: "Start playback when a video becomes current." },
      { kind: "switch", setting: "videoLoopByDefault", testId: "setting-video-loop-default", label: "Loop videos by default", description: "Start video media with looping enabled." },
      { kind: "switch", setting: "showVideoControls", testId: "setting-video-controls", label: "Show native video controls", description: "Keep the browser video controls visible." },
      {
        kind: "select",
        setting: "mediaScaleMode",
        testId: "setting-media-scale-mode",
        label: "Media size",
        description: "Controls how images, GIFs, and videos fit the viewer.",
        options: [
          { value: "native-or-smaller", label: "Native or smaller" },
          { value: "fit-window", label: "Fit window" }
        ]
      }
    ]
  },
  {
    label: "Navigation",
    rows: [
      { kind: "select", setting: "fileOrder", testId: "setting-file-order", label: "File order", description: "Choose how files are sorted in the viewer.", options: FILE_ORDER_OPTIONS },
      { kind: "switch", setting: "wrapNavigation", testId: "setting-wrap-navigation", label: "Wrap at folder ends", description: "Continue from last to first, and first to last." },
      { kind: "switch", setting: "includeHidden", testId: "setting-include-hidden", label: "Include hidden files", description: "Show supported dotfiles in the current folder." }
    ]
  }
] satisfies SettingSection[];
