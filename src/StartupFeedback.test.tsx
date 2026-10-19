import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StartupFeedback from "./StartupFeedback";
import { Alert, Button } from "antd";
describe("React 接管后的启动反馈", () => {
  it("初始化期间保留相同容器，慢启动只补充提示", () => {
    vi.stubGlobal("document", { documentElement: { dataset: { theme: "dark" } } });
    try {
      const initial = renderToStaticMarkup(<StartupFeedback />);
      const slow = renderToStaticMarkup(<StartupFeedback slow />);
      expect(initial).toContain('class="dock-startup"');
      expect(initial).toContain("DockMapper");
      expect(initial).toContain("正在初始化应用…");
      expect(initial).not.toContain("启动耗时较长");
      expect(slow).toContain("启动耗时较长，仍在初始化");
      expect(slow).toContain('aria-busy="true"');
      const error = renderToStaticMarkup(
        <StartupFeedback
          error={<Alert title="初始化失败" description="写入失败" action={<Button>重试</Button>} />}
        />,
      );
      expect(error).toContain("写入失败");
      expect(error).toContain("重试");
      expect(error).not.toContain("正在初始化应用…");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
