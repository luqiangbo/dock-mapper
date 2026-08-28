import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./api";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

let api: Api;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  ({ api } = await import("./api"));
});

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("binary image IPC", () => {
  it("uploads Uint8Array as a raw body and uses the returned ID", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    mocks.invoke.mockResolvedValueOnce("image-1").mockResolvedValueOnce(true);

    const imageId = await api.uploadImage(bytes);
    await api.copyImage(imageId);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "upload_image", bytes);
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "copy_image", { imageId: "image-1" });
  });

  it("creates final-image history using a camel-case IPC argument", async () => {
    mocks.invoke.mockResolvedValueOnce({ id: "history-1" });
    await api.createScreenshotHistory("result-1");
    expect(mocks.invoke).toHaveBeenCalledWith("create_screenshot_history", {
      resultImageId: "result-1",
    });
  });
});
