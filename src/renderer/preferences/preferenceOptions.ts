import type { AppSettings } from "../../shared/settings";
import { FILE_ORDER_OPTIONS } from "../settings/fileOrderOptions";

type CheckboxSettingKey = "videoAutoplay" | "videoLoopByDefault" | "showVideoControls" | "wrapNavigation" | "includeHidden";
type SelectSettingKey = "mediaScaleMode" | "fileOrder";

export type CheckboxPreferenceRow = {
  kind: "checkbox";
  setting: CheckboxSettingKey;
  testId: string;
  label: string;
  description: string;
};

export type SelectPreferenceRow = {
  [Key in SelectSettingKey]: {
    kind: "select";
    setting: Key;
    testId: string;
    label: string;
    description: string;
    options: ReadonlyArray<{ value: AppSettings[Key]; label: string }>;
  };
}[SelectSettingKey];

export type PreferenceRow = CheckboxPreferenceRow | SelectPreferenceRow;
export type PreferenceSection = { label: string; rows: PreferenceRow[] };

export const preferenceSections = [
  {
    label: "Playback",
    rows: [
      { kind: "checkbox", setting: "videoAutoplay", testId: "setting-video-autoplay", label: "Autoplay videos", description: "Start playback when a video becomes current." },
      { kind: "checkbox", setting: "videoLoopByDefault", testId: "setting-video-loop-default", label: "Loop videos by default", description: "Start video media with looping enabled." },
      { kind: "checkbox", setting: "showVideoControls", testId: "setting-video-controls", label: "Show native video controls", description: "Keep the browser video controls visible." },
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
      { kind: "checkbox", setting: "wrapNavigation", testId: "setting-wrap-navigation", label: "Wrap at folder ends", description: "Continue from last to first, and first to last." },
      { kind: "checkbox", setting: "includeHidden", testId: "setting-include-hidden", label: "Include hidden files", description: "Show supported dotfiles in the current folder." }
    ]
  }
] satisfies PreferenceSection[];
