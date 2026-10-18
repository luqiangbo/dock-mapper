import { describe, expect, it, vi } from "vitest";
import {
  createMappingLoader,
  saveRuntimeMappings,
  type MappingLoadState,
} from "./keyMapperLoading";
import type { KeyCode, KeyMapping, KeyMappingStatus } from "../types";

const status = {
  state: "running",
  enabled: true,
  rule_count: 1,
  error: null,
  legacy: null,
} as KeyMappingStatus;
const api = () => ({
  mappings: vi.fn(async () => []),
  supportedKeys: vi.fn(async () => []),
  status: vi.fn(async () => status),
});
describe("按键映射读取和保存反馈", () => {
  it("写入失败后保留同一份编辑草稿，可直接重试而不重新选择按键", async () => {
    const draft: KeyMapping[] = [
      {
        id: "edited",
        source_key: "ControlLeft" as KeyCode,
        target_key: "MetaLeft" as KeyCode,
        enabled: false,
      },
    ];
    const expected = structuredClone(draft);
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error("写入失败"))
      .mockResolvedValueOnce(undefined);
    const onSaved = vi.fn();
    const source = { sync, status: async () => status };
    await expect(saveRuntimeMappings(source, draft, onSaved)).rejects.toThrow("写入失败");
    expect(onSaved).not.toHaveBeenCalled();
    expect(draft).toEqual(expected);
    await saveRuntimeMappings(source, draft, onSaved);
    expect(sync.mock.calls.map(([rules]) => rules)).toEqual([expected, expected]);
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it("首次加载失败后重试可以进入正常空规则状态", async () => {
    const source = api();
    source.status.mockRejectedValueOnce(new Error("读取失败"));
    const states: MappingLoadState[] = [];
    const loader = createMappingLoader(source, (state) => states.push(state));
    await loader.load();
    expect(states.map((state) => state.phase)).toEqual(["loading", "error"]);
    await loader.load();
    expect(states[states.length - 1]).toEqual({
      phase: "ready",
      data: { rules: [], keys: [], status },
    });
  });
  it("重试完成后旧读取不能覆盖新结果，离页后也不发布结果", async () => {
    const source = api();
    let resolveOld!: (value: KeyMappingStatus) => void;
    source.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const publish = vi.fn();
    const loader = createMappingLoader(source, publish);
    const old = loader.load();
    await loader.load();
    resolveOld(status);
    await old;
    expect(publish).toHaveBeenCalledTimes(3);
    const pending = loader.load();
    loader.cancel();
    await pending;
    expect(publish).toHaveBeenCalledTimes(4);
  });
  it("保存成功后刷新失败仍发布规则，并返回独立的刷新错误", async () => {
    const onSaved = vi.fn();
    const result = await saveRuntimeMappings(
      {
        sync: vi.fn(async () => undefined),
        status: vi.fn(async () => {
          throw new Error("状态不可用");
        }),
      },
      [],
      onSaved,
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(result.status).toBeNull();
    expect(result.refreshError).toContain("状态不可用");
  });
  it("规则保存失败时不发布未保存规则", async () => {
    const onSaved = vi.fn();
    await expect(
      saveRuntimeMappings(
        {
          sync: vi.fn(async () => {
            throw new Error("写入失败");
          }),
          status: vi.fn(async () => status),
        },
        [],
        onSaved,
      ),
    ).rejects.toThrow("写入失败");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
