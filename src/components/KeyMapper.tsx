import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntApp, Button, Modal, Select, Switch, Table, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { KeyCode, KeyMapping, ScancodeMapStatus, SupportedKey } from "../types";
import { errorMessage, keyMappingApi } from "../api/commands";
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
      keyMappingApi.mappings(),
      keyMappingApi.supportedKeys(),
      keyMappingApi.status(),
    ])
      .then(([rules, keys, status]) => {
        setMappings(rules);
        setSupportedKeys(keys);
        setMapStatus(status);
      })
      .catch((error) => {
        notification.error({ message: "加载按键映射失败", description: errorMessage(error) });
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
        await keyMappingApi.sync(updated);
        setMappings(updated);
        setMapStatus(await keyMappingApi.status());
        notification.success({ message: "按键映射已更新" });
        return true;
      } catch (error) {
        notification.error({ message: "同步失败", description: errorMessage(error) });
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
      const result = await keyMappingApi.apply(confirmTakeover);
      setMapStatus(result.status);
      if (result.outcome === "confirmationRequired") {
        modal.confirm({
          title: "检测到其他工具的键盘映射",
          content: "DockMapper 会备份当前 Scancode Map 后接管。恢复时可写回该备份。",
          okText: "备份并接管",
          cancelText: "取消",
          onOk: () => applyToSystem(true),
        });
        return;
      }
      notification.success({
        message: "系统映射已写入",
        description: "若尚未重新登录或重启，系统仍可能使用旧映射。",
      });
    } catch (error) {
      notification.error({ message: "写入系统映射失败", description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const restoreOriginal = async () => {
    setSaving(true);
    try {
      const status = await keyMappingApi.restore();
      setMapStatus(status);
      notification.success({
        message: "已恢复应用前映射",
        description: "若尚未重新登录或重启，系统仍可能使用旧映射。",
      });
    } catch (error) {
      notification.error({ message: "恢复失败", description: errorMessage(error) });
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
            {mapStatus?.state === "applied"
              ? "当前规则已写入注册表；若尚未重新登录或重启，系统仍可能使用旧映射"
              : mapStatus?.state === "draft_changed"
                ? "规则草稿已修改，需要重新应用到系统"
                : "编辑规则后，按需请求管理员权限应用到系统"}
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

      {mapStatus?.state === "system_changed" ? (
        <Alert
          type="warning"
          showIcon
          message="系统键盘映射已发生变化"
          description="可能来自其他工具或手动修改；再次应用 DockMapper 前会要求确认并备份当前 Scancode Map。"
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
