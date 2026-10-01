import { describe, expect, it } from "vitest";
import { cloneAnnotationStyles, DEFAULT_ANNOTATION_STYLES } from "./annotationStyleDefaults";
import type { ScreenshotAnnotationStyles } from "../../../types";

describe("马赛克样式读取", () => {
  it("旧配置保留颗粒大小并默认使用像素块", () => {
    const old = structuredClone(DEFAULT_ANNOTATION_STYLES) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const value of Object.values(old)) {
      delete value.mosaic_effect;
      delete value.blur_radius;
    }
    old.mosaic.block_size = 24;
    const restored = cloneAnnotationStyles(old as unknown as ScreenshotAnnotationStyles);
    expect(restored.mosaic).toMatchObject({
      block_size: 24,
      mosaic_effect: "pixelate",
      blur_radius: 12,
    });
  });
  it("效果和强度往返后仍保留各自值", () => {
    const styles = cloneAnnotationStyles(DEFAULT_ANNOTATION_STYLES);
    styles.mosaic = { ...styles.mosaic, mosaic_effect: "blur", blur_radius: 16, block_size: 24 };
    expect(cloneAnnotationStyles(JSON.parse(JSON.stringify(styles))).mosaic).toMatchObject({
      mosaic_effect: "blur",
      blur_radius: 16,
      block_size: 24,
    });
  });
});
