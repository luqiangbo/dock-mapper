export function copyBinaryPayload(payload: unknown): ArrayBuffer {
  let source: Uint8Array;

  if (payload instanceof ArrayBuffer) {
    source = new Uint8Array(payload);
  } else if (ArrayBuffer.isView(payload)) {
    source = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  } else if (Array.isArray(payload) && payload.every((value) => Number.isInteger(value))) {
    source = Uint8Array.from(payload as number[]);
  } else {
    throw new TypeError("Pinned image response is not binary data");
  }

  if (source.byteLength === 0) {
    throw new Error("Pinned image response is empty");
  }

  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}
