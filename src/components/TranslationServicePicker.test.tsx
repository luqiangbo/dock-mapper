import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationServicePicker, serviceSwitchAction } from "./TranslationServicePicker";
import { TRANSLATION_PROVIDERS, type TranslationProvider } from "../api/translation";

describe("自由切换翻译服务", () => {
  it.each(TRANSLATION_PROVIDERS)("恢复 $label 的下拉选择", ({ value, label }) => {
    const html = renderToStaticMarkup(
      <TranslationServicePicker
        value={value as TranslationProvider}
        busy={false}
        onSwitch={() => {}}
      />,
    );
    expect(html).toContain(label);
    expect(html).toContain("ant-select");
    expect(html).not.toContain("ant-select-disabled");
  });
  it("切换无需确认，保存中阻止重复切换", () => {
    expect(serviceSwitchAction("baidu", "deepl", false)).toBe("switch");
    expect(serviceSwitchAction("deepl", "baidu", false)).toBe("switch");
    expect(serviceSwitchAction("baidu", "baidu", false)).toBe("ignore");
    expect(serviceSwitchAction("baidu", "deepl", true)).toBe("ignore");
  });
});
