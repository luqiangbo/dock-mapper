import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSass } from "@rsbuild/plugin-sass";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let commit = process.env.DOCKMAPPER_COMMIT ?? "";
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    console.warn("无法读取开发提交信息，关于页面将显示提交未知。");
  }
}
const releaseVersion = process.env.DOCKMAPPER_RELEASE_VERSION ?? "";
if (releaseVersion) {
  const cargoVersion = readFileSync("src-tauri/Cargo.toml", "utf8").match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
  if (cargoVersion !== releaseVersion || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("发布版本或提交信息与构建源码不一致");
  }
}

export default defineConfig({
  plugins: [pluginReact(), pluginSass()],
  source: {
    define: {
      __DOCKMAPPER_BUILD__: JSON.stringify({ releaseVersion, commit }),
    },
    entry: {
      index: "./src/main-entry.tsx",
      screenshot: "./src/screenshot-entry.tsx",
      pin: "./src/pin-entry.tsx",
      "history-preview": "./src/history-preview-entry.tsx",
      widget: "./src/widget-entry.tsx",
      "key-visualizer-effects": "./src/key-visualizer-effects-entry.tsx",
      "key-visualizer": "./src/key-visualizer-entry.tsx",
    },
  },
  html: {
    template({ entryName }) {
      if (entryName === "key-visualizer-effects") return "./key-visualizer-effects.html";
      if (entryName === "widget") {
        return "./widget.html";
      }
      if (entryName === "key-visualizer") {
        return "./key-visualizer.html";
      }
      if (entryName === "screenshot") return "./screenshot.html";
      if (entryName === "history-preview") return "./history-preview.html";
      if (entryName === "pin") return "./pin.html";
      return "./index.html";
    },
  },
  output: {
    copy: [
      {
        from: "./node_modules/@excalidraw/excalidraw/dist/prod/fonts",
        to: "excalidraw/fonts",
        noErrorOnMissing: false,
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 21420,
    strictPort: true,
  },
});
