type ModifierId = "cmd" | "shift" | "option" | "ctrl";
type AcceleratorModifier = "CommandOrControl" | "Shift" | "Alt" | "Control";

type RendererModifier = {
  id: ModifierId;
  accelerator: AcceleratorModifier;
  isPressed(event: KeyboardEvent): boolean;
};

type RendererHotkey = {
  accelerator: string;
  code?: string;
  key: string;
  keys: readonly string[];
  modifiers: readonly RendererModifier[];
};

type HotkeyDefinition = {
  modifiers: readonly RendererModifier[];
  key: string;
  code?: string;
  aliases?: readonly string[];
};

export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function modifier(id: ModifierId, accelerator: AcceleratorModifier, isPressed: (event: KeyboardEvent) => boolean) {
  return { id, accelerator, isPressed } as const satisfies RendererModifier;
}

function hotkey(definition: HotkeyDefinition): RendererHotkey {
  const aliases = definition.aliases ?? [];
  return {
    accelerator: [...definition.modifiers.map((item) => item.accelerator), definition.key].join("+"),
    code: definition.code,
    key: definition.key,
    keys: [definition.key, ...aliases],
    modifiers: definition.modifiers
  };
}

const CMD = modifier("cmd", "CommandOrControl", (event) => (isApplePlatform() ? event.metaKey : event.ctrlKey));

export const RENDERER_HOTKEYS = {
  downloadCurrentMedia: hotkey({ modifiers: [], key: "0", code: "Numpad0" }),
  imageZoomIn: hotkey({ modifiers: [CMD], key: "=", aliases: ["+"] }),
  imageZoomOut: hotkey({ modifiers: [CMD], key: "-", aliases: ["_"] })
} as const;

function expectsModifier(hotkey: RendererHotkey, modifierId: ModifierId): boolean {
  return hotkey.modifiers.some((item) => item.id === modifierId);
}

function matchesModifiers(event: KeyboardEvent, hotkey: RendererHotkey): boolean {
  const expectsCmd = expectsModifier(hotkey, "cmd");
  const expectsShift = expectsModifier(hotkey, "shift");
  const expectsOption = expectsModifier(hotkey, "option");
  const expectsCtrl = expectsModifier(hotkey, "ctrl");

  return (
    hotkey.modifiers.every((item) => item.isPressed(event)) &&
    event.metaKey === (expectsCmd && isApplePlatform()) &&
    event.ctrlKey === (expectsCtrl || (expectsCmd && !isApplePlatform())) &&
    event.shiftKey === expectsShift &&
    event.altKey === expectsOption
  );
}

export function matchesRendererHotkey(event: KeyboardEvent, hotkey: RendererHotkey): boolean {
  const matchesKey = hotkey.code
    ? event.code === hotkey.code
    : hotkey.keys.includes(event.key);
  return matchesKey && matchesModifiers(event, hotkey);
}

// Opening the cheat sheet takes "?" however the layout produces it, so Shift
// is allowed but app modifiers are not.
export function isShortcutsSheetKey(event: KeyboardEvent): boolean {
  return event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey;
}

const MAC_MODIFIER_LABELS: Record<string, string> = {
  CommandOrControl: "⌘",
  Control: "⌃",
  Shift: "⇧",
  Alt: "⌥"
};

const OTHER_MODIFIER_LABELS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Control: "Ctrl",
  Shift: "Shift",
  Alt: "Alt"
};

// Splits an Electron-style accelerator into the key caps shown to the user,
// with modifier names matching the current platform.
export function formatAccelerator(accelerator: string): string[] {
  const modifierLabels = isApplePlatform() ? MAC_MODIFIER_LABELS : OTHER_MODIFIER_LABELS;
  return accelerator.split("+").map((part) => modifierLabels[part] ?? (part.length === 1 ? part.toUpperCase() : part));
}
