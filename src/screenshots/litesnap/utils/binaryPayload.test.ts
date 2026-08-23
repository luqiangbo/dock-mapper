import { describe, expect, it } from "vitest";
import { copyBinaryPayload } from "./binaryPayload";

describe("binary IPC payload", () => {
  it("copies the ArrayBuffer returned by a Tauri raw response", () => {
    const source = new Uint8Array([137, 80, 78, 71]).buffer;

    expect([...new Uint8Array(copyBinaryPayload(source))]).toEqual([137, 80, 78, 71]);
  });

  it("copies only the visible range of a typed-array view", () => {
    const source = new Uint8Array([0, 137, 80, 78, 71, 0]).subarray(1, 5);

    expect([...new Uint8Array(copyBinaryPayload(source))]).toEqual([137, 80, 78, 71]);
  });

  it("accepts a JSON byte array and rejects missing data", () => {
    expect([...new Uint8Array(copyBinaryPayload([1, 2, 3]))]).toEqual([1, 2, 3]);
    expect(() => copyBinaryPayload(new ArrayBuffer(0))).toThrow("empty");
    expect(() => copyBinaryPayload({ data: [1, 2, 3] })).toThrow("not binary");
  });
});
