// Key names between the browser and 3DMigoto: a pressed key or pad button as an ini token ("VK_F6", "XB_A"), and an
// ini binding as people read it ("ctrl alt VK_J" -> "Ctrl+Alt+J"). The Rust side (keys.rs) checks and writes the
// binding; this only turns presses into tokens. Owner: KEYBINDS area.

export type Modifier = "ctrl" | "alt" | "shift" | "windows";

/** KeyboardEvent.code of the modifier keys. */
export const MODIFIER_OF: Record<string, Modifier> = {
  ControlLeft: "ctrl", ControlRight: "ctrl", AltLeft: "alt", AltRight: "alt",
  ShiftLeft: "shift", ShiftRight: "shift", MetaLeft: "windows", MetaRight: "windows",
};

const NAMED: Record<string, string> = {
  ArrowUp: "VK_UP", ArrowDown: "VK_DOWN", ArrowLeft: "VK_LEFT", ArrowRight: "VK_RIGHT",
  Space: "VK_SPACE", Enter: "VK_RETURN", NumpadEnter: "VK_RETURN", Tab: "VK_TAB", Backspace: "VK_BACK",
  Delete: "VK_DELETE", Insert: "VK_INSERT", Home: "VK_HOME", End: "VK_END", PageUp: "VK_PRIOR", PageDown: "VK_NEXT",
  CapsLock: "VK_CAPITAL", Pause: "VK_PAUSE", ScrollLock: "VK_SCROLL", PrintScreen: "VK_SNAPSHOT", NumLock: "VK_NUMLOCK",
  ContextMenu: "VK_APPS", Escape: "VK_ESCAPE",
  NumpadMultiply: "VK_MULTIPLY", NumpadAdd: "VK_ADD", NumpadSubtract: "VK_SUBTRACT", NumpadDecimal: "VK_DECIMAL",
  NumpadDivide: "VK_DIVIDE",
  Semicolon: "VK_OEM_1", Equal: "VK_OEM_PLUS", Comma: "VK_OEM_COMMA", Minus: "VK_OEM_MINUS", Period: "VK_OEM_PERIOD",
  Slash: "VK_OEM_2", Backquote: "VK_OEM_3", BracketLeft: "VK_OEM_4", Backslash: "VK_OEM_5", BracketRight: "VK_OEM_6",
  Quote: "VK_OEM_7", IntlBackslash: "VK_OEM_102",
};

const MODIFIER_KEY: Record<string, Modifier> = { Control: "ctrl", Alt: "alt", Shift: "shift", Meta: "windows", OS: "windows" };

/** The modifier a key event is for, if any. */
export function modifierOf(e: { code: string; key: string }): Modifier | undefined {
  return MODIFIER_OF[e.code] ?? MODIFIER_KEY[e.key];
}

/** The modifiers held during an event. */
export function heldOf(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): Modifier[] {
  return [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "windows"].filter((m): m is Modifier => !!m);
}

/** The 3DMigoto token for a key event: by its code, so the keyboard layout doesn't matter, else by its key. */
export function tokenOf(e: { code: string; key: string }): string | null {
  if (e.code) return tokenOfCode(e.code);
  const k = e.key;
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  return tokenOfCode(/^F\d{1,2}$/.test(k) ? k : k === " " ? "Space" : k);
}

/** The 3DMigoto token for a key (by KeyboardEvent.code), or null. */
export function tokenOfCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!;
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1]!;
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `VK_NUMPAD${m[1]}`;
  m = /^F(\d{1,2})$/.exec(code);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `VK_F${m[1]}`;
  return NAMED[code] ?? null;
}

/** Mouse buttons by MouseEvent.button. Left and right count only with a modifier held. */
export const MOUSE_TOKEN: Record<number, string> = { 0: "VK_LBUTTON", 1: "VK_MBUTTON", 2: "VK_RBUTTON", 3: "VK_XBUTTON1", 4: "VK_XBUTTON2" };

/** Standard gamepad button index -> XInput name as 3DMigoto writes it. */
export const PAD_TOKEN: Record<number, string> = {
  0: "XB_A", 1: "XB_B", 2: "XB_X", 3: "XB_Y", 4: "XB_LEFT_SHOULDER", 5: "XB_RIGHT_SHOULDER", 6: "XB_LEFT_TRIGGER",
  7: "XB_RIGHT_TRIGGER", 8: "XB_BACK", 9: "XB_START", 10: "XB_LEFT_THUMB", 11: "XB_RIGHT_THUMB", 12: "XB_DPAD_UP",
  13: "XB_DPAD_DOWN", 14: "XB_DPAD_LEFT", 15: "XB_DPAD_RIGHT", 16: "XB_GUIDE",
};

const PAD_LABEL: Record<string, string> = {
  LEFT_TRIGGER: "LT", RIGHT_TRIGGER: "RT", LEFT_SHOULDER: "LB", RIGHT_SHOULDER: "RB", LEFT_THUMB: "LS", RIGHT_THUMB: "RS",
  DPAD_UP: "Up", DPAD_DOWN: "Down", DPAD_LEFT: "Left", DPAD_RIGHT: "Right", START: "Start", BACK: "Back", GUIDE: "Guide",
};

const KEY_LABEL: Record<string, string> = {
  UP: "Up", DOWN: "Down", LEFT: "Left", RIGHT: "Right", SPACE: "Space", RETURN: "Enter", TAB: "Tab", BACK: "Backspace",
  DELETE: "Del", INSERT: "Ins", HOME: "Home", END: "End", PRIOR: "Page Up", NEXT: "Page Down", CAPITAL: "Caps Lock",
  PAUSE: "Pause", SCROLL: "Scroll Lock", SNAPSHOT: "Print Screen", NUMLOCK: "Num Lock", APPS: "Menu key", ESCAPE: "Esc",
  MULTIPLY: "Num *", ADD: "Num +", SUBTRACT: "Num -", DECIMAL: "Num .", DIVIDE: "Num /",
  OEM_1: ";", OEM_PLUS: "=", OEM_COMMA: ",", OEM_MINUS: "-", OEM_PERIOD: ".", OEM_2: "/", OEM_3: "`", OEM_4: "[",
  OEM_5: "\\", OEM_6: "]", OEM_7: "'", OEM_102: "\\",
  LBUTTON: "Left click", RBUTTON: "Right click", MBUTTON: "Middle click", XBUTTON1: "Mouse 4", XBUTTON2: "Mouse 5",
};

/** "VK_UP" -> "Up", "XB_LEFT_SHOULDER" -> "Pad LB", "VK_NUMPAD1" -> "Num 1". */
export function tokenLabel(token: string): string {
  const up = token.trim().toUpperCase();
  const pad = /^XB\d?_(.+)$/.exec(up);
  if (pad) return `Pad ${PAD_LABEL[pad[1]!] ?? pad[1]!}`;
  const name = up.replace(/^VK_/, "");
  if (name.length === 1) return name;
  const num = /^NUMPAD(\d)$/.exec(name);
  if (num) return `Num ${num[1]}`;
  if (/^F\d{1,2}$/.test(name)) return name;
  return KEY_LABEL[name] ?? name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, " ");
}

/** A binding as people read it: "ctrl alt VK_J" -> "Ctrl+Alt+J", guards left out. */
export function bindingLabel(binding: string): string {
  const held = new Set<string>();
  const keys: string[] = [];
  for (const t of binding.split(/\s+/).filter(Boolean)) {
    const l = t.toLowerCase();
    if (l === "ctrl" || l === "alt" || l === "shift" || l === "windows") held.add(l);
    else if (!l.startsWith("no_")) keys.push(tokenLabel(t));
  }
  const mods = (["ctrl", "alt", "shift", "windows"] as const).filter((m) => held.has(m)).map((m) => (m === "windows" ? "Win" : m[0]!.toUpperCase() + m.slice(1)));
  return [...mods, ...keys].join("+");
}

/** A readable key for matching a description's keys against an ini's: "Pad LB+RB+B" and "Pad LB+Pad RB+Pad B" are
 *  the same, so are "Numpad 1" and "Num 1". */
export function sameKeys(label: string): string {
  return label.toLowerCase().replace(/numpad/g, "num").replace(/\bpad\b/g, "").replace(/\s+/g, "");
}
