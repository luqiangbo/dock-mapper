import { describe, expect, it } from "vitest";
import { resolveToolbarModeAction, resolveToolbarToolSelection } from "./toolbarToolState";

describe("截图工具栏单选互斥与取消行为", () => {
  it("再次点击已选中的马赛克等绘制工具会取消并回到选择模式，保留默认文字识别", () => {
    expect(resolveToolbarToolSelection("select", "mosaic")).toEqual({
      nextTool: "mosaic",
      dismissQr: true,
      hideTranslation: true,
    });
    expect(resolveToolbarToolSelection("mosaic", "mosaic")).toEqual({
      nextTool: "select",
      dismissQr: false,
      hideTranslation: false,
    });
  });

  it("切换到其他绘制工具时关闭二维码与译文，保持单工具生效", () => {
    expect(resolveToolbarToolSelection("mosaic", "rect")).toEqual({
      nextTool: "rect",
      dismissQr: true,
      hideTranslation: true,
    });
  });

  it("点击选择工具返回默认模式而不误触发额外关闭", () => {
    expect(resolveToolbarToolSelection("arrow", "select")).toEqual({
      nextTool: "select",
      dismissQr: false,
      hideTranslation: false,
    });
  });

  it("开启翻译或二维码识别时复位绘制工具并互斥关闭另一模式，关闭自身时不重置", () => {
    expect(resolveToolbarModeAction("translate", false)).toEqual({
      resetDrawingTool: true,
      dismissQr: true,
      hideTranslation: false,
    });
    expect(resolveToolbarModeAction("translate", true)).toEqual({
      resetDrawingTool: false,
      dismissQr: false,
      hideTranslation: false,
    });
    expect(resolveToolbarModeAction("qr", false)).toEqual({
      resetDrawingTool: true,
      dismissQr: false,
      hideTranslation: true,
    });
    expect(resolveToolbarModeAction("qr", true)).toEqual({
      resetDrawingTool: false,
      dismissQr: false,
      hideTranslation: false,
    });
  });
});
