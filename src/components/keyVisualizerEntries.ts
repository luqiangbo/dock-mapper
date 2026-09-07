import type { KeyVisualizerInput } from "../types";

export interface KeyVisualizerEntry extends KeyVisualizerInput {
  id: string;
}

export const KEY_VISUALIZER_LIFETIME_MS = 3_000;
export const KEY_VISUALIZER_CHARACTER_MERGE_MS = 1_500;
const KEY_VISUALIZER_FADE_MS = 500;
const MAX_CHARACTER_DISPLAY_LENGTH = 28;

export function clampKeyVisualizerOpacity(value: number): number {
  return Math.min(100, Math.max(20, Math.round(value)));
}

export function keyVisualizerToggleLabel(enabled: boolean): string {
  return enabled ? "隐藏按键文本" : "显示按键文本";
}

export function keyVisualizerEntryOpacity(
  textOpacity: number,
  timestamp: number,
  now: number,
): number {
  const remaining = KEY_VISUALIZER_LIFETIME_MS - (now - timestamp);
  const fade = Math.min(1, Math.max(0, remaining / KEY_VISUALIZER_FADE_MS));
  return (clampKeyVisualizerOpacity(textOpacity) / 100) * fade;
}

export function appendKeyVisualizerEntry(
  entries: KeyVisualizerEntry[],
  input: KeyVisualizerInput,
  random: () => number = Math.random,
): KeyVisualizerEntry[] {
  const active = entries.filter(
    (entry) => input.timestamp_ms - entry.timestamp_ms < KEY_VISUALIZER_LIFETIME_MS,
  );
  const latest = active[0];
  if (
    input.category === "character" &&
    latest?.category === "character" &&
    latest.generation === input.generation &&
    input.timestamp_ms - latest.timestamp_ms <= KEY_VISUALIZER_CHARACTER_MERGE_MS
  ) {
    return [
      {
        ...latest,
        ...input,
        id: latest.id,
        label: `${latest.label}${privacyCharacterToken(input.label, random)}`.slice(
          -MAX_CHARACTER_DISPLAY_LENGTH,
        ),
        repeat: 1,
      },
      ...active.slice(1),
    ].slice(0, 5);
  }
  if (latest?.label === input.label && input.repeat > 1) {
    return [{ ...latest, ...input }, ...active.slice(1)].slice(0, 5);
  }
  return [
    {
      ...input,
      label:
        input.category === "character" ? privacyCharacterToken(input.label, random) : input.label,
      id: `${input.timestamp_ms}-${input.label}-${input.category}`,
    },
    ...active,
  ].slice(0, 5);
}

export function privacyCharacterToken(label: string, random: () => number = Math.random): string {
  const sample = random();
  if (sample < 0.12) return "*";
  return sample < 0.2 ? `${label}*` : label;
}

export function removeExpiredKeyVisualizerEntries(
  entries: KeyVisualizerEntry[],
  now: number,
): KeyVisualizerEntry[] {
  return entries.filter((entry) => now - entry.timestamp_ms < KEY_VISUALIZER_LIFETIME_MS);
}
