import { describe, expect, it } from "vitest";
import { fontStack, normalizeFont, fontOptions, createFontReader } from "./uiFont";

describe("全局界面字体", () => {
  it("系统默认和无效名称使用中文回退，字体名不注入 CSS", () => {
    expect(fontStack("")).toContain('"Microsoft YaHei UI"');
    expect(fontStack("Arial")).toBe(
      '"Arial", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    );
    expect(normalizeFont('Arial"; color:red')).toBe("");
    expect(normalizeFont("  微软雅黑  ")).toBe("微软雅黑");
  });
  it("字体被卸载时仍显示保存的选择并提示不可用", () => {
    const options = fontOptions(["Arial", "微软雅黑"], "Old Font");
    expect(options.find((item) => item.value === "Old Font")?.label).toContain("不可用");
    expect(options[0].value).toBe("");
    expect(options.some((item) => item.value === "微软雅黑")).toBe(true);
  });
  it("后到的旧读取不能覆盖新配置事件或卸载后的状态", async () => {
    let resolve!: (font: string) => void;
    const values: string[] = [];
    const reader = createFontReader((font) => values.push(font));
    const pending = reader.read(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    reader.receive("微软雅黑");
    resolve("Arial");
    await pending;
    expect(values).toEqual(["微软雅黑"]);
    reader.dispose();
    reader.receive("Arial");
    expect(values).toEqual(["微软雅黑"]);
  });
  it("读取失败向调用方传播，之后仍可重试", async () => {
    const values: string[] = [];
    const reader = createFontReader((font) => values.push(font));
    await expect(reader.read(() => Promise.reject(new Error("读取失败")))).rejects.toThrow(
      "读取失败",
    );
    await reader.read(async () => "Arial");
    expect(values).toEqual(["Arial"]);
  });
  it("新字体事件到达后，旧读取的失败不再覆盖当前状态", async () => {
    let reject!: (error: Error) => void;
    const values: string[] = [];
    const reader = createFontReader((font) => values.push(font));
    const pending = reader.read(
      () =>
        new Promise<string>((_, fail) => {
          reject = fail;
        }),
    );
    reader.receive("微软雅黑");
    reject(new Error("旧读取超时"));
    await expect(pending).resolves.toBeUndefined();
    expect(values).toEqual(["微软雅黑"]);
  });
});
