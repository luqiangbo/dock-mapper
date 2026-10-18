import { describe, expect, it } from "vitest";
import { createPageReadGuard } from "./pageReadGuard";

describe("保留页面的异步刷新", () => {
  it("离开页面后不应用旧读取，再进入也不能恢复旧读取的写入权", async () => {
    const guard = createPageReadGuard();
    const old = guard.begin();
    let complete!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const displayed: string[] = [];
    const apply = pending.then((value) => {
      if (guard.isCurrent(old)) displayed.push(value);
    });
    guard.setActive(false);
    expect(guard.isCurrent(old)).toBe(false);
    guard.setActive(true);
    const current = guard.begin();
    displayed.push("返回后读取的新内容");
    complete("离开前读取的旧内容");
    await apply;
    expect(displayed).toEqual(["返回后读取的新内容"]);
    expect(guard.isCurrent(current)).toBe(true);
  });

  it("刷新或外部配置更新后，旧响应不会替换当前配置", () => {
    const guard = createPageReadGuard();
    const old = guard.begin();
    const latest = guard.begin();
    expect(guard.isCurrent(old)).toBe(false);
    expect(guard.isCurrent(latest)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(latest)).toBe(false);
  });

  it("隐藏期间即使发生读取调用也不发布结果", () => {
    const guard = createPageReadGuard();
    guard.setActive(false);
    expect(guard.isCurrent(guard.begin())).toBe(false);
  });
});
