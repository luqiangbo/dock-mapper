import font from "./numberFont.json";

let ready: Promise<void> | null = null;
export function loadNumberFont(): Promise<void> {
  if (!ready)
    ready = (async () => {
      const face = new FontFace(font.family, 'local("Segoe UI Bold"), local("Arial Bold")');
      document.fonts.add(await face.load());
    })().catch((error) => {
      ready = null;
      throw new Error(`序号字体加载失败：${String(error)}`);
    });
  return ready;
}

export function measureNumberLabel(label: string, size: number, zoom = 1) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("序号文字测量不可用");
  context.font = `${(size * 0.56) / zoom}px "${font.family}"`;
  const metrics = context.measureText(label);
  return {
    width: metrics.width,
    ascent: metrics.actualBoundingBoxAscent,
    descent: metrics.actualBoundingBoxDescent,
  };
}
