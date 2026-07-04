import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Card,
  Typography,
  Button,
  Banner,
  Space,
  Tag,
  Spin,
} from '@douyinfe/semi-ui';
import {
  IconAlertCircle,
  IconKey,
  IconArrowUp,
  IconArrowDown,
} from '@douyinfe/semi-icons';

const { Title, Text } = Typography;

interface SysStatus {
  upload_speed: number;
  download_speed: number;
  memory_usage: number;
}

export default function Dashboard() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [sysStatus, setSysStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
  });

  useEffect(() => {
    invoke<boolean>('check_is_admin')
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));

    // Listen for live sys status (if the widget listener is already running)
    import('@tauri-apps/api/event').then(({ listen }) => {
      const unlistenPromise = listen<SysStatus>('sys-status-update', (e) => {
        setSysStatus(e.payload);
      });
      return () => {
        unlistenPromise.then((f) => f());
      };
    });
  }, []);

  const handleRelaunchAdmin = () => {
    invoke('relaunch_as_admin');
  };

  const formatTotal = (bytesPerSec: number): string => {
    // Approximate cumulative for "today" (just show per-second as a live value)
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    const kb = bytesPerSec / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
    return `${(kb / 1024).toFixed(1)} MB/s`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Card 1: Admin status ─────────────────────────────── */}
      <Card
        title={
          <Space>
            <IconAlertCircle size="large" />
            <span>权限状态</span>
          </Space>
        }
        style={{ borderRadius: 8 }}
      >
        {isAdmin === null ? (
          <Spin />
        ) : isAdmin ? (
          <Space vertical align="start" style={{ width: '100%' }}>
            <Tag color="green" size="large" style={{ padding: '4px 12px' }}>
              ✅ 以管理员权限运行
            </Tag>
            <Text type="secondary" style={{ marginTop: 4 }}>
              全局键盘映射在所有窗口中正常工作。
            </Text>
          </Space>
        ) : (
          <Space vertical align="start" style={{ width: '100%' }}>
            <Banner
              type="warning"
              closeIcon={null}
              title="权限不足"
              description="未以管理员身份运行，部分高权限窗口的键盘映射将失效。"
              extra={
                <Button theme="solid" type="warning" onClick={handleRelaunchAdmin}>
                  以管理员身份重启
                </Button>
              }
              style={{ width: '100%', marginBottom: 0 }}
            />
          </Space>
        )}
      </Card>

      {/* ── Card 2: Keyboard hook engine ─────────────────────── */}
      <Card
        title={
          <Space>
            <IconKey size="large" />
            <span>键盘钩子引擎</span>
          </Space>
        }
        style={{ borderRadius: 8 }}
      >
        <Space align="center">
          <Tag color="green" size="large" style={{ padding: '4px 12px' }}>
            ● 运行中
          </Tag>
          <Text type="secondary">全局键盘映射引擎已就绪</Text>
        </Space>
      </Card>

      {/* ── Card 3: Live traffic ─────────────────────────────── */}
      <Card
        title={
          <Space>
            <span>实时流量</span>
          </Space>
        }
        style={{ borderRadius: 8 }}
      >
        <div
          style={{
            display: 'flex',
            gap: 40,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Space>
            <IconArrowUp size="large" style={{ color: 'var(--semi-color-success)' }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                上传
              </Text>
              <br />
              <Text strong style={{ fontSize: 18 }}>
                {formatTotal(sysStatus.upload_speed)}
              </Text>
            </div>
          </Space>
          <Space>
            <IconArrowDown size="large" style={{ color: 'var(--semi-color-warning)' }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                下载
              </Text>
              <br />
              <Text strong style={{ fontSize: 18 }}>
                {formatTotal(sysStatus.download_speed)}
              </Text>
            </div>
          </Space>
          <Space>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                内存
              </Text>
              <br />
              <Text strong style={{ fontSize: 18 }}>
                {sysStatus.memory_usage.toFixed(0)}%
              </Text>
            </div>
          </Space>
        </div>
      </Card>
    </div>
  );
}
