import type { KeyCode, SupportedKey } from "../types";

export interface MappingKeyOption {
  label: string;
  value: KeyCode;
  search: string;
  disabled?: boolean;
}
const groupOrder = ["修饰键", "常用编辑键", "方向与导航", "功能键", "特殊操作"] as const;
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "");
export const isCharacterKey = (code: string) => /^(?:Key[A-Z]|Num[0-9]|Kp[0-9])$/.test(code);
export function mappingKeyLabel(code: string, keys: SupportedKey[]) {
  return keys.find((key) => key.code === code)?.label ?? code;
}
export function mappingKeyOptions(
  keys: SupportedKey[],
  side: "source" | "target",
  existing?: KeyCode,
) {
  const groups = groupOrder
    .map((label) => ({
      label: label as string,
      options: keys
        .filter(
          (key) =>
            key.group === label &&
            !isCharacterKey(key.code) &&
            (side === "target" || key.code !== "Disabled"),
        )
        .map((key): MappingKeyOption => ({
          label: key.label,
          value: key.code,
          search: normalize(`${key.label} ${key.code}`),
        })),
    }))
    .filter((group) => group.options.length > 0);
  if (existing && !groups.some((group) => group.options.some((key) => key.value === existing))) {
    const label = `${mappingKeyLabel(existing, keys)}（已有规则）`;
    groups.push({
      label: "已有规则",
      options: [
        { label, value: existing, search: normalize(`${label} ${existing}`), disabled: true },
      ],
    });
  }
  return groups;
}
export function matchesMappingKey(query: string, option?: { search?: string }) {
  return (option?.search ?? "").includes(normalize(query));
}
export function legacyNeedsAttention(
  status: import("../types").KeyMappingStatus | null,
  readError: string | null,
) {
  return (
    !!readError ||
    (!!status &&
      (!status.legacy ||
        status.legacy.present ||
        !!status.legacy.parse_error ||
        status.legacy.waiting_restart))
  );
}
