import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the asynchronous request boundary without mounting a Tauri window.
const state = vi.hoisted(() => ({
  values: [] as unknown[],
  setters: [] as Array<(value: unknown) => void>,
}));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = state.values.length;
    state.values.push(initial);
    const set = (value: unknown) => {
      state.values[index] = value;
    };
    state.setters.push(set);
    return [initial, set];
  },
}));
import { useOcr } from "./useOcr";

const result = { text: "识别文字", engine: "onnx", blocks: [] };
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
beforeEach(() => {
  state.values = [];
  state.setters = [];
});
afterEach(() => vi.unstubAllGlobals());
function setup(execute = vi.fn().mockResolvedValue(result)) {
  const uploadImage = vi.fn().mockResolvedValue("image-id");
  vi.stubGlobal("window", {
    api: {
      uploadImage,
      recognizeSelection: execute,
      releaseImage: vi.fn().mockResolvedValue(undefined),
    },
  });
  const ocr = useOcr({
    enabled: true,
    exportPng: async () => new Uint8Array([1]),
    engineFailed: "识别失败",
  });
  return { ...ocr, uploadImage, execute };
}
describe("后台识别请求状态", () => {
  it("自动识别与快速识别同时触发时只提交一次", async () => {
    const ocr = setup();
    ocr.recognize();
    ocr.recognize();
    await settle();
    expect(ocr.uploadImage).toHaveBeenCalledOnce();
    expect(ocr.execute).toHaveBeenCalledOnce();
    expect(state.values[0]).toMatchObject({ result, pending: false, error: null });
    expect(state.values[1]).toBe(false);
  });
  it("失败显示错误且允许重试成功", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("识别失败"))
      .mockResolvedValueOnce(result);
    const ocr = setup(execute);
    ocr.recognize();
    await settle();
    expect(state.values[0]).toMatchObject({ error: "识别失败", pending: false });
    ocr.recognize();
    await settle();
    expect(state.values[0]).toMatchObject({ result, error: null, pending: false });
  });
  it("选区调整后迟到结果不能覆盖新请求", async () => {
    let finish!: (value: typeof result) => void;
    const execute = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(result);
    const ocr = setup(execute);
    ocr.recognize();
    await settle();
    ocr.dismiss();
    ocr.recognize();
    await settle();
    finish({ ...result, text: "旧文字" });
    await settle();
    expect(state.values[0]).toMatchObject({ result, pending: false });
  });
});
