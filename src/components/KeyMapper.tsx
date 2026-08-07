import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { App as AntApp, Button, Modal, Select, Switch, Table, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { EngineStatus, KeyCode, KeyMapping, SupportedKey } from "../types";
import styles from "./components.module.scss";

const { Text } = Typography;

export default function KeyMapper() {
  const [mappings, setMappings] = useState<KeyMapping[]>([]);
  const [supportedKeys, setSupportedKeys] = useState<SupportedKey[]>([]);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [newSource, setNewSource] = useState<KeyCode | null>(null);
  const [newTarget, setNewTarget] = useState<KeyCode | null>(null);
  const [saving, setSaving] = useState(false);
  const { notification } = AntApp.useApp();

  useEffect(() => {
    Promise.all([
      invoke<KeyMapping[]>("get_key_mappings"),
      invoke<SupportedKey[]>("get_supported_keys"),
      invoke<EngineStatus>("get_engine_status"),
    ])
      .then(([rules, keys, status]) => {
        setMappings(rules);
        setSupportedKeys(keys);
        setEngine(status);
      })
      .catch((error) => {
        console.error(error);
        notification.error({ message: "加载按键映射失败" });
      });
  }, [notification]);

  const groupedKeys = useMemo(() => {
    return supportedKeys.reduce<Map<string, SupportedKey[]>>((groups, key) => {
      const group = groups.get(key.group) ?? [];
      group.push(key);
      groups.set(key.group, group);
      return groups;
    }, new Map());
  }, [supportedKeys]);

  const keyOptions = useMemo(
    () =>
      [...groupedKeys.entries()].map(([group, keys]) => ({
        label: group,
        options: keys.map((key) => ({ label: key.label, value: key.code })),
      })),
    [groupedKeys],
  );

  const syncMappings = useCallback(async (updated: KeyMapping[]) => {
    setSaving(true);
    try {
      await invoke("sync_key_mappings", { mappings: updated });
      setMappings(updated);
      notification.success({ message: "按键映射已更新" });
      return true;
    } catch (error) {
      notification.error({ message: "同步失败", description: String(error) });
      return false;
    } finally {
      setSaving(false);
    }
  }, [notification]);

  const addMapping = async () => {
    if (!newSource || !newTarget) {
      notification.warning({ message: "请选择源按键和目标按键" });
      return;
    }
    if (newSource === newTarget) {
      notification.warning({ message: "源按键与目标按键不能相同" });
      return;
    }
    if (mappings.some((mapping) => mapping.source_key === newSource)) {
      notification.warning({ message: "该源按键已有映射规则" });
      return;
    }

    const success = await syncMappings([
      ...mappings,
      {
        id: crypto.randomUUID(),
        source_key: newSource,
        target_key: newTarget,
        enabled: true,
      },
    ]);
    if (success) {
      setAddVisible(false);
      setNewSource(null);
      setNewTarget(null);
    }
  };

  const setEngineEnabled = async (enabled: boolean) => {
    try {
      const status = await invoke<EngineStatus>("set_engine_enabled", { enabled });
      setEngine(status);
      notification.info({ message: enabled ? "映射引擎已开启" : "映射引擎已暂停" });
    } catch (error) {
      notification.error({ message: "切换失败", description: String(error) });
    }
  };

  const columns = [
    {
      title: "源按键",
      dataIndex: "source_key",
      render: (value: KeyCode) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: "目标按键",
      dataIndex: "target_key",
      render: (value: KeyCode) => <Tag color="green">{value}</Tag>,
    },
    {
      title: "启用",
      dataIndex: "enabled",
      render: (_: boolean, record: KeyMapping) => (
        <Switch
          aria-label={`${record.source_key} 映射状态`}
          checked={record.enabled}
          loading={saving}
          onChange={(checked) => {
            void syncMappings(
              mappings.map((mapping) =>
                mapping.id === record.id ? { ...mapping, enabled: checked } : mapping,
              ),
            );
          }}
        />
      ),
    },
    {
      title: "操作",
      render: (_: unknown, record: KeyMapping) => (
        <Button
          aria-label={`删除 ${record.source_key} 映射`}
          danger
          icon={<DeleteOutlined />}
          size="small"
          disabled={saving}
          onClick={() => void syncMappings(mappings.filter((item) => item.id !== record.id))}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <Text strong>全局映射引擎</Text>
          <span className={styles.description}>
            {engine?.last_error ?? (engine?.running ? "原生键盘钩子已加载" : "键盘钩子未运行")}
          </span>
        </div>
        <Switch
          aria-label="全局映射引擎"
          checked={engine?.enabled ?? false}
          disabled={!engine || Boolean(engine.last_error)}
          onChange={(checked) => void setEngineEnabled(checked)}
        />
      </div>

      <div className={styles.toolbar}>
        <div>
          <Text strong>映射规则</Text>
          <span className={styles.description}>规则 ID 与停用状态会完整持久化</span>
        </div>
        <Button icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>
          添加规则
        </Button>
      </div>

      <Table
        className={styles.table}
        rowKey="id"
        columns={columns}
        dataSource={mappings}
        pagination={false}
        loading={saving}
        locale={{ emptyText: <Text type="secondary">暂无映射规则</Text> }}
      />

      <Modal
        title="添加按键映射"
        open={addVisible}
        onOk={() => void addMapping()}
        onCancel={() => {
          setAddVisible(false);
          setNewSource(null);
          setNewTarget(null);
        }}
        confirmLoading={saving}
        okText="添加"
        cancelText="取消"
      >
        <div className={styles.modalFields}>
          <label className={styles.field}>
            <Text strong>源按键（物理按键）</Text>
            <Select
              placeholder="请选择"
              value={newSource ?? undefined}
              options={keyOptions}
              onChange={(value) => setNewSource(value as KeyCode)}
              className={styles.fullWidth}
            />
          </label>
          <label className={styles.field}>
            <Text strong>目标按键（映射为）</Text>
            <Select
              placeholder="请选择"
              value={newTarget ?? undefined}
              options={keyOptions}
              onChange={(value) => setNewTarget(value as KeyCode)}
              className={styles.fullWidth}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
