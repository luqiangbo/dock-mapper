import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const transform = require("../../../../scripts/excalidraw-local-rendering.cjs");
const packageDir = dirname(require.resolve("@excalidraw/excalidraw"));
describe("Excalidraw 的本机字体和加粗端点集成", () => {
  it.each(["\n  ", "\n  /** Get all the unique font families. */\n  "])(
    "开发包的方法间注释不会阻断字体注册，且保留原注释：%s",
    (betweenMethods) => {
      const source = `class Fonts {
        static fontFacesStylesGenerator() {}
        static init() {
          const fonts = { registered: new Map() };
          const metadata = FONT_METADATA[FONT_FAMILY.Excalifont];
          return fonts.registered;
        }${betweenMethods}static getUniqueFamilies(elements) { return elements; }
      }
      const getCanvasPadding = (element) => {
        switch (element.type) {
          case "freedraw": return element.strokeWidth * 12;
          case "text": return element.fontSize / 2;
          default: return 20;
        }
      };`;
      const patched = transform(source);
      expect(patched).toContain("dockmapperRegistry.set(font.id");
      expect(patched).toContain(`}${betweenMethods}static getUniqueFamilies`);
      expect(patched).toContain("Math.max(20, element.strokeWidth * 12)");
    },
  );
  for (const mode of ["dev", "prod"]) {
    it(`${mode} 从真实依赖暴露原生历史状态、订阅和动作`, () => {
      const source = readFileSync(join(packageDir, "..", mode, "index.js"), "utf8");
      const patched = transform(source);
      expect(patched).toContain("getState:()=>({canUndo:!this.history.isUndoStackEmpty");
      expect(patched).toContain("this.history.onHistoryChangedEmitter.on");
      expect(patched).toContain(
        'this.actionManager.executeAction(this.actionManager.actions.undo,"api")',
      );
      expect(patched).toContain(
        'this.actionManager.executeAction(this.actionManager.actions.redo,"api")',
      );
    });
    it(`${mode} 使用实际依赖验证本机字体注册和随线宽扩展的缓存边距`, () => {
      const directory = join(packageDir, "..", mode);
      const source = readdirSync(directory)
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFileSync(join(directory, name), "utf8"))
        .find(
          (content) =>
            content.includes("static init()") && content.includes("fontFacesStylesGenerator"),
        );
      expect(source).toBeDefined();
      const patched = transform(source);
      expect(patched).toContain("dockmapperRegistry.set(font.id");
      expect(patched).toContain("Microsoft YaHei");
      expect(patched).toContain("DockMapper Number Bold");
      expect(patched).toContain('"id":1101');
      expect(patched).toContain("metrics:font.metrics||");
      expect(patched).toMatch(/Math\.max\(20, \w+\.strokeWidth \* 12\)/);
    });
  }
  it("历史桥接实时发布空栈状态并调用编辑器原有动作，退订后不残留监听", () => {
    const source =
      "class Host { api(){ const excalidrawAPI = true; return {getSceneElementsIncludingDeleted:()=>[], history:{clear:this.resetHistory}}; } }";
    const Host = new Function(`${transform(source)}; return Host;`)();
    const host = new Host();
    let publish;
    const unsubscribe = vi.fn();
    host.history = {
      isUndoStackEmpty: true,
      isRedoStackEmpty: true,
      onHistoryChangedEmitter: {
        on: (callback) => {
          publish = callback;
          return unsubscribe;
        },
      },
    };
    host.actionManager = { actions: { undo: {}, redo: {} }, executeAction: vi.fn() };
    const bridge = host.api().history;
    const listener = vi.fn();
    const off = bridge.subscribe(listener);
    expect(listener).toHaveBeenLastCalledWith({ canUndo: false, canRedo: false });
    publish({ isUndoStackEmpty: false, isRedoStackEmpty: true });
    expect(listener).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });
    bridge.undo();
    expect(host.actionManager.executeAction).toHaveBeenCalledWith(
      host.actionManager.actions.undo,
      "api",
    );
    publish({ isUndoStackEmpty: true, isRedoStackEmpty: false });
    expect(listener).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true });
    bridge.redo();
    expect(host.actionManager.executeAction).toHaveBeenCalledWith(
      host.actionManager.actions.redo,
      "api",
    );
    off();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("依赖的关键接口变动时阻止静默打包错误的字体或裁切逻辑", () => {
    expect(() => transform("const fontFacesStylesGenerator = null")).toThrow("适配未命中");
  });
});
