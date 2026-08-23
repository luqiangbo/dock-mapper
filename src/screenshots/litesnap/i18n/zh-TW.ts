import type { Messages } from "./en";

export const zhTW: Messages = {
  toolbar: {
    rectangle: "矩形",
    ellipse: "橢圓",
    arrow: "箭頭",
    pen: "畫筆",
    highlight: "螢光筆",
    mosaic: "馬賽克",
    picker: "取色筆 · C 複製色碼",
    text: "文字",
    undo: "復原",
    save: "儲存",
    pin: "貼圖",
    cancel: "取消",
    done: "完成（複製）",
  },
  hints: {
    dragToSelect: "拖曳選取區域 · Esc 取消",
    capturing: "正在擷取螢幕…",
    working: "處理中…",
    adjustRegion: "拖曳控制點可調整大小 · 拖曳內部可移動 · 選擇工具開始標註",
  },
  ocr: {
    title: "文字辨識",
    copy: "複製",
    close: "關閉",
    noTextFound: "未辨識到文字。",
    onnxEngine: "ONNX · PP-OCRv6 small",
    recognizing: "辨識中…",
    completedIn: (milliseconds) => `耗時 ${milliseconds} ms`,
    engineFailed: "此 OCR 引擎辨識失敗。",
    exportFailed: "匯出 OCR 選取區域失敗。",
  },
  textEditor: {
    moveHint: "拖曳文字可移動 · 連按兩下可再編輯",
  },
};
