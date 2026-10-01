import { describe, expect, it } from "vitest";
import { createRequestQueue } from "./requestQueue";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("历史缩略图请求", () => {
  it("同时加载最多四张，排队图片随后继续加载", async () => {
    const queue = createRequestQueue(4);
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 12 }, (_, index) =>
      queue.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        return index;
      }, new AbortController().signal),
    );
    await Promise.resolve();
    expect(active).toBe(4);
    gate.resolve();
    expect(await Promise.all(jobs)).toHaveLength(12);
    expect(peak).toBe(4);
  });
  it("离开页面取消未开始的请求，忽略已执行请求的旧结果", async () => {
    const queue = createRequestQueue(1);
    const gate = deferred();
    const firstController = new AbortController();
    const queuedController = new AbortController();
    let queuedStarted = false;
    const first = queue.run(async () => {
      await gate.promise;
      return "旧图";
    }, firstController.signal);
    const queued = queue.run(async () => {
      queuedStarted = true;
    }, queuedController.signal);
    const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const queuedRejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    queuedController.abort();
    firstController.abort();
    await Promise.all([firstRejected, queuedRejected]);
    expect(queuedStarted).toBe(false);
    gate.resolve();
  });
});
