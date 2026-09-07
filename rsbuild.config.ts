import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSass } from "@rsbuild/plugin-sass";

export default defineConfig({
  plugins: [pluginReact(), pluginSass()],
  source: {
    entry: {
      index: "./src/main-entry.tsx",
      screenshot: "./src/screenshot-entry.tsx",
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
      return entryName === "screenshot" ? "./screenshot.html" : "./index.html";
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
