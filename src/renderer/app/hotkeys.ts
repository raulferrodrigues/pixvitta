type ModifierId = "cmd" | "shift" | "option" | "ctrl";
type AcceleratorModifier = "CommandOrControl" | "Shift" | "Alt" | "Control";

type RendererModifier = {
  id: ModifierId;
  accelerator: AcceleratorModifier;
  isPressed(event: KeyboardEvent): boolean;
};

type RendererHotkey = {
  accelerator: string;
  key: string;
  keys: readonly string[];
  modifiers: readonly RendererModifier[];
};

type HotkeyDefinition = {
  modifiers: readonly RendererModifier[];
  key: string;
  aliases?: readonly string[];
};

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function modifier(id: ModifierId, accelerator: AcceleratorModifier, isPressed: (event: KeyboardEvent) => boolean) {
  return { id, accelerator, isPressed } as const satisfies RendererModifier;
}

function hotkey(definition: HotkeyDefinition): RendererHotkey {
  const aliases = definition.aliases ?? [];
  return {
    accelerator: [...definition.modifiers.map((item) => item.accelerator), definition.key].join("+"),
    key: definition.key,
    keys: [definition.key, ...aliases],
    modifiers: definition.modifiers
  };
}

const CMD = modifier("cmd", "CommandOrControl", (event) => (isApplePlatform() ? event.metaKey : event.ctrlKey));

export const RENDERER_HOTKEYS = {
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
  return hotkey.keys.includes(event.key) && matchesModifiers(event, hotkey);
}
