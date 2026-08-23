export async function fetchScreenshotBlob(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetcher(url, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error(`Failed to load screenshot (${response.status})`);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Screenshot response is empty");
  return blob;
}

export async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  // WebView2 may display a custom localhost-protocol image while still marking
  // every canvas that uses it as tainted. Materializing the CORS response as a
  // blob: URL makes the decoded image belong to the current WebView origin.
  const blob = await fetchScreenshotBlob(url);
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode screenshot"));
      image.src = blobUrl;
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
