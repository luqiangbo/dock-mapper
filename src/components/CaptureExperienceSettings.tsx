import { Collapse, InputNumber, Select, Switch } from "antd";
import {
  DEFAULT_CAPTURE_EXPERIENCE,
  type CaptureExperience,
} from "../screenshots/screenshot/components/captureExperience";

import styles from "./components.module.scss";

export default function CaptureExperienceSettings({
  value,
  onChange,
}: {
  value?: CaptureExperience;
  onChange?: (value: CaptureExperience) => void;
}) {
  const settings = { ...DEFAULT_CAPTURE_EXPERIENCE, ...value };
  const patch = (changes: Partial<CaptureExperience>) => onChange?.({ ...settings, ...changes });
  return (
    <div className={styles.captureExperience}>
      <div className={styles.captureToggles}>
        <label className={styles.captureToggle}>
          <Switch
            aria-label="截图前隐藏主窗口"
            checked={settings.hide_main_window}
            onChange={(hide_main_window) => patch({ hide_main_window })}
          />
          <span>截图前隐藏主窗口</span>
        </label>
        {(
          [
            ["restore_pins", "启动时恢复未关闭贴图"],
            ["grid", "放大镜显示像素网格"],
            ["hints", "显示操作提示"],
            ["guides", "显示十字辅助线"],
            ["remember_tool", "记住上次标注工具"],
            ["shared_color", "标注工具共用颜色（高亮除外）"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className={styles.captureToggle}>
            <Switch
              aria-label={label}
              checked={settings[key]}
              onChange={(checked) => patch({ [key]: checked })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <Collapse
        size="small"
        style={{ width: "100%" }}
        items={[
          {
            key: "number-defaults",
            label: "序号默认行为",
            children: (
              <div className={styles.settingsFieldGrid}>
                <label className={styles.settingsField}>
                  <span>起始序号</span>
                  <InputNumber
                    aria-label="默认起始序号"
                    min={1}
                    max={9999}
                    value={settings.number_start}
                    onChange={(value) => patch({ number_start: value ?? 1 })}
                  />
                </label>
                <label className={styles.settingsField}>
                  <span>编号格式</span>
                  <Select
                    aria-label="默认序号格式"
                    value={settings.number_format}
                    options={[
                      { value: "decimal", label: "数字 1, 2, 3" },
                      { value: "alpha", label: "字母 A, B, C" },
                      { value: "roman", label: "罗马 I, II, III" },
                    ]}
                    onChange={(number_format) => patch({ number_format })}
                  />
                </label>
                <label className={styles.settingsField}>
                  <span>删除后自动递补</span>
                  <span className={styles.settingsSwitchControl}>
                    <Switch
                      aria-label="删除后自动递补"
                      checked={settings.number_renumber}
                      onChange={(number_renumber) => patch({ number_renumber })}
                    />
                  </span>
                </label>
              </div>
            ),
          },
        ]}
      />
      <div className={styles.settingsFieldGrid}>
        <label className={styles.settingsField}>
          <span>检测方式</span>
          <Select
            aria-label="截图检测方式"
            value={settings.detection}
            onChange={(detection) => patch({ detection })}
            options={[
              { value: "elements", label: "检测 UI 元素" },
              { value: "windows", label: "仅检测窗口" },
              { value: "manual", label: "手动框选" },
            ]}
          />
        </label>
        <label className={styles.settingsField}>
          <span>已关闭贴图记录</span>
          <InputNumber
            min={0}
            max={100}
            value={settings.pin_history_limit}
            onChange={(v) => patch({ pin_history_limit: v ?? 20 })}
          />
        </label>
        <label className={styles.settingsField}>
          <span>放大倍数</span>
          <InputNumber
            min={4}
            max={24}
            value={settings.zoom}
            onChange={(v) => patch({ zoom: v ?? 8 })}
          />
        </label>
        <label className={styles.settingsField}>
          <span>历史区域</span>
          <InputNumber
            min={0}
            max={100}
            value={settings.region_limit}
            onChange={(v) =>
              patch({ region_limit: v ?? 10, regions: settings.regions.slice(0, v ?? 10) })
            }
          />
        </label>
      </div>
      <div className={styles.settingsFieldGrid}>
        <label className={styles.settingsField}>
          <span>圆角</span>
          <InputNumber
            min={0}
            max={200}
            suffix="px"
            value={settings.radius}
            onChange={(v) => patch({ radius: v ?? 0 })}
          />
        </label>
        <label className={styles.settingsField}>
          <span>边框</span>
          <InputNumber
            min={0}
            max={32}
            suffix="px"
            value={settings.border}
            onChange={(v) => patch({ border: v ?? 0 })}
          />
        </label>
        <label className={styles.settingsField}>
          <span>阴影</span>
          <InputNumber
            min={0}
            max={64}
            suffix="px"
            value={settings.shadow}
            onChange={(v) => patch({ shadow: v ?? 0 })}
          />
        </label>
      </div>
    </div>
  );
}
