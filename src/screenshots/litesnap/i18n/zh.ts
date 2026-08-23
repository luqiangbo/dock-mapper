import type { Messages } from "./en";

export const zh: Messages = {
  toolbar: {
    rectangle: "矩形",
    ellipse: "椭圆",
    arrow: "箭头",
    pen: "画笔",
    highlight: "高亮笔",
    mosaic: "马赛克",
    picker: "取色笔 · C 复制颜色值",
    text: "文字",
    undo: "撤销",
    save: "保存",
    pin: "贴图",
    cancel: "取消",
    done: "完成 (复制)",
  },
  hints: {
    dragToSelect: "拖动选择区域 · Esc 取消",
    capturing: "正在捕获屏幕…",
    working: "处理中…",
    adjustRegion: "拖动控制点可调整大小 · 拖动内部可移动 · 选择工具开始标注",
  },
  ocr: {
    title: "文字识别",
    copy: "复制",
    close: "关闭",
    noTextFound: "未识别到文字。",
    onnxEngine: "ONNX · PP-OCRv6 small",
    recognizing: "识别中…",
    completedIn: (milliseconds) => `耗时 ${milliseconds} ms`,
    engineFailed: "该 OCR 引擎识别失败。",
    exportFailed: "导出 OCR 选区失败。",
  },
  textEditor: {
    moveHint: "拖动文字可移动 · 双击可再编辑",
  },
};
