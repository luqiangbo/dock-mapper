import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
describe("全窗口右键策略入口", () => {
  it("所有现有窗口入口挂载相同策略", () => {
    for (const entry of [
      "main",
      "screenshot",
      "pin",
      "history-preview",
      "widget",
      "key-visualizer",
      "key-visualizer-effects",
    ]) {
      expect(readFileSync(new URL(`../${entry}-entry.tsx`, import.meta.url), "utf8")).toContain(
        'import "./utils/disableBrowserContextMenu"',
      );
    }
  });
});
