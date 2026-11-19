import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ResetSettings from "./ResetSettings";

// Covers the content/actions passed to Ant Design and native IPC, not Portal rendering.
const boundary = vi.hoisted(() => ({
  confirm: vi.fn(),
  update: vi.fn(),
  error: vi.fn(),
  invoke: vi.fn(),
  restart: vi.fn(),
}));
vi.mock("antd", () => ({
  App: {
    useApp: () => ({
      modal: { confirm: boundary.confirm },
      notification: { error: boundary.error },
    }),
  },
  Button: "button",
  Space: "div",
  Typography: { Text: "span" },
}));
vi.mock("../api/ipc", () => ({ invokeCommand: boundary.invoke }));
vi.mock("../api/commands", () => ({ errorMessage: (error: unknown) => String(error) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: boundary.restart }));

beforeEach(() => {
  vi.clearAllMocks();
  boundary.confirm.mockReturnValue({ update: boundary.update });
});

function openDialog() {
  const tree = ResetSettings() as ReactElement<{
    children: ReactElement<{ onClick?: () => void }>[];
  }>;
  tree.props.children.find((child) => child.props.onClick)?.props.onClick?.();
  return boundary.confirm.mock.calls[0][0];
}

it("首次打开显示恢复范围与保留内容，确认前不会修改数据", () => {
  const dialog = openDialog();
  const content = renderToStaticMarkup(dialog.content);
  expect(content).toContain("翻译服务配置及密钥");
  expect(content).toContain("截图历史及收藏");
  expect(content).toContain("Windows 系统键盘映射及恢复资料不受影响");
  expect(dialog.cancelText).toBe("取消");
  expect(boundary.invoke).not.toHaveBeenCalled();
});

it("保存失败显示原因并允许取消，重启失败后重试只执行重启", async () => {
  const dialog = openDialog();
  boundary.invoke.mockRejectedValueOnce(new Error("磁盘不可写")).mockResolvedValue(1);
  boundary.restart.mockRejectedValue(new Error("重启失败"));
  await expect(dialog.onOk()).rejects.toThrow("磁盘不可写");
  expect(boundary.error.mock.calls[boundary.error.mock.calls.length - 1]?.[0].message).toBe(
    "恢复设置失败",
  );
  expect(boundary.update).toHaveBeenLastCalledWith({ cancelButtonProps: { disabled: false } });
  await expect(dialog.onOk()).rejects.toThrow("设置已恢复，请手动重启");
  expect(boundary.update.mock.calls[boundary.update.mock.calls.length - 1]?.[0].okText).toBe(
    "重试重启",
  );
  await expect(dialog.onOk()).rejects.toThrow("设置已恢复，请手动重启");
  expect(boundary.invoke.mock.calls).toEqual([["reset_app_settings"], ["reset_app_settings"]]);
  expect(boundary.restart).toHaveBeenCalledTimes(2);
});
