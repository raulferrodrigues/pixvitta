import type { PixvittaCommand } from "./pixvittaApi";

// The fields of a key press both Electron's Input and a DOM KeyboardEvent can
// supply.
export type ViewerKeyInput = { key: string; meta: boolean; control: boolean; alt: boolean };

// Viewer keys that main takes before the page sees them: the arrows step
// through media, and J, K and L seek and play video. Arrows go with any
// modifier; J, K and L only bare or with Shift. While a text field has focus
// they stay with the page instead, so they edit text there.
export function viewerKeyCommand(input: ViewerKeyInput): PixvittaCommand | null {
  if (input.key === "ArrowLeft") return "previous-media";
  if (input.key === "ArrowRight") return "next-media";
  if (input.meta || input.control || input.alt) return null;
  const key = input.key.toLowerCase();
  if (key === "j") return "seek-video-backward";
  if (key === "l") return "seek-video-forward";
  if (key === "k") return "toggle-video-playback";
  return null;
}
