import { describe, expect, it } from "vitest";
import {
  INITIAL_PALETTE_BROWSER,
  paletteBrowserReducer as reduce,
  searchFavoriteColors,
  paletteGridNextIndex,
  paletteResultIsCurrent,
  createPaletteReadGuard,
} from "./paletteBrowserState";
import { formatPaletteColor } from "./pickerColor";
import { pickerKeyAction } from "./pickerState";

const palette = { recent: ["#E03131"], favorites: ["#FFFFFF", "#112233"] };
describe("颜色收藏面板", () => {
  it("旧读取不能覆盖新收藏，新截图或卸载后丢弃旧捕获读取", () => {
    let capture = 1;
    let mounted = true;
    const guard = createPaletteReadGuard(
      () => capture,
      () => mounted,
    );
    const beforeWrite = guard.begin();
    guard.invalidate();
    expect(guard.current(beforeWrite)).toBe(false);
    const refresh = guard.begin();
    expect(guard.current(refresh)).toBe(true);
    capture = 2;
    expect(guard.current(refresh)).toBe(false);
    const current = guard.begin();
    mounted = false;
    expect(guard.current(current)).toBe(false);
  });
  it("空收藏也能打开，默认优先选择最近色，只有收藏时选择第一个", () => {
    expect(
      reduce(INITIAL_PALETTE_BROWSER, {
        type: "open",
        next: true,
        palette: { recent: [], favorites: [] },
      }),
    ).toMatchObject({ open: true, selected: null });
    expect(reduce(INITIAL_PALETTE_BROWSER, { type: "open", next: true, palette }).selected).toBe(
      "#E03131",
    );
    expect(
      reduce(INITIAL_PALETTE_BROWSER, {
        type: "open",
        next: true,
        palette: { ...palette, recent: [] },
      }).selected,
    ).toBe("#FFFFFF");
  });
  it("复制失败或收藏内容更新时保持打开、搜索和选择，关闭后清理临时状态", () => {
    let state = reduce(INITIAL_PALETTE_BROWSER, { type: "open", next: true, palette });
    state = reduce(state, { type: "select", color: "#112233" });
    state = reduce(state, { type: "query", value: "112" });
    state = reduce(state, { type: "feedback", failure: "剪贴板不可用" });
    state = reduce(state, { type: "hydrate", palette: { recent: [], favorites: [] } });
    expect(state).toMatchObject({
      open: true,
      selected: "#112233",
      query: "112",
      failure: "剪贴板不可用",
    });
    state = reduce(state, { type: "feedback", message: "已收藏" });
    expect(state).toMatchObject({
      open: true,
      selected: "#112233",
      failure: null,
      message: "已收藏",
    });
    expect(reduce(state, { type: "open", next: false, palette })).toEqual(INITIAL_PALETTE_BROWSER);
  });
  it("不限量收藏按HEX搜索，忽略大小写和开头井号", () => {
    const colors = Array.from(
      { length: 128 },
      (_, i) => `#${i.toString(16).padStart(6, "0").toUpperCase()}`,
    );
    expect(searchFavoriteColors(colors, "")).toHaveLength(128);
    expect(searchFavoriteColors(colors, " #00007f ")).toEqual(["#00007F"]);
    expect(searchFavoriteColors(colors, "FFFFFF")).toEqual([]);
  });
  it("复制最近色和收藏色使用指定复制格式", () => {
    expect(formatPaletteColor("#FF0000", "hex")).toBe("#FF0000");
    expect(formatPaletteColor("#FF0000", "rgb")).toBe("rgb(255, 0, 0)");
    expect(formatPaletteColor("#FF0000", "hsl")).toBe("hsl(0 100% 50%)");
    expect(formatPaletteColor("#FF0000", "hsv")).toBe("hsv(0 100% 100%)");
    expect(formatPaletteColor("#FF0000", "css")).toBe("color(srgb 100% 0% 0%)");
  });
  it("网格方向键按列数移动，菜单打开时暂停像素微调和C复制", () => {
    expect(paletteGridNextIndex(1, "ArrowDown", 128, 8)).toBe(9);
    expect(paletteGridNextIndex(0, "ArrowUp", 128, 8)).toBe(0);
    for (const key of ["c", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
      expect(
        pickerKeyAction(
          { key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false },
          false,
          false,
          true,
        ),
      ).toBeNull();
  });
  it("关闭重开面板或切换截图后丢弃旧操作反馈", () => {
    expect(paletteResultIsCurrent(1, 2, true)).toBe(false);
    expect(paletteResultIsCurrent(1, 1, false)).toBe(false);
    expect(paletteResultIsCurrent(1, 1, true)).toBe(true);
  });
});
