import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync(
  new URL("../public/main-window-appearance.js", import.meta.url),
  "utf8",
);
function appearance(stored, systemDark, denied = false) {
  const root = { dataset: {}, style: {} };
  const storage = {
    getItem: vi.fn(() => {
      if (denied) throw new Error("拒绝访问");
      return stored;
    }),
  };
  runInNewContext(source, {
    localStorage: storage,
    document: { documentElement: root },
    matchMedia: () => ({ matches: systemDark }),
    console: { warn: vi.fn() },
  });
  return { root, storage };
}
describe("不依赖入口脚本的首帧", () => {
  it("首帧包含可见启动提示和原生不定进度，React 接管前不为空", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('class="dock-startup"');
    expect(html).toContain("正在启动…");
    expect(html).toContain('<progress aria-label="正在启动"></progress>');
    expect(html).toContain("/main-window-appearance.js");
    expect(html).toContain("/main-window-startup.css");
    expect(html.indexOf("/main-window-appearance.js")).toBeLessThan(html.indexOf("<body>"));
  });
  it("首帧只读取主题，明确主题优先，否则跟随系统；读取失败也能显示", () => {
    expect(appearance("light", true).root.dataset.theme).toBe("light");
    expect(appearance("dark", false).root.style.colorScheme).toBe("dark");
    expect(appearance("system", true).root.dataset.theme).toBe("dark");
    expect(appearance("invalid", false).root.dataset.theme).toBe("light");
    const denied = appearance(null, true, true);
    expect(denied.root.dataset.theme).toBe("dark");
    expect(denied.storage.getItem).toHaveBeenCalledWith("dock-mapper:theme");
  });
});
