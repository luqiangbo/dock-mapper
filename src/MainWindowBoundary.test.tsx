import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MainWindowBoundary from "./MainWindowBoundary";
import { recordRuntimeLog } from "./components/runtimeLogging";

vi.mock("./components/runtimeLogging", () => ({ recordRuntimeLog: vi.fn() }));

describe("主窗口异常恢复", () => {
  it("初始化或主题渲染失败时无需应用 Provider 也能显示恢复入口", () => {
    const boundary = new MainWindowBoundary({ children: <span>正常主窗口</span> });
    const error = new Error("主题读取失败");
    boundary.state = MainWindowBoundary.getDerivedStateFromError(error);
    boundary.componentDidCatch(error, { componentStack: "" });
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("主窗口显示失败");
    expect(html).toContain("主题读取失败");
    expect(html).toContain("重试显示");
    expect(html).toContain("重新加载界面");
    expect(html).not.toContain("正常主窗口");
    expect(recordRuntimeLog).toHaveBeenCalledWith(
      "application",
      expect.stringContaining("主题读取失败"),
      "error",
    );
  });

  it("主窗口重新挂载后只保留当前窗口的错误监听", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      const first = new MainWindowBoundary({});
      first.componentDidMount();
      first.componentWillUnmount();
      const next = new MainWindowBoundary({});
      next.componentDidMount();
      vi.mocked(recordRuntimeLog).mockClear();
      const event = new Event("error");
      Object.assign(event, { message: "窗口异常" });
      target.dispatchEvent(event);
      expect(recordRuntimeLog).toHaveBeenCalledTimes(1);
      next.componentWillUnmount();
      target.dispatchEvent(event);
      expect(recordRuntimeLog).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
