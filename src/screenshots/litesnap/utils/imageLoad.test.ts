import { describe, expect, it, vi } from "vitest";
import { fetchScreenshotBlob } from "./imageLoad";

describe("canvas-safe screenshot loading", () => {
  it("materializes the custom-protocol image through a CORS response", async () => {
    const expected = new Blob([new Uint8Array([0x42, 0x4d])], { type: "image/bmp" });
    const fetcher = vi.fn(async () => new Response(expected, { status: 200 }));

    await expect(
      fetchScreenshotBlob("http://dockmapper-shot.localhost/capture/1.bmp", fetcher),
    ).resolves.toBeInstanceOf(Blob);
    expect(fetcher).toHaveBeenCalledWith(
      "http://dockmapper-shot.localhost/capture/1.bmp",
      expect.objectContaining({ mode: "cors", credentials: "omit", cache: "no-store" }),
    );
  });

  it("rejects empty screenshot responses", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(), { status: 200 }));
    await expect(fetchScreenshotBlob("capture", fetcher)).rejects.toThrow(
      "Screenshot response is empty",
    );
  });
});
