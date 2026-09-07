export interface ShortcutParts {
  modifiers: string[];
  key: string;
}

export const SHORTCUT_MODIFIERS = [
  { value: "Control", label: "Ctrl" },
  { value: "Alt", label: "Alt" },
  { value: "Shift", label: "Shift" },
  { value: "Super", label: "Win" },
] as const;

export const SHORTCUT_KEYS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((value) => ({ value, label: value })),
  ..."0123456789".split("").map((value) => ({ value, label: value })),
  ...Array.from({ length: 12 }, (_, index) => ({
    value: `F${index + 1}`,
    label: `F${index + 1}`,
  })),
  { value: "Space", label: "Space" },
  { value: "Enter", label: "Enter" },
  { value: "Tab", label: "Tab" },
  { value: "Escape", label: "Esc" },
  { value: "PrintScreen", label: "PrintScreen" },
];

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  commandorcontrol: "Control",
  cmdorctrl: "Control",
  alt: "Alt",
  shift: "Shift",
  win: "Super",
  meta: "Super",
  super: "Super",
  command: "Super",
  cmd: "Super",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  enter: "Enter",
  tab: "Tab",
  printscreen: "PrintScreen",
};

const modifierOrder: string[] = SHORTCUT_MODIFIERS.map(({ value }) => value);
const supportedKeys = new Set(SHORTCUT_KEYS.map(({ value }) => value));

export function serializeShortcut(parts: ShortcutParts): string | null {
  if (new Set(parts.modifiers).size !== parts.modifiers.length) return null;
  const modifiers = [...parts.modifiers]
    .filter((value) => modifierOrder.includes(value))
    .sort((left, right) => modifierOrder.indexOf(left) - modifierOrder.indexOf(right));
  if (modifiers.length < 1 || modifiers.length > 2 || !supportedKeys.has(parts.key)) return null;
  return [...modifiers, parts.key].join("+");
}

export function parseShortcut(value: string): ShortcutParts | null {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const rawKey = parts[parts.length - 1];
  const key = KEY_ALIASES[rawKey.toLowerCase()] ?? rawKey.toUpperCase();
  const modifiers = parts.slice(0, -1).map((part) => MODIFIER_ALIASES[part.toLowerCase()]);
  if (modifiers.some((modifier) => !modifier) || new Set(modifiers).size !== modifiers.length) {
    return null;
  }
  const serialized = serializeShortcut({ modifiers, key });
  return serialized ? { modifiers: serialized.split("+").slice(0, -1), key } : null;
}

export function duplicateShortcutFields<T extends string>(
  values: Partial<Record<T, string>>,
  fields: readonly T[],
): T[] {
  const seen = new Map<string, T>();
  const duplicates = new Set<T>();
  for (const field of fields) {
    const value = values[field];
    if (!value) continue;
    const normalized = parseShortcut(value);
    const shortcut = normalized && serializeShortcut(normalized);
    if (!shortcut) continue;
    const previous = seen.get(shortcut);
    if (previous) {
      duplicates.add(previous);
      duplicates.add(field);
    } else {
      seen.set(shortcut, field);
    }
  }
  return [...duplicates];
}
