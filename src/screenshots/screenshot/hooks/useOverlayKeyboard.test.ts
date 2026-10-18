import { describe, expect, it, vi } from "vitest";
import { overlayKeyAction } from "./useOverlayKeyboard";
const options: Parameters<typeof overlayKeyAction>[1] = {
  blocked: false,
  tool: "arrow",
  phase: "editing",
  hasSelectedText: false,
  hasSelectedNumber: false,
  hasSelectedRaster: false,
  shotReady: true,
  busy: false,
  editorActive: true,
  copyPickerHex: vi.fn(),
  exitPicker: vi.fn(),
  clearSelection: vi.fn(),
  returnToSelect: vi.fn(),
  deleteSelection: vi.fn(),
  cancel: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  confirm: vi.fn(),
};
const event = (key: string, control = false) => ({
  key,
  ctrlKey: control,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
});
describe("截图宿主快捷键", () => {
  it("标注选中、工具激活或菜单打开时，Esc 均一次关闭截图", () => {
    expect(
      overlayKeyAction(
        event("Escape"),
        { ...options, blocked: true, hasEditorSelection: true, isEditingText: () => true },
        true,
      ),
    ).toBe("cancel");
  });
  it("输入法组字时 Esc 不关闭截图", () => {
    expect(overlayKeyAction({ ...event("Escape"), isComposing: true }, options)).toBeNull();
  });
  it("Ctrl+C 复制整图，输入框或文字编辑中保留文本复制", () => {
    expect(overlayKeyAction(event("c", true), options)).toBe("confirm");
    expect(overlayKeyAction(event("c", true), options, true)).toBeNull();
    expect(
      overlayKeyAction(event("c", true), { ...options, isEditingText: () => true }),
    ).toBeNull();
    expect(overlayKeyAction(event("c", true), { ...options, busy: true })).toBeNull();
  });
  it("重做和撤销分派给同一编辑器动作", () => {
    expect(overlayKeyAction(event("z", true), options)).toBe("undo");
    expect(overlayKeyAction({ ...event("z", true), shiftKey: true }, options)).toBe("redo");
    expect(overlayKeyAction(event("y", true), options)).toBe("redo");
  });
});
