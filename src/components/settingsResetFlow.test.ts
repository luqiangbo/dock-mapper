import { describe, expect, it } from "vitest";
import { createSettingsReset } from "./settingsResetFlow";

describe("恢复设置并重启", () => {
  it("恢复失败时不重启，重试可以完成", async () => {
    let fail = true;
    let restarts = 0;
    const reset = createSettingsReset(
      async () => {
        if (fail) throw new Error("磁盘不可写");
      },
      async () => {
        restarts += 1;
      },
    );
    await expect(reset()).rejects.toThrow("磁盘不可写");
    expect(restarts).toBe(0);
    fail = false;
    await reset();
    expect(restarts).toBe(1);
  });
  it("设置已恢复但重启失败时，重试只重启，不会再次清空新设置", async () => {
    let writes = 0;
    let fail = true;
    const reset = createSettingsReset(
      async () => {
        writes += 1;
      },
      async () => {
        if (fail) throw new Error("进程不可重启");
      },
    );
    await expect(reset()).rejects.toThrow("设置已恢复，请手动重启");
    fail = false;
    await reset();
    expect(writes).toBe(1);
  });
});
