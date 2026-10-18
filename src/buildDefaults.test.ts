import { describe, expect, it } from "vitest";
import { clearBuildPreferences } from "./buildDefaults";
describe("构建默认值偏好", () => {
  it("新构建和同构建重新安装清理偏好，普通重启保留用户修改", () => {
    const values = new Map<string, string>([
      ["dock-mapper:theme", "dark"],
      ["unrelated-app", "keep"],
      ["dock-mapper:telemetry-archive", "history"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    clearBuildPreferences(storage, "build-A:install-A");
    expect(values.has("dock-mapper:theme")).toBe(false);
    values.set("dock-mapper:theme", "dark");
    clearBuildPreferences(storage, "build-A:install-A");
    expect(values.get("dock-mapper:theme")).toBe("dark");
    clearBuildPreferences(storage, "build-B:install-A");
    expect(values.has("dock-mapper:theme")).toBe(false);
    values.set("dock-mapper:theme", "dark");
    clearBuildPreferences(storage, "build-B:install-B");
    expect(values.has("dock-mapper:theme")).toBe(false);
    expect(values.get("unrelated-app")).toBe("keep");
    expect(values.get("dock-mapper:telemetry-archive")).toBe("history");
  });
  it("清理失败不记录已完成标识，允许下次重试", () => {
    let identity: string | null = null;
    const storage = {
      getItem: () => identity,
      removeItem: () => {
        throw new Error("拒绝写入");
      },
      setItem: (_key: string, value: string) => {
        identity = value;
      },
    };
    expect(() => clearBuildPreferences(storage, "new-build")).toThrow("拒绝写入");
    expect(identity).toBeNull();
  });
});
