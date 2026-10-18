import { describe, expect, it } from "vitest";
import type { KeyCode, KeyMappingStatus, SupportedKey } from "../types";
import {
  legacyNeedsAttention,
  mappingKeyLabel,
  mappingKeyOptions,
  matchesMappingKey,
} from "./keyMappingPresentation";
const code = (value: string) => value as KeyCode;
const keys: SupportedKey[] = [
  { code: code("Disabled"), label: "禁用按键", group: "特殊操作" },
  { code: code("F1"), label: "F1", group: "功能键" },
  { code: code("ArrowUp"), label: "↑ 上", group: "方向与导航" },
  { code: code("Return"), label: "回车 Enter", group: "常用编辑键" },
  { code: code("ControlLeft"), label: "左 Ctrl", group: "修饰键" },
  { code: code("Alt"), label: "左 Alt", group: "修饰键" },
  { code: code("AltRight"), label: "右 Alt", group: "修饰键" },
  ...["KeyA", "KeyZ", "Num0", "Num1", "Kp0", "Kp9"].map((value) => ({
    code: code(value),
    label: value,
    group: "字母和数字",
  })),
];
describe("简洁的按键选择", () => {
  it("源键和目标键都能独立选择和搜索右 Alt", () => {
    for (const side of ["source", "target"] as const) {
      const options = mappingKeyOptions(keys, side).flatMap((group) => group.options);
      expect(
        options
          .filter((option) => matchesMappingKey("右alt", option))
          .map((option) => option.value),
      ).toEqual(["AltRight"]);
      expect(
        options
          .filter((option) => matchesMappingKey("AltRight", option))
          .map((option) => option.value),
      ).toEqual(["AltRight"]);
      expect(
        options
          .filter((option) => matchesMappingKey("左alt", option))
          .map((option) => option.value),
      ).toEqual(["Alt"]);
    }
  });
  it("按固定分组排列，源键和目标键都排除字母及全部数字", () => {
    for (const side of ["source", "target"] as const) {
      const options = mappingKeyOptions(keys, side);
      expect(options.slice(0, 4).map((group) => group.label)).toEqual([
        "修饰键",
        "常用编辑键",
        "方向与导航",
        "功能键",
      ]);
      expect(
        options.flatMap((group) => group.options).some((key) => /^(Key|Num|Kp)/.test(key.value)),
      ).toBe(false);
    }
  });
  it("禁用按键只出现在目标选择器", () => {
    expect(
      mappingKeyOptions(keys, "source")
        .flatMap((group) => group.options)
        .some((key) => key.value === "Disabled"),
    ).toBe(false);
    const groups = mappingKeyOptions(keys, "target");
    expect(groups[groups.length - 1]?.options[0].value).toBe("Disabled");
  });
  it("旧字符规则只在当前编辑字段回显，不变成新规则选项", () => {
    const groups = mappingKeyOptions(keys, "source", code("KeyA"));
    const old = groups[groups.length - 1]?.options[0];
    expect(old).toMatchObject({ label: "KeyA（已有规则）", value: "KeyA", disabled: true });
    expect(
      mappingKeyOptions(keys, "source")
        .flatMap((group) => group.options)
        .some((key) => key.value === "KeyA"),
    ).toBe(false);
    expect(keys.some((key) => key.code === "KeyA")).toBe(true);
  });
  it("统一友好名称并支持中文、英文及内部键名搜索", () => {
    expect(mappingKeyLabel("ControlLeft", keys)).toBe("左 Ctrl");
    const options = mappingKeyOptions(keys, "source").flatMap((group) => group.options);
    expect(
      options.filter((option) => matchesMappingKey("左ctrl", option)).map((option) => option.value),
    ).toEqual(["ControlLeft"]);
    expect(options.filter((option) => matchesMappingKey("CONTROLLEFT", option))).toHaveLength(1);
    expect(options.filter((option) => matchesMappingKey("enter", option))).toHaveLength(1);
    expect(mappingKeyLabel("0xE077", keys)).toBe("0xE077");
  });
  it("读取失败时展开遗留区域，不将失败当作没有映射", () => {
    expect(legacyNeedsAttention(null, "读取失败")).toBe(true);
    expect(legacyNeedsAttention(null, null)).toBe(false);
  });
  it("干净的系统默认收起，遗留、格式异常和等待重启时展开", () => {
    const clean: KeyMappingStatus = {
      state: "no_rules",
      enabled: true,
      rule_count: 0,
      error: null,
      legacy: { present: false, value: null, rules: [], parse_error: null, waiting_restart: false },
    };
    expect(legacyNeedsAttention(clean, null)).toBe(false);
    for (const change of [
      { present: true },
      { parse_error: "格式异常" },
      { waiting_restart: true },
    ]) {
      expect(
        legacyNeedsAttention({ ...clean, legacy: { ...clean.legacy!, ...change } }, null),
      ).toBe(true);
    }
  });
});
