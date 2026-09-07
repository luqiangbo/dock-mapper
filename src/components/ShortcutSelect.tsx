import { Button, Select, Tooltip } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import {
  parseShortcut,
  serializeShortcut,
  SHORTCUT_KEYS,
  SHORTCUT_MODIFIERS,
} from "../utils/shortcut";
import styles from "./components.module.scss";

interface ShortcutSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export default function ShortcutSelect({
  value = "",
  onChange,
  disabled,
  "aria-label": ariaLabel = "快捷键",
}: ShortcutSelectProps) {
  const parsed = parseShortcut(value);
  const modifiers = parsed?.modifiers ?? ["Control"];
  const key = parsed?.key;

  const update = (nextModifiers: string[], nextKey = key) => {
    if (!nextKey) return;
    const shortcut = serializeShortcut({ modifiers: nextModifiers, key: nextKey });
    if (shortcut) onChange?.(shortcut);
  };

  const modifierOptions = (index: number) =>
    SHORTCUT_MODIFIERS.map((option) => ({
      ...option,
      disabled: modifiers.some(
        (modifier, current) => current !== index && modifier === option.value,
      ),
    }));

  return (
    <div className={styles.shortcutSelectField} aria-label={ariaLabel}>
      <div className={styles.shortcutSelectControls}>
        <Select
          aria-label={`${ariaLabel}修饰键`}
          value={modifiers[0]}
          disabled={disabled}
          options={modifierOptions(0)}
          onChange={(modifier) => update([modifier, ...modifiers.slice(1)])}
        />
        <span className={styles.shortcutPlus}>+</span>
        {modifiers.length === 2 && (
          <>
            <Select
              aria-label={`${ariaLabel}第二修饰键`}
              value={modifiers[1]}
              disabled={disabled}
              options={modifierOptions(1)}
              onChange={(modifier) => update([modifiers[0], modifier])}
            />
            <span className={styles.shortcutPlus}>+</span>
          </>
        )}
        <Select
          className={styles.shortcutPrimaryKey}
          aria-label={`${ariaLabel}主键`}
          value={key}
          status={value && !parsed ? "error" : undefined}
          disabled={disabled}
          showSearch
          optionFilterProp="label"
          placeholder="主键"
          options={SHORTCUT_KEYS}
          onChange={(nextKey) => update(modifiers, nextKey)}
        />
        {modifiers.length === 1 ? (
          <Tooltip title="增加第二个修饰键">
            <Button
              aria-label="增加第二个修饰键"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => update([...modifiers, modifiers[0] === "Shift" ? "Alt" : "Shift"])}
            />
          </Tooltip>
        ) : (
          <Tooltip title="移除第二个修饰键">
            <Button
              aria-label="移除第二个修饰键"
              icon={<MinusOutlined />}
              disabled={disabled}
              onClick={() => update([modifiers[0]])}
            />
          </Tooltip>
        )}
      </div>
      {value && !parsed && (
        <span className={styles.shortcutSelectError}>当前快捷键不受支持，请重新选择</span>
      )}
    </div>
  );
}
