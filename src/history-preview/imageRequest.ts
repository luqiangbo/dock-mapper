import type { Size } from "./viewGeometry";

export function startImageRequest(
  source: {
    read: () => Promise<ArrayBuffer>;
    createUrl: (bytes: ArrayBuffer) => string;
    decode: (url: string) => Promise<Size>;
    revokeUrl: (url: string) => void;
  },
  publish: (image: { url: string; size: Size }) => void,
  fail: (error: unknown) => void,
) {
  let disposed = false;
  let url = "";
  const release = () => {
    if (url) {
      source.revokeUrl(url);
      url = "";
    }
  };
  const done = source
    .read()
    .then(async (bytes) => {
      if (disposed) return;
      url = source.createUrl(bytes);
      const size = await source.decode(url);
      if (!disposed) publish({ url, size });
    })
    .catch((error) => {
      release();
      if (!disposed) fail(error);
    });
  return {
    done,
    dispose: () => {
      disposed = true;
      release();
    },
  };
}
