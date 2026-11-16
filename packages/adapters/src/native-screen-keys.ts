/**
 * Key names computer tools send (X11 keysyms and common aliases) translated to Windows virtual-key
 * codes. Printing a character uses a Unicode scan code instead, so a key types the character the
 * caller asked for even on a layout that puts it somewhere else.
 */

export type WindowsKeyStroke =
  | { kind: "vk"; vk: number; extended: boolean; up: boolean }
  | { kind: "unicode"; code: number; up: boolean };

/** Keys that only work with KEYEVENTF_EXTENDEDKEY: arrows, navigation, and the right-hand keys. */
const EXTENDED = new Set([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b, 0x5c, 0x5d, 0x90, 0xa3, 0xa5,
]);

const MODIFIER_VK: Record<string, number> = {
  ctrl: 0x11,
  control: 0x11,
  control_l: 0xa2,
  control_r: 0xa3,
  shift: 0x10,
  shift_l: 0xa0,
  shift_r: 0xa1,
  alt: 0x12,
  alt_l: 0xa4,
  alt_r: 0xa5,
  option: 0x12,
  super: 0x5b,
  super_l: 0x5b,
  super_r: 0x5c,
  meta: 0x5b,
  win: 0x5b,
  cmd: 0x5b,
  command: 0x5b,
};

const NAMED_VK: Record<string, number> = {
  return: 0x0d,
  enter: 0x0d,
  kp_enter: 0x0d,
  backspace: 0x08,
  tab: 0x09,
  escape: 0x1b,
  esc: 0x1b,
  space: 0x20,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  ins: 0x2d,
  home: 0x24,
  end: 0x23,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  prior: 0x21,
  page_up: 0x21,
  pageup: 0x21,
  next: 0x22,
  page_down: 0x22,
  pagedown: 0x22,
  caps_lock: 0x14,
  capslock: 0x14,
  num_lock: 0x90,
  numlock: 0x90,
  scroll_lock: 0x91,
  print: 0x2c,
  print_screen: 0x2c,
  printscreen: 0x2c,
  pause: 0x13,
  menu: 0x5d,
  context_menu: 0x5d,
};

/** A punctuation key's virtual-key code, for chords like Ctrl+/ where a Unicode scan code is wrong. */
const PUNCTUATION_VK: Record<string, number> = {
  ";": 0xba,
  ":": 0xba,
  "=": 0xbb,
  "+": 0xbb,
  ",": 0xbc,
  "<": 0xbc,
  "-": 0xbd,
  _: 0xbd,
  ".": 0xbe,
  ">": 0xbe,
  "/": 0xbf,
  "?": 0xbf,
  "`": 0xc0,
  "~": 0xc0,
  "[": 0xdb,
  "{": 0xdb,
  "\\": 0xdc,
  "|": 0xdc,
  "]": 0xdd,
  "}": 0xdd,
  "'": 0xde,
  '"': 0xde,
};

/** True for one printable character, which an application should receive as text, not a key. */
export function isPrintableText(value: string): boolean {
  const code = value.codePointAt(0);
  return (
    value.length > 0 &&
    [...value].length === 1 &&
    code !== undefined &&
    code >= 0x20 &&
    code !== 0x7f
  );
}

function virtualKey(name: string): number | undefined {
  const lower = name.toLowerCase();
  const named = NAMED_VK[lower] ?? MODIFIER_VK[lower];
  if (named !== undefined) return named;
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (fn) return 0x70 + Number(fn[1]) - 1;
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(lower)) return lower.charCodeAt(0);
  const printed = lower.length === 1 ? PUNCTUATION_VK[name] : undefined;
  if (printed !== undefined) return printed;
  return undefined;
}

function vkStroke(vk: number, up: boolean): WindowsKeyStroke {
  return { kind: "vk", vk, extended: EXTENDED.has(vk), up };
}

/**
 * One key press as the strokes that produce it. Modifiers are held around the key and released in
 * reverse order, so a chord never leaves a modifier stuck down. Keys also arrive as `ctrl+a`.
 */
export function windowsKeyStrokes(
  key: string,
  modifiers: readonly string[] = [],
): WindowsKeyStroke[] {
  const parts = [...modifiers, ...(key.length > 1 ? key.split("+") : [key])]
    .map((part) => part.trim())
    .filter(Boolean);
  const main = parts.pop();
  if (!main) throw new Error("No key to press");
  const held = parts.map((part) => {
    const vk = MODIFIER_VK[part.toLowerCase()];
    if (vk === undefined) throw new Error(`Unknown modifier key: ${part}`);
    return vk;
  });
  if (held.length) {
    // A chord is a shortcut, so the printable character's own key code is what it needs.
    const vk = virtualKey(main);
    if (vk === undefined) throw new Error(`Unknown key: ${main}`);
    return [
      ...held.map((value) => vkStroke(value, false)),
      vkStroke(vk, false),
      vkStroke(vk, true),
      ...[...held].reverse().map((value) => vkStroke(value, true)),
    ];
  }
  if (isPrintableText(main)) {
    const code = main.codePointAt(0) ?? 0;
    return [
      { kind: "unicode", code, up: false },
      { kind: "unicode", code, up: true },
    ];
  }
  const vk = virtualKey(main);
  if (vk === undefined) throw new Error(`Unknown key: ${main}`);
  return [vkStroke(vk, false), vkStroke(vk, true)];
}
