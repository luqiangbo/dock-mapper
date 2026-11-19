import { useCallback, useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Select, Space, Typography } from "antd";
import { useTheme } from "../ThemeContext";
import { usePageActive } from "./PageActivity";
import { invokeCommand } from "../api/ipc";
import { errorMessage } from "../api/commands";
import { fontOptions, fontStack } from "../uiFont";

export default function UiFontSettings() {
  const active = usePageActive();
  const { uiFont, fontError, fontLoading, retryFont } = useTheme();
  const { notification } = AntApp.useApp();
  const [fonts, setFonts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState(uiFont);
  useEffect(() => {
    if (!saving) setDraft(uiFont);
  }, [uiFont, saving]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    void invokeCommand("list_system_fonts")
      .then((value) => {
        if (!disposed) {
          setFonts(value);
          setError(null);
        }
      })
      .catch((error) => {
        if (!disposed) setError(`读取本机字体失败：${errorMessage(error)}`);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [active, attempt]);
  const change = useCallback(
    async (font: string) => {
      setDraft(font);
      setSaving(true);
      try {
        await invokeCommand("set_ui_font", { font });
        retryFont();
        notification.success({ message: "界面字体已保存" });
      } catch (error) {
        notification.error({ message: "修改界面字体失败", description: errorMessage(error) });
        retryFont();
      } finally {
        setSaving(false);
      }
    },
    [notification, retryFont],
  );
  const options = fontOptions(fonts ?? [], draft);
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Text strong>界面字体</Typography.Text>
      <Space wrap>
        <Select
          aria-label="界面字体"
          showSearch
          optionFilterProp="label"
          value={draft}
          options={options}
          loading={loading || saving || fontLoading}
          disabled={loading || saving || fontLoading || fonts === null}
          style={{ width: 260, maxWidth: "100%" }}
          notFoundContent="未找到匹配字体"
          onChange={(value) => void change(value)}
        />
        <Button
          disabled={loading || saving}
          onClick={() => {
            setAttempt((value) => value + 1);
            retryFont();
          }}
        >
          刷新字体
        </Button>
        <Button disabled={!draft || saving || fontLoading} onClick={() => void change("")}>
          恢复默认字体
        </Button>
      </Space>
      <Typography.Text style={{ fontFamily: fontStack(draft) }}>
        字体预览：截图与效率工具 AaBb 0123456789
      </Typography.Text>
      <Typography.Text type="secondary">
        使用本机字体，保存后同步各窗口。截图标注字体单独设置。
      </Typography.Text>
      {(error || fontError) && (
        <Alert
          type="error"
          title={error || fontError}
          action={
            <Button
              size="small"
              onClick={() => {
                setAttempt((value) => value + 1);
                retryFont();
              }}
            >
              重试
            </Button>
          }
        />
      )}
      {!loading && fonts?.length === 0 && (
        <Alert type="info" title="未读取到可选字体，可继续使用系统默认字体或刷新重试" />
      )}
      {fonts && draft && !fonts.includes(draft) && (
        <Alert type="warning" title="保存的字体当前不可用，已使用系统回退字体" />
      )}
    </Space>
  );
}
