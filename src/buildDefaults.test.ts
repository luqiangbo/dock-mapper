import { describe, expect, it } from "vitest";
import { clearBuildPreferences } from "./buildDefaults";
function fixture() {
  const values = new Map([
    ["dock-mapper:theme", "dark"],
    ["dock-mapper:ui-font", "Arial"],
    ["dock-mapper:defaults-build-id", "old-build:old-install"],
    ["dockmapper.telemetry-archive.v1", "history"],
    ["unrelated-app", "keep"],
  ]);
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  };
}
describe("显式重置后的前端偏好", () => {
  it("旧版本升级或重新安装没有显式重置时保留主题与字体", () => {
    const { values, storage } = fixture();
    clearBuildPreferences(storage, 0);
    expect(values.get("dock-mapper:theme")).toBe("dark");
    expect(values.get("dock-mapper:ui-font")).toBe("Arial");
  });
  it("仅新重置代次清理设置，同一代次重开保留修改和归档", () => {
    const { values, storage } = fixture();
    clearBuildPreferences(storage, 1);
    expect(values.has("dock-mapper:theme")).toBe(false);
    expect(values.has("dock-mapper:ui-font")).toBe(false);
    values.set("dock-mapper:theme", "dark");
    clearBuildPreferences(storage, 1);
    expect(values.get("dock-mapper:theme")).toBe("dark");
    clearBuildPreferences(storage, 2);
    expect(values.has("dock-mapper:theme")).toBe(false);
    expect(values.get("dockmapper.telemetry-archive.v1")).toBe("history");
    expect(values.get("unrelated-app")).toBe("keep");
  });
  it("清理失败不提交代次，下次启动仍能重试", () => {
    const { values, storage } = fixture();
    expect(() =>
      clearBuildPreferences(
        {
          ...storage,
          removeItem: () => {
            throw new Error("拒绝写入");
          },
        },
        1,
      ),
    ).toThrow("拒绝写入");
    expect(values.has("dock-mapper:settings-reset-revision")).toBe(false);
    clearBuildPreferences(storage, 1);
    expect(values.has("dock-mapper:theme")).toBe(false);
  });
});
