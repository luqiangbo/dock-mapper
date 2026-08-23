export interface ShortcutKeyEvent {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
  key: string;
}

export function shortcutFromKeyEvent(event: ShortcutKeyEvent): string | null {
  const modifiers = [
    event.ctrlKey ? "Control" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Super" : null,
  ].filter(Boolean) as string[];
  if (modifiers.length === 0) return null;
  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(event.code)) key = event.code;
  else if (event.code === "Space") key = "Space";
  else if (["Enter", "Tab", "Escape", "PrintScreen"].includes(event.key)) key = event.key;
  if (!key) return null;
  return [...modifiers, key].join("+");
}
