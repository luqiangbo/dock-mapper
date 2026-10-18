import { describe, expect, it, vi } from "vitest";
import { restartForBuild } from "./bootstrapRestart";

describe("构建切换时保留开发服务", () => {
  it("开发模式提示重新运行命令，不重启被 Tauri CLI 监视的进程", async () => {
    const relaunch = vi.fn().mockResolvedValue(undefined);
    await expect(restartForBuild(true, relaunch)).rejects.toThrow("pnpm tauri dev");
    expect(relaunch).not.toHaveBeenCalled();
  });
  it("正式包继续使用原生重启，重启失败仍可反馈", async () => {
    const relaunch = vi.fn().mockResolvedValue(undefined);
    await restartForBuild(false, relaunch);
    expect(relaunch).toHaveBeenCalledTimes(1);
    await expect(
      restartForBuild(false, async () => {
        throw new Error("重启失败");
      }),
    ).rejects.toThrow("重启失败");
  });
});
