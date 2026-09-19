export interface Messages {
  toolbar: {
    rectangle: string;
    ellipse: string;
    arrow: string;
    pen: string;
    highlight: string;
    mosaic: string;
    picker: string;
    text: string;
    undo: string;
    save: string;
    pin: string;
    cancel: string;
    done: string;
  };
  hints: {
    dragToSelect: string;
    capturing: string;
    working: string;
    adjustRegion: string;
  };
  ocr: {
    title: string;
    copy: string;
    copied: string;
    copyFailed: string;
    retry: string;
    close: string;
    noTextFound: string;
    recognizing: string;
    completedIn: (milliseconds: number) => string;
    engineFailed: string;
  };
  textEditor: {
    moveHint: string;
  };
}

export const en: Messages = {
  toolbar: {
    rectangle: "Rectangle",
    ellipse: "Ellipse",
    arrow: "Arrow",
    pen: "Pen",
    highlight: "Highlighter",
    mosaic: "Mosaic",
    picker: "Color picker · C copies HEX",
    text: "Text",
    undo: "Undo",
    save: "Save",
    pin: "Pin on screen",
    cancel: "Cancel",
    done: "Done (copy)",
  },
  hints: {
    dragToSelect: "Drag to select a region · Esc to cancel",
    capturing: "Capturing screen…",
    working: "Working…",
    adjustRegion: "Drag the handles to resize · Drag inside to move · Pick a tool to annotate",
  },
  ocr: {
    title: "OCR result",
    copy: "Copy all",
    copied: "Copied",
    copyFailed: "Copy failed. Please try again.",
    retry: "Retry",
    close: "Close",
    noTextFound: "No text found.",
    recognizing: "Recognizing…",
    completedIn: (milliseconds) => `${milliseconds} ms`,
    engineFailed: "This OCR engine failed.",
  },
  textEditor: {
    moveHint: "Drag text to move · Double-click to edit",
  },
};
