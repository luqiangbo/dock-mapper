import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: './src/main-entry.tsx',
      widget: './src/widget-entry.tsx',
    },
  },
  html: {
    template({ entryName }) {
      return entryName === 'widget' ? './widget.html' : './index.html';
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
