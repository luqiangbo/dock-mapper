import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Select, Space } from "antd";
import { invokeCommand } from "../api/ipc";
import { screenshotSettingsApi } from "../api/commands";
import styles from "./components.module.scss";
import {
  DEFAULT_CAPTURE_EXPERIENCE,
  type CaptureExperience,
} from "../screenshots/screenshot/components/captureExperience";

export default function ScheduledCapture() {
  const [open, setOpen] = useState(false),
    [delay, setDelay] = useState(3),
    [region, setRegion] = useState(-1);
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  const [experience, setExperience] = useState<CaptureExperience>(DEFAULT_CAPTURE_EXPERIENCE);
  const [remaining, setRemaining] = useState<number | null>(null),
    [saving, setSaving] = useState(false);
  const request = useRef(0);
  const restoring = useRef(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    void screenshotSettingsApi
      .get()
      .then((config) => {
        if (request.current === id)
          setExperience({ ...DEFAULT_CAPTURE_EXPERIENCE, ...config.experience });
      })
      .catch((e) => setError(`预设读取失败：${String(e)}`));
    return () => {
      request.current++;
    };
  }, [open]);
  useEffect(() => {
    if (remaining === null) return;
    const interval = window.setInterval(
      () => setRemaining((value) => (value === null ? null : Math.max(0, value - 1))),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [remaining === null]);
  const cancel = async () => {
    request.current++;
    try {
      await invokeCommand("schedule_screenshot", { delayMs: 0, cancel: true });
      setRemaining(null);
      setOpen(false);
    } catch (e) {
      setError(`取消失败：${String(e)}`);
    }
  };
  return (
    <>
      <Space>
        <Button
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          延时／区域预设
        </Button>
        <Button
          loading={restoreBusy}
          onClick={() => {
            if (restoring.current) return;
            restoring.current = true;
            setRestoreBusy(true);
            void invokeCommand("restore_closed_pin")
              .catch((e) => {
                setOpen(true);
                setError(String(e));
              })
              .finally(() => {
                restoring.current = false;
                setRestoreBusy(false);
              });
          }}
        >
          恢复关闭的贴图
        </Button>
      </Space>
      <Modal
        open={open}
        title="延时与区域预设"
        cancelText="取消"
        onCancel={() => void cancel()}
        okText={remaining === null ? "开始倒计时" : `${remaining} 秒后截图`}
        confirmLoading={remaining !== null}
        onOk={() => {
          const id = ++request.current;
          const selected = experience.regions[region];
          setError("");
          setRemaining(delay);
          void invokeCommand("schedule_screenshot", {
            delayMs: delay * 1000,
            cancel: false,
            selection: selected,
            physical: selected?.physical,
            screenId:
              selected && Number.isFinite(Number(selected.screen))
                ? Number(selected.screen)
                : undefined,
          })
            .then((generation) => {
              if (request.current === id) {
                setRemaining(null);
                if (generation !== null) setOpen(false);
              }
            })
            .catch((e) => {
              if (request.current === id) {
                setRemaining(null);
                setError(`延时截图失败：${String(e)}`);
              }
            });
        }}
      >
        <div className={styles.captureExperience}>
          <label className={styles.settingsField}>
            <span>延时秒数</span>
            <InputNumber
              min={0}
              max={60}
              value={delay}
              disabled={remaining !== null}
              onChange={(v) => setDelay(v ?? 3)}
            />
          </label>
          <label className={styles.settingsField}>
            <span>截图区域</span>
            <Select
              aria-label="截图区域"
              style={{ width: "100%" }}
              value={region}
              disabled={remaining !== null}
              onChange={setRegion}
              options={[
                { value: -1, label: "截图时手动选择" },
                ...experience.regions.map((r, index) => ({
                  value: index,
                  label: `${Math.round(r.width)} × ${Math.round(r.height)} · 显示器 ${r.screen}`,
                })),
              ]}
            />
          </label>
          {!experience.regions.length && (
            <Alert type="info" title="暂无区域记录，先框选一次截图即可在这里复用。" />
          )}
          <label className={styles.settingsField}>
            <span>已保存预设</span>
            <Select
              aria-label="已保存预设"
              placeholder="选择已保存预设"
              style={{ width: "100%" }}
              disabled={remaining !== null}
              options={experience.presets.map((p, index) => ({ value: index, label: p.name }))}
              onChange={(index) => {
                const preset = experience.presets[index];
                setDelay(preset.delay_ms / 1000);
                if (preset.region) {
                  const next = [...experience.regions, preset.region];
                  setExperience({ ...experience, regions: next });
                  setRegion(next.length - 1);
                } else setRegion(-1);
              }}
            />
          </label>
          <div className={styles.scheduledPresetRow}>
            <Input
              aria-label="预设名称"
              placeholder="预设名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              loading={saving}
              disabled={!name.trim() || remaining !== null}
              onClick={() => {
                setSaving(true);
                setError("");
                void screenshotSettingsApi
                  .get()
                  .then(async (config) => {
                    const current = { ...DEFAULT_CAPTURE_EXPERIENCE, ...config.experience };
                    const preset = {
                      name: name.trim(),
                      delay_ms: delay * 1000,
                      region: experience.regions[region] ?? null,
                    };
                    const next = {
                      ...current,
                      presets: [
                        preset,
                        ...current.presets.filter((p) => p.name !== preset.name),
                      ].slice(0, 20),
                    };
                    const saved = await screenshotSettingsApi.update({
                      ...config,
                      experience: next,
                    });
                    setExperience({ ...DEFAULT_CAPTURE_EXPERIENCE, ...saved.experience });
                    setName("");
                  })
                  .catch((e) => setError(`预设保存失败：${String(e)}`))
                  .finally(() => setSaving(false));
              }}
            >
              保存预设
            </Button>
          </div>
          {remaining !== null && (
            <Alert
              type="info"
              title={`请切换到目标应用，并将鼠标移到目标显示器。剩余 ${remaining} 秒。`}
            />
          )}
          {error && <Alert type="error" title={error} />}
        </div>
      </Modal>
    </>
  );
}
