import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Table,
  Button,
  Modal,
  Form,
  Select,
  Tag,
  Notification,
  Switch,
  Typography,
  Space,
  Divider,
} from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';

const { Text } = Typography;

// ─── Available keys ─────────────────────────────────────────────────────
const AVAILABLE_KEYS = [
  'CapsLock', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'Alt', 'AltGr', 'MetaLeft', 'MetaRight',
  'Tab', 'Escape', 'Space', 'Return', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'KeyA','KeyB','KeyC','KeyD','KeyE','KeyF','KeyG','KeyH','KeyI','KeyJ',
  'KeyK','KeyL','KeyM','KeyN','KeyO','KeyP','KeyQ','KeyR','KeyS','KeyT',
  'KeyU','KeyV','KeyW','KeyX','KeyY','KeyZ',
  'Num0','Num1','Num2','Num3','Num4','Num5','Num6','Num7','Num8','Num9',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'Kp0','Kp1','Kp2','Kp3','Kp4','Kp5','Kp6','Kp7','Kp8','Kp9',
];

interface KeyMapping {
  id: string;
  source_key: string;
  target_key: string;
  enabled: boolean;
}

export default function KeyMapper() {
  const [mappings, setMappings] = useState<KeyMapping[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [engineOn, setEngineOn] = useState(true);

  // Load mappings on mount
  useEffect(() => {
    invoke<KeyMapping[]>('get_key_mappings')
      .then((data) => setMappings(data))
      .catch((err) => {
        console.error('Failed to load key mappings:', err);
        Notification.error({ content: '加载按键映射失败' });
      });
  }, []);

  const syncMappings = useCallback((updated: KeyMapping[]) => {
    invoke('sync_key_mappings', { mappings: updated })
      .then(() => Notification.success({ content: '按键映射已更新' }))
      .catch((err) => {
        console.error('Failed to sync key mappings:', err);
        Notification.error({ content: '同步按键映射失败' });
      });
  }, []);

  const handleAddMapping = () => {
    if (!newSource || !newTarget) {
      Notification.warning({ content: '请选择源按键和目标按键' });
      return;
    }
    if (newSource === newTarget) {
      Notification.warning({ content: '源按键和目标按键不能相同' });
      return;
    }
    const newMapping: KeyMapping = {
      id: crypto.randomUUID(),
      source_key: newSource,
      target_key: newTarget,
      enabled: true,
    };
    const updated = [...mappings, newMapping];
    setMappings(updated);
    syncMappings(updated);
    setAddVisible(false);
    setNewSource('');
    setNewTarget('');
  };

  const handleDelete = (id: string) => {
    const updated = mappings.filter((m) => m.id !== id);
    setMappings(updated);
    syncMappings(updated);
  };

  const handleToggle = (id: string, checked: boolean) => {
    const updated = mappings.map((m) =>
      m.id === id ? { ...m, enabled: checked } : m,
    );
    setMappings(updated);
    syncMappings(updated);
  };

  const columns = [
    {
      title: '源按键',
      dataIndex: 'source_key',
      key: 'source_key',
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '目标按键',
      dataIndex: 'target_key',
      key: 'target_key',
      render: (text: string) => <Tag color="green">{text}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (_: boolean, record: KeyMapping) => (
        <span
          style={{
            cursor: 'pointer',
            color: record.enabled
              ? 'var(--semi-color-success)'
              : 'var(--semi-color-danger)',
          }}
          onClick={() => handleToggle(record.id, !record.enabled)}
        >
          {record.enabled ? '✅ 启用' : '⛔ 停用'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'operation',
      render: (_: unknown, record: KeyMapping) => (
        <Button
          type="danger"
          icon={<IconDelete />}
          size="small"
          onClick={() => handleDelete(record.id)}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Global engine switch ──────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text strong>全局映射引擎</Text>
        <Switch
          checked={engineOn}
          onChange={(v) => {
            setEngineOn(v);
            // In the future, this can notify the Rust backend to pause/resume
            Notification.info({
              content: v ? '映射引擎已开启' : '映射引擎已暂停',
            });
          }}
        />
      </div>

      <Divider />

      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text strong>映射规则</Text>
        <Button
          icon={<IconPlus />}
          type="primary"
          onClick={() => setAddVisible(true)}
        >
          添加新规则
        </Button>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      <Table
        columns={columns}
        dataSource={mappings}
        pagination={false}
        empty={
          <Text style={{ color: 'var(--semi-color-text-2)' }}>
            暂无映射规则，点击上方按钮添加
          </Text>
        }
      />

      {/* ── Add modal ─────────────────────────────────────────── */}
      <Modal
        title="添加按键映射"
        visible={addVisible}
        onOk={handleAddMapping}
        onCancel={() => {
          setAddVisible(false);
          setNewSource('');
          setNewTarget('');
        }}
        okText="确认添加"
        cancelText="取消"
      >
        <Form>
          <Form.Select
            field="source_key"
            label="源按键（物理按键）"
            placeholder="请选择"
            value={newSource}
            onChange={(v: string) => setNewSource(v)}
            style={{ width: '100%' }}
          >
            {AVAILABLE_KEYS.map((k) => (
              <Select.Option key={k} value={k}>
                {k}
              </Select.Option>
            ))}
          </Form.Select>
          <Form.Select
            field="target_key"
            label="目标按键（映射为）"
            placeholder="请选择"
            value={newTarget}
            onChange={(v: string) => setNewTarget(v)}
            style={{ width: '100%', marginTop: 16 }}
          >
            {AVAILABLE_KEYS.map((k) => (
              <Select.Option key={k} value={k}>
                {k}
              </Select.Option>
            ))}
          </Form.Select>
        </Form>
      </Modal>
    </div>
  );
}
