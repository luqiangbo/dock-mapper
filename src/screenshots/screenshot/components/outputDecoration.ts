import type { CaptureExperience } from "./captureExperience";

export async function decorateCapturePng(
  png: Uint8Array,
  settings: Pick<CaptureExperience, "radius" | "border" | "shadow">,
): Promise<Uint8Array> {
  const radius = Math.max(0, Math.min(200, settings.radius));
  const border = Math.max(0, Math.min(32, settings.border));
  const shadow = Math.max(0, Math.min(64, settings.shadow));
  if (!radius && !border && !shadow) return png;
  const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const inset = border + shadow * 2;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth + inset * 2;
    canvas.height = image.naturalHeight + inset * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("截图输出画布不可用");
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,.4)";
    ctx.shadowBlur = shadow;
    ctx.shadowOffsetY = shadow / 2;
    ctx.beginPath();
    ctx.roundRect(
      inset - border,
      inset - border,
      image.naturalWidth + border * 2,
      image.naturalHeight + border * 2,
      radius + border,
    );
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(inset, inset, image.naturalWidth, image.naturalHeight, radius);
    ctx.clip();
    ctx.drawImage(image, inset, inset);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("截图装饰编码失败"))),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
