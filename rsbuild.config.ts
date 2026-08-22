import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSass } from "@rsbuild/plugin-sass";

export default defineConfig({
  plugins: [pluginReact(), pluginSass()],
  source: {
    entry: {
      index: "./src/main-entry.tsx",
      litesnap: "./src/litesnap-entry.tsx",
      widget: "./src/widget-entry.tsx",
    },
  },
  html: {
    template({ entryName }) {
      if (entryName === "widget") {
        return "./widget.html";
      }
      return entryName === "litesnap" ? "./litesnap.html" : "./index.html";
    },
  },
  server: {
    host: "127.0.0.1",
    port: 13301,
    strictPort: true,
  },
});
