import React, { useEffect, useState } from 'react';
import {
  Card,
  Typography,
  Switch,
  RadioGroup,
  Radio,
  Space,
  Divider,
  Image,
} from '@douyinfe/semi-ui';
import { IconMoon, IconSun } from '@douyinfe/semi-icons';

const { Title, Text } = Typography;

type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'dev-taskbar-tools:theme';

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

function saveTheme(theme: ThemeMode) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

function applyTheme(theme: ThemeMode) {
  const body = document.body;
  if (theme === 'dark') {
    body.setAttribute('theme-mode', 'dark');
  } else if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) body.setAttribute('theme-mode', 'dark');
    else body.removeAttribute('theme-mode');
  } else {
    body.removeAttribute('theme-mode');
  }
}

export default function GeneralSettings() {
  const [autoStart, setAutoStart] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, []);

  const handleThemeChange = (next: ThemeMode) => {
    setTheme(next);
    saveTheme(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── General options ───────────────────────────────────── */}
      <Card title="通用选项" style={{ borderRadius: 8 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <Text strong>开机自动启动</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                系统启动时自动运行本工具
              </Text>
            </div>
            <Switch
              checked={autoStart}
              onChange={setAutoStart}
            />
          </div>

          <Divider style={{ margin: '4px 0' }} />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <Text strong>最小化到系统托盘</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                关闭窗口时最小化到托盘而非退出
              </Text>
            </div>
            <Switch
              checked={minimizeToTray}
              onChange={setMinimizeToTray}
            />
          </div>
        </div>
      </Card>

      {/* ── Appearance ────────────────────────────────────────── */}
      <Card title="外观风格" style={{ borderRadius: 8 }}>
        <RadioGroup
          type="button"
          value={theme}
          onChange={(e: any) =>
            handleThemeChange(e.target.value as ThemeMode)
          }
          aria-label="主题模式"
        >
          <Radio value="light">
            <IconSun style={{ marginRight: 4 }} />
            浅色
          </Radio>
          <Radio value="dark">
            <IconMoon style={{ marginRight: 4 }} />
            深色
          </Radio>
          <Radio value="system">跟随系统</Radio>
        </RadioGroup>
      </Card>

      {/* ── About ─────────────────────────────────────────────── */}
      <Card title="关于" style={{ borderRadius: 8 }}>
        <Space align="center">
          <div>
            <Text strong style={{ fontSize: 16 }}>
              DevTaskbarTools
            </Text>
            <br />
            <Text type="secondary">版本 v1.0.0</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              基于 Tauri 2.0 + React + Semi Design 构建
            </Text>
            <br />
            <Text
              type="secondary"
              style={{ fontSize: 12, cursor: 'pointer', color: 'var(--semi-color-primary)' }}
              onClick={() => {
                // Future: open GitHub repo
              }}
            >
              反馈 / 开源地址 →
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  );
}
