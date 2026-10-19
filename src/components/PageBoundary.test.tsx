import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Popconfirm } from "antd";
import { isValidElement, type ReactElement } from "react";
import PageBoundary from "./PageBoundary";
import { isModuleResourceError } from "./pageFailure";
import { recordRuntimeLog } from "./runtimeLogging";

vi.mock("./runtimeLogging", () => ({ recordRuntimeLog: vi.fn() }));

function action(boundary: PageBoundary) {
  const view = boundary.render();
  if (!isValidElement<{ action: ReactElement }>(view)) throw new Error("缺少错误反馈");
  return view.props.action;
}

describe("页面错误独立恢复", () => {
  it("正常页面直接显示，不引入模块加载占位", () => {
    const boundary = new PageBoundary({ pageKey: "settings", children: <span>设置内容</span> });
    expect(renderToStaticMarkup(boundary.render())).toBe("<span>设置内容</span>");
  });
  it("渲染失败记入日志，重试仅清理失败页，其他页的草稿不变", () => {
    const failed = new PageBoundary({ pageKey: "settings" });
    const draft = <input defaultValue="尚未提交的筛选" />;
    const other = new PageBoundary({ pageKey: "history", children: draft });
    failed.state = PageBoundary.getDerivedStateFromError(new Error("渲染失败"));
    failed.componentDidCatch(new Error("渲染失败"));
    expect(recordRuntimeLog).toHaveBeenCalledWith(
      "application",
      expect.stringContaining("settings"),
      "error",
    );
    const retry = action(failed) as ReactElement<{ onClick: () => void }>;
    expect(retry.type).toBe(Button);
    failed.setState = vi.fn((next: unknown) => {
      failed.state = next as typeof failed.state;
    });
    retry.props.onClick();
    expect(failed.state.error).toBeNull();
    expect(other.render()).toBe(draft);
  });
  it.each([
    "RuntimeError: factory is undefined(antd/skeleton)",
    "ChunkLoadError: Loading chunk 3 failed",
    "Failed to fetch dynamically imported module",
  ])("资源异常 %s 提供带确认的重新加载入口，不自动刷新", (message) => {
    expect(isModuleResourceError(message)).toBe(true);
    const failed = new PageBoundary({ pageKey: "settings" });
    failed.state = { error: message };
    const confirm = action(failed) as ReactElement<{ description: string; onConfirm: () => void }>;
    expect(confirm.type).toBe(Popconfirm);
    expect(confirm.props.description).toContain("尚未保存");
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    try {
      expect(reload).not.toHaveBeenCalled();
      confirm.props.onConfirm();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("普通渲染或业务错误不误判为资源损坏", () => {
    expect(isModuleResourceError("TypeError: Cannot read properties of null")).toBe(false);
    expect(isModuleResourceError("读取设置失败")).toBe(false);
  });
});
