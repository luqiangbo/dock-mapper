// Narrow, guarded integration for the pinned Excalidraw 0.18.1 bundle.
// Match named method boundaries shared by readable and minified output. No
// generated chunk names or compiler-internal JavaScript APIs are required.
const fonts = [
  ...require("../src/screenshots/screenshot/components/systemFonts.json"),
  require("../src/screenshots/screenshot/components/numberFont.json"),
];
module.exports = function localRendering(source) {
  this?.cacheable?.();
  // The public API exposes clear() only. Bridge the existing action manager and
  // real history notifications, without duplicating Excalidraw's history stack.
  if (/history\s*:\s*\{\s*clear\s*:\s*this\.resetHistory/.test(source)) {
    let bridged = false;
    source = source.replace(/history\s*:\s*\{\s*clear\s*:\s*this\.resetHistory\s*\}/g, () => {
      bridged = true;
      return `history:{clear:this.resetHistory,
        getState:()=>({canUndo:!this.history.isUndoStackEmpty,canRedo:!this.history.isRedoStackEmpty}),
        subscribe:(callback)=>{callback({canUndo:!this.history.isUndoStackEmpty,canRedo:!this.history.isRedoStackEmpty});return this.history.onHistoryChangedEmitter.on(event=>callback({canUndo:!event.isUndoStackEmpty,canRedo:!event.isRedoStackEmpty}));},
        undo:()=>this.actionManager.executeAction(this.actionManager.actions.undo,"api"),
        redo:()=>this.actionManager.executeAction(this.actionManager.actions.redo,"api")}`;
    });
    if (!bridged) throw new Error("Excalidraw 历史记录桥接未命中，已停止打包");
  } else if (
    source.includes("getSceneElementsIncludingDeleted:") &&
    source.includes("excalidrawAPI")
  ) {
    throw new Error("Excalidraw 历史记录接口已变化，已停止打包");
  }
  if (!source.includes("fontFacesStylesGenerator")) return source;
  let registered = false;
  let padded = false;
  source = source.replace(
    // The dev bundle keeps JSDoc between methods; the production bundle removes it.
    /static init\(\)\s*\{([\s\S]*?)\}(\s*(?:\/\*[\s\S]*?\*\/\s*)*)static getUniqueFamilies/,
    (method, body, betweenMethods) => {
      const families = body.match(/([A-Za-z_$][\w$]*)\.Excalifont/)?.[1];
      const start = body.lastIndexOf("return ");
      if (!families || start < 0) throw new Error("Excalidraw 字体注册适配未命中");
      const expression = body
        .slice(start + 7)
        .trim()
        .replace(/;$/, "");
      registered = true;
      return (
        "static init(){" +
        body.slice(0, start) +
        "const dockmapperRegistry = (" +
        expression +
        ");" +
        "for(const font of " +
        JSON.stringify(fonts) +
        "){" +
        families +
        "[font.family]=font.id;" +
        "dockmapperRegistry.set(font.id,{metadata:{local:true,metrics:font.metrics||{unitsPerEm:2048,ascender:1900,descender:-500,lineHeight:1.35}},fontFaces:[]});}" +
        "return dockmapperRegistry;}" +
        betweenMethods +
        "static getUniqueFamilies"
      );
    },
  );
  source = source.replace(
    /(case\s*["']freedraw["']\s*:\s*return\s+([\w$]+)\.strokeWidth\s*\*\s*12\s*;\s*case\s*["']text["']\s*:\s*return\s+[\w$]+\.fontSize\s*\/\s*2\s*;\s*default\s*:\s*return\s+)20\b/g,
    (match, prefix, element) => {
      padded = true;
      return prefix + "Math.max(20, " + element + ".strokeWidth * 12)";
    },
  );
  if (!registered || !padded)
    throw new Error(
      `Excalidraw 本地字体或端点边距适配未命中，已停止打包（字体注册：${registered ? "已命中" : "未命中"}；端点边距：${padded ? "已命中" : "未命中"}）`,
    );
  return source;
};
