import type { ColorPaletteConfig } from "../../../types";

export function initialPaletteSelection(palette: ColorPaletteConfig): string | null {
  return palette.recent[0] ?? palette.favorites[0] ?? null;
}
export function searchFavoriteColors(colors: string[], query: string): string[] {
  const search = query.trim().replace(/^#/, "").toUpperCase();
  return search ? colors.filter((color) => color.slice(1).toUpperCase().includes(search)) : colors;
}
export function paletteResultIsCurrent(start: number, current: number, mounted: boolean) {
  return mounted && start === current;
}

export function createPaletteReadGuard(generation: () => number, mounted: () => boolean) {
  let revision = 0;
  return {
    begin: () => ({ capture: generation(), revision: ++revision }),
    invalidate: () => {
      revision++;
    },
    current: (request: { capture: number; revision: number }) =>
      mounted() && request.capture === generation() && request.revision === revision,
  };
}

export function paletteGridNextIndex(index: number, key: string, count: number, columns: number) {
  const offset = (
    { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } as Record<
      string,
      number
    >
  )[key];
  if (key === "Home") return 0;
  if (key === "End") return Math.max(0, count - 1);
  return offset === undefined ? null : Math.max(0, Math.min(count - 1, index + offset));
}

export const INITIAL_PALETTE_BROWSER = {
  open: false,
  selected: null as string | null,
  query: "",
  message: null as string | null,
  failure: null as string | null,
};
type BrowserState = typeof INITIAL_PALETTE_BROWSER;
type BrowserAction =
  | { type: "open"; next: boolean; palette: ColorPaletteConfig }
  | { type: "hydrate"; palette: ColorPaletteConfig }
  | { type: "select"; color: string }
  | { type: "query"; value: string }
  | { type: "feedback"; message?: string | null; failure?: string | null };
export function paletteBrowserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "open":
      return action.next
        ? {
            ...INITIAL_PALETTE_BROWSER,
            open: true,
            selected: initialPaletteSelection(action.palette),
          }
        : INITIAL_PALETTE_BROWSER;
    case "hydrate":
      return state.open && !state.selected
        ? { ...state, selected: initialPaletteSelection(action.palette) }
        : state;
    case "select":
      return { ...state, selected: action.color, message: null, failure: null };
    case "query":
      return { ...state, query: action.value };
    case "feedback":
      return { ...state, message: action.message ?? null, failure: action.failure ?? null };
  }
}
