import { installBrowserContextMenuPolicy } from "./browserContextMenu";
const dispose = installBrowserContextMenuPolicy(document);
const hot = (import.meta as ImportMeta & { webpackHot?: { dispose(callback: () => void): void } })
  .webpackHot;
hot?.dispose(dispose);
