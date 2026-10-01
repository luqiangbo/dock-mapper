export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface ImageView extends Point {
  scale: number;
  mode: "fit" | "manual";
}

export function fitScale(stage: Size, image: Size) {
  return Math.min(
    1,
    Math.max(1, stage.width - 48) / image.width,
    Math.max(1, stage.height - 48) / image.height,
  );
}
export function fitView(stage: Size, image: Size): ImageView {
  return { scale: fitScale(stage, image), x: 0, y: 0, mode: "fit" };
}
export function constrainView(view: ImageView, stage: Size, image: Size): ImageView {
  const bound = (pixels: number, available: number) =>
    Math.max(0, (pixels + available) / 2 - Math.min(64, pixels / 2, available / 4));
  const x = bound(image.width * view.scale, stage.width);
  const y = bound(image.height * view.scale, stage.height);
  return { ...view, x: Math.max(-x, Math.min(x, view.x)), y: Math.max(-y, Math.min(y, view.y)) };
}
export function zoomAt(
  view: ImageView,
  stage: Size,
  image: Size,
  next: number,
  anchor: Point,
): ImageView {
  const scale = Math.max(Math.min(0.1, fitScale(stage, image)), Math.min(8, next));
  return constrainView(
    {
      scale,
      x: anchor.x - ((anchor.x - view.x) * scale) / view.scale,
      y: anchor.y - ((anchor.y - view.y) * scale) / view.scale,
      mode: "manual",
    },
    stage,
    image,
  );
}
export function escapeAction(fullscreen: boolean): "exit-fullscreen" | "close" {
  return fullscreen ? "exit-fullscreen" : "close";
}
