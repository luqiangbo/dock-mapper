import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, App as AntApp, Button, Modal, Select, Switch, Table, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { KeyCode, KeyMapping, ScancodeMapStatus, SupportedKey } from "../types";
import styles from "./components.module.scss";

const { Text } = Typography;

export default function KeyMapper() {
  const [mappings, setMappings] = useState<KeyMapping[]>([]);
  const [supportedKeys, setSupportedKeys] = useState<SupportedKey[]>([]);
  const [mapStatus, setMapStatus] = useState<ScancodeMapStatus | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [newSource, setNewSource] = useState<KeyCode | null>(null);
  const [newTarget, setNewTarget] = useState<KeyCode | null>(null);
  const [saving, setSaving] = useState(false);
  const { modal, notification } = AntApp.useApp();

  useEffect(() => {
    Promise.all([
      invoke<KeyMapping[]>("get_key_mappings"),
      invoke<SupportedKey[]>("get_supported_keys"),
      invoke<ScancodeMapStatus>("get_scancode_map_status"),
    ])
      .then(([rules, keys, status]) => {
        setMappings(rules);
        setSupportedKeys(keys);
        setMapStatus(status);
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
  const sourceKeyOptions = useMemo(
    () =>
      keyOptions.map((group) => ({
        ...group,
        options: group.options.filter((key) => key.value !== "Disabled"),
      })),
    [keyOptions],
  );

  const syncMappings = useCallback(
    async (updated: KeyMapping[]) => {
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
    },
    [notification],
  );

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

  const applyToSystem = async (confirmTakeover = false) => {
    setSaving(true);
    try {
      const status = await invoke<ScancodeMapStatus>("apply_scancode_map", { confirmTakeover });
      setMapStatus(status);
      notification.success({
        message: "系统映射已写入",
        description: "请重新登录或重启 Windows 后生效。",
      });
    } catch (error) {
      const text = String(error);
      if (text.includes("确认备份后接管")) {
        modal.confirm({
          title: "检测到其他工具的键盘映射",
          content: "DockMapper 会备份当前 Scancode Map 后接管。恢复时可写回该备份。",
          okText: "备份并接管",
          cancelText: "取消",
          onOk: () => applyToSystem(true),
        });
      } else {
        notification.error({ message: "写入系统映射失败", description: text });
      }
    } finally {
      setSaving(false);
    }
  };

  const restoreOriginal = async () => {
    setSaving(true);
    try {
      const status = await invoke<ScancodeMapStatus>("restore_scancode_map");
      setMapStatus(status);
      notification.success({
        message: "已恢复应用前映射",
        description: "请重新登录或重启 Windows 后生效。",
      });
    } catch (error) {
      notification.error({ message: "恢复失败", description: String(error) });
    } finally {
      setSaving(false);
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
          <Text strong>系统扫描码映射</Text>
          <span className={styles.description}>
            {mapStatus?.applied
              ? "已写入系统，重新登录或重启后生效"
              : "编辑规则后，使用管理员权限应用到系统"}
          </span>
        </div>
        <div className={styles.actionRow}>
          <Button loading={saving} onClick={() => void applyToSystem()}>
            应用到系统
          </Button>
          <Button
            disabled={!mapStatus?.backup_available || saving}
            onClick={() => void restoreOriginal()}
          >
            恢复应用前映射
          </Button>
        </div>
      </div>

      {mapStatus?.has_external_map && !mapStatus.applied ? (
        <Alert
          type="warning"
          showIcon
          message="发现其他工具的系统键盘映射"
          description="应用 DockMapper 前会备份它；系统 Scancode Map 无法安全合并多个工具的规则。"
        />
      ) : null}
      <Alert
        type="info"
        showIcon
        message="稳定性说明"
        description="映射由 Windows 键盘驱动在登录时加载，DockMapper 无需常驻，也不会与其他键盘钩子竞争。AltGr、Fn、组合键不支持该系统级模式。"
      />

      <div className={styles.toolbar}>
        <div>
          <Text strong>映射规则</Text>
          <span className={styles.description}>规则保存为草稿；应用后需重新登录或重启</span>
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
              options={sourceKeyOptions}
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
