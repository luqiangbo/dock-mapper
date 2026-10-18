export function previewStep(ids: readonly string[], id: string, direction: -1 | 1): string | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return ids[index + direction] ?? null;
}
export function previewDirection(
  event: {
    key: string;
    repeat: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  editing: boolean,
): -1 | 1 | null {
  if (editing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
    return null;
  return event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
}
