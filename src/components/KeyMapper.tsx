import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Badge,
  Collapse,
  Dropdown,
  Empty,
  Space,
  Tooltip,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { KeyCode, KeyMapping, KeyMappingStatus, SupportedKey } from "../types";
import { errorMessage, keyMappingApi } from "../api/commands";
import styles from "./components.module.scss";
import ui from "./KeyMapper.module.scss";
import {
  legacyNeedsAttention,
  mappingKeyLabel,
  mappingKeyOptions,
  matchesMappingKey,
} from "./keyMappingPresentation";
import { createMappingLoader, saveRuntimeMappings } from "./keyMapperLoading";
import { usePageActive, usePageModal, usePageRefresh } from "./PageActivity";
const { Text } = Typography;
const stateLabels = {
  no_rules: "无启用规则",
  running: "运行中",
  paused: "已暂停",
  legacy_blocked: "遗留系统映射阻塞",
  restart_required: "等待 Windows 重启",
  error: "运行失败",
} as const;

export default function KeyMapper() {
  const active = usePageActive();
  const loaded = useRef(false);

  const [mappings, setMappings] = useState<KeyMapping[]>([]);
  const [supportedKeys, setSupportedKeys] = useState<SupportedKey[]>([]);
  const [mapStatus, setMapStatus] = useState<KeyMappingStatus | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addForm] = Form.useForm<{ source: KeyCode; target: KeyCode }>();
  const [saving, setSaving] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [legacyExpanded, setLegacyExpanded] = useState<boolean | null>(null);
  const manualRefresh = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const mounted = useRef(false);
  const statusRevision = useRef(0);
  const busy = useRef(false);
  const { notification } = AntApp.useApp();
  const modal = usePageModal();
  const loader = useMemo(
    () =>
      createMappingLoader(keyMappingApi, (state) => {
        setLoading(state.phase === "loading" && !loaded.current);
        setLoadError(state.phase === "error" ? state.error : null);
        if (state.phase === "ready") {
          loaded.current = true;
          setMappings(state.data.rules);
          setSupportedKeys(state.data.keys);
          setMapStatus(state.data.status);
          setStatusError(null);
        }
      }),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loader.cancel();
      statusRevision.current += 1;
    };
  }, [loader]);
  usePageRefresh(() => loader.load(), saving);
  useLayoutEffect(() => {
    if (!active) {
      loader.cancel();
      statusRevision.current += 1;
      setRefreshingStatus(false);
      manualRefresh.current = false;
      setMoreOpen(false);
    }
  }, [active, loader]);
  const refreshStatus = useCallback(async (background = false) => {
    const revision = ++statusRevision.current;
    if (!background) {
      manualRefresh.current = true;
      setRefreshingStatus(true);
    }
    try {
      const status = await keyMappingApi.status();
      if (mounted.current && revision === statusRevision.current) {
        setMapStatus(status);
        setStatusError(null);
      }
    } catch (error) {
      if (mounted.current && revision === statusRevision.current)
        setStatusError(errorMessage(error));
    } finally {
      if (mounted.current && revision === statusRevision.current && !background) {
        manualRefresh.current = false;
        setRefreshingStatus(false);
      }
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busy.current && !manualRefresh.current) void refreshStatus(true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, refreshStatus]);
  const unavailable = loading || (!loaded.current && loadError !== null);
  const keyLabel = (code: string) => mappingKeyLabel(code, supportedKeys);
  const beginWrite = (operation: string) => {
    if (busy.current) return false;
    busy.current = true;
    setPendingOperation(operation);
    manualRefresh.current = false;
    loader.cancel();
    statusRevision.current += 1;
    setSaving(true);
    setRefreshingStatus(false);
    return true;
  };
  const endWrite = () => {
    busy.current = false;
    if (mounted.current) {
      setSaving(false);
      setPendingOperation(null);
    }
  };
  const syncMappings = async (updated: KeyMapping[], operation = "rules") => {
    if (!beginWrite(operation)) return false;
    try {
      const result = await saveRuntimeMappings(keyMappingApi, updated, () => {
        if (mounted.current) setMappings(updated);
      });
      if (mounted.current) {
        setMapStatus(result.status);
        setStatusError(result.refreshError);
      }
      return true;
    } catch (error) {
      notification.error({ message: "保存映射规则失败", description: errorMessage(error) });
      return false;
    } finally {
      endWrite();
    }
  };
  const setEnabled = async (enabled: boolean) => {
    if (!beginWrite("global")) return;
    try {
      await keyMappingApi.enabled(enabled);
      setMapStatus((previous) => (previous ? { ...previous, enabled } : previous));
      await refreshStatus();
    } catch (error) {
      notification.error({ message: "切换按键映射失败", description: errorMessage(error) });
    } finally {
      endWrite();
    }
  };
  const addMapping = async ({ source, target }: { source: KeyCode; target: KeyCode }) => {
    if (unavailable || busy.current) return;
    if (
      source === target ||
      mappings.some((rule) => rule.id !== editingId && rule.source_key === source)
    ) {
      notification.warning({ message: "源键不能重复，也不能与目标键相同" });
      return;
    }
    const rule: KeyMapping = {
      id: editingId ?? crypto.randomUUID(),
      source_key: source,
      target_key: target,
      enabled: editingId ? (mappings.find((item) => item.id === editingId)?.enabled ?? true) : true,
    };
    if (
      await syncMappings(
        editingId
          ? mappings.map((item) => (item.id === editingId ? rule : item))
          : [...mappings, rule],
      )
    ) {
      setAddVisible(false);
      setEditingId(null);
      addForm.resetFields();
      notification.success({ message: editingId ? "映射规则已更新" : "映射规则已添加" });
    }
  };
  const clearLegacy = () => {
    const preview = mapStatus?.legacy;
    if (!preview) return;
    modal.confirm({
      title: "清空系统映射并重置旧规则？",
      content:
        "将先备份，再请求管理员权限，清空整个 Windows Scancode Map（包括其他工具写入的映射）及应用规则。清理后必须重启 Windows，重启前运行时映射保持暂停。恢复资料保存在应用数据目录的 keyboard-recovery 中。",
      okText: "备份并请求清理",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        if (!beginWrite("legacy")) return;
        try {
          await keyMappingApi.clearLegacy(preview.value);
          notification.success({ message: "系统映射已清空，重启 Windows 后生效" });
          await loader.load();
        } catch (error) {
          notification.error({ message: "系统映射清理失败", description: errorMessage(error) });
          await loader.load();
          throw error;
        } finally {
          endWrite();
        }
      },
    });
  };
  const editingRule = mappings.find((rule) => rule.id === editingId);
  const sourceKeyOptions = useMemo(
    () => mappingKeyOptions(supportedKeys, "source", editingRule?.source_key),
    [supportedKeys, editingRule?.source_key],
  );
  const targetKeyOptions = useMemo(
    () => mappingKeyOptions(supportedKeys, "target", editingRule?.target_key),
    [supportedKeys, editingRule?.target_key],
  );
  const needsAttention = legacyNeedsAttention(mapStatus, statusError ?? loadError);
  const attentionReason = needsAttention
    ? JSON.stringify([
        mapStatus?.legacy?.present,
        mapStatus?.legacy?.parse_error,
        mapStatus?.legacy?.waiting_restart,
        statusError,
        loadError,
        !!mapStatus,
      ])
    : "";
  useEffect(() => {
    if (attentionReason) setLegacyExpanded(true);
  }, [attentionReason]);
  const legacy = mapStatus?.legacy;
  const stateColor =
    mapStatus?.state === "running"
      ? "success"
      : mapStatus?.state === "error"
        ? "error"
        : mapStatus?.state === "legacy_blocked" || mapStatus?.state === "restart_required"
          ? "warning"
          : "default";
  const columns = [
    {
      title: "映射关系",
      key: "mapping",
      render: (_: unknown, rule: KeyMapping) => (
        <div
          className={ui.keyPair}
          aria-label={`${keyLabel(rule.source_key)} 映射为 ${keyLabel(rule.target_key)}`}
        >
          <Tag className={ui.keycap}>{keyLabel(rule.source_key)}</Tag>
          <ArrowRightOutlined className={ui.arrow} aria-hidden />
          <Tag className={ui.keycap}>{keyLabel(rule.target_key)}</Tag>
        </div>
      ),
    },
    {
      title: "启用",
      key: "enabled",
      width: 76,
      render: (_: unknown, rule: KeyMapping) => (
        <Switch
          size="small"
          aria-label={`${keyLabel(rule.source_key)} 映射状态`}
          checked={rule.enabled}
          disabled={unavailable || saving}
          loading={pendingOperation === `toggle:${rule.id}`}
          onChange={(enabled) =>
            void syncMappings(
              mappings.map((item) => (item.id === rule.id ? { ...item, enabled } : item)),
              `toggle:${rule.id}`,
            )
          }
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 108,
      render: (_: unknown, rule: KeyMapping) => (
        <Space size={4}>
          <Tooltip title="编辑规则">
            <Button
              type="text"
              size="small"
              aria-label={`编辑 ${keyLabel(rule.source_key)} 映射`}
              icon={<EditOutlined />}
              disabled={unavailable || saving}
              onClick={() => {
                setEditingId(rule.id);
                addForm.setFieldsValue({ source: rule.source_key, target: rule.target_key });
                setAddVisible(true);
              }}
            />
          </Tooltip>
          <Tooltip title="删除规则">
            <Button
              type="text"
              danger
              size="small"
              aria-label={`删除 ${keyLabel(rule.source_key)} 映射`}
              icon={<DeleteOutlined />}
              loading={pendingOperation === `delete:${rule.id}`}
              disabled={unavailable || saving}
              onClick={() =>
                void syncMappings(
                  mappings.filter((item) => item.id !== rule.id),
                  `delete:${rule.id}`,
                )
              }
            />
          </Tooltip>
        </Space>
      ),
    },
  ];
  const clearRules = () =>
    modal.confirm({
      title: "清空所有运行时规则？",
      content: "清空后立即停止映射。系统遗留映射需在下方单独清理。",
      okText: "清空规则",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        if (!(await syncMappings([]))) throw new Error("清空规则失败");
      },
    });
  return (
    <div className={`${styles.page} ${ui.page}`}>
      <header className={ui.header}>
        <div>
          <div className={ui.heading}>
            <Typography.Title level={4}>按键映射</Typography.Title>
            <Badge
              status={stateColor}
              text={mapStatus ? stateLabels[mapStatus.state] : loading ? "读取中" : "读取失败"}
            />
            <Switch
              size="small"
              aria-label="按键映射总开关"
              checked={mapStatus?.enabled ?? false}
              disabled={unavailable || !mapStatus || saving}
              loading={pendingOperation === "global"}
              onChange={(value) => void setEnabled(value)}
            />
          </div>
          <Text type="secondary">隐藏到托盘后继续，退出软件即停止</Text>
        </div>
        <Space size={8}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={unavailable || saving}
            onClick={() => {
              setEditingId(null);
              addForm.resetFields();
              setAddVisible(true);
            }}
          >
            添加规则
          </Button>
          <Dropdown
            open={active && moreOpen}
            onOpenChange={setMoreOpen}
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "refresh",
                  label: "刷新状态",
                  icon: <ReloadOutlined />,
                  disabled: saving || refreshingStatus,
                },
                { type: "divider" },
                {
                  key: "clear",
                  label: "清空所有规则",
                  icon: <DeleteOutlined />,
                  danger: true,
                  disabled: unavailable || saving || mappings.length === 0,
                },
              ],
              onClick: ({ key }) => {
                setMoreOpen(false);
                if (key === "refresh") {
                  if (loadError) void loader.load();
                  else void refreshStatus();
                } else clearRules();
              },
            }}
          >
            <Button
              type="text"
              aria-label="更多映射操作"
              icon={<MoreOutlined />}
              loading={refreshingStatus}
              disabled={saving}
            />
          </Dropdown>
        </Space>
      </header>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message="按键映射读取失败"
          description={loadError}
          action={
            <Button disabled={saving} onClick={() => void loader.load()}>
              重试读取
            </Button>
          }
        />
      )}
      {(statusError || mapStatus?.error) && (
        <Alert
          type="error"
          showIcon
          message="映射状态异常"
          description={statusError ?? mapStatus?.error}
          action={
            <Button loading={saving} onClick={() => void setEnabled(mapStatus?.enabled ?? true)}>
              重试运行
            </Button>
          }
        />
      )}
      {(mapStatus?.state === "legacy_blocked" || mapStatus?.state === "restart_required") && (
        <Alert
          type="warning"
          showIcon
          message={
            mapStatus.state === "legacy_blocked"
              ? "遗留系统映射尚未清理，运行时映射已暂停"
              : "系统映射已清空，重启 Windows 后生效"
          }
          description="新规则仍可编辑和保存，重启并确认系统映射为空后启用。"
        />
      )}
      <section className={ui.rules} aria-label="映射规则">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={mappings}
          pagination={false}
          size="middle"
          loading={loading ? { tip: "读取按键映射…" } : false}
          locale={{
            emptyText: loading ? (
              "读取中…"
            ) : loadError ? (
              "读取失败，请重试"
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有映射规则，点击“添加规则”开始"
              />
            ),
          }}
        />
        <Text type="secondary" className={ui.hint}>
          修改即时保存；管理员窗口中的输入可能无法映射。
        </Text>
      </section>
      <Collapse
        ghost
        className={ui.legacy}
        activeKey={(legacyExpanded ?? needsAttention) ? ["legacy"] : []}
        onChange={(keys) => setLegacyExpanded(keys.includes("legacy"))}
        items={[
          {
            key: "legacy",
            label: (
              <div className={ui.legacyHeading}>
                <span>遗留系统映射</span>
                <Text type={needsAttention ? "warning" : "secondary"}>
                  {loading
                    ? "检查中"
                    : !legacy || statusError || loadError
                      ? "读取失败"
                      : legacy.waiting_restart
                        ? "等待重启"
                        : legacy.present
                          ? "需处理"
                          : "无遗留"}
                </Text>
              </div>
            ),
            children: (
              <div className={ui.legacyBody}>
                {!legacy || statusError || loadError ? (
                  <Alert
                    type={loading ? "info" : "error"}
                    showIcon
                    message={loading ? "正在读取系统映射" : "无法确认系统映射状态"}
                    description={statusError ?? loadError ?? mapStatus?.error}
                    action={
                      <Button
                        disabled={saving}
                        loading={refreshingStatus}
                        onClick={() => {
                          if (loadError) void loader.load();
                          else void refreshStatus();
                        }}
                      >
                        重试读取
                      </Button>
                    }
                  />
                ) : (
                  <>
                    {legacy.parse_error && (
                      <Alert
                        type="warning"
                        showIcon
                        message="系统映射格式异常"
                        description={legacy.parse_error}
                      />
                    )}
                    {legacy.rules.length > 0 ? (
                      <Table
                        size="small"
                        pagination={false}
                        rowKey={(_, index) => String(index)}
                        dataSource={legacy.rules}
                        columns={[
                          {
                            title: "系统源键",
                            dataIndex: "source",
                            render: (value: string) => (
                              <Tag className={ui.keycap}>{keyLabel(value)}</Tag>
                            ),
                          },
                          {
                            title: "系统目标键",
                            dataIndex: "target",
                            render: (value: string) => (
                              <Tag className={ui.keycap}>{keyLabel(value)}</Tag>
                            ),
                          },
                        ]}
                      />
                    ) : (
                      <Text type="secondary">
                        {legacy.present ? "注册表值存在，请备份后清理。" : "没有遗留系统映射。"}
                      </Text>
                    )}
                  </>
                )}
                <div className={ui.cleanup}>
                  <Text type="secondary">
                    清理影响所有工具写入的系统映射，需管理员授权并重启 Windows。独立恢复备份会保留。
                  </Text>
                  <Button
                    danger
                    disabled={!legacy || saving || !!statusError || !!loadError}
                    loading={pendingOperation === "legacy"}
                    onClick={clearLegacy}
                  >
                    清空系统映射并重置旧规则
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
      <Modal
        focusTriggerAfterClose={active}
        title={editingId ? "编辑按键映射" : "添加按键映射"}
        width={600}
        open={active && addVisible}
        onOk={() => void addForm.submit()}
        onCancel={() => {
          setAddVisible(false);
          setEditingId(null);
          addForm.resetFields();
        }}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        maskClosable={!saving}
        okText="保存规则"
        cancelText="取消"
      >
        <Form
          form={addForm}
          layout="vertical"
          className={ui.mappingForm}
          onFinish={(values) => void addMapping(values)}
        >
          <div className={ui.formPair}>
            <Form.Item
              name="source"
              label="将此按键"
              rules={[
                { required: true, message: "请选择源按键" },
                {
                  validator: (_, value) =>
                    !value ||
                    !mappings.some((rule) => rule.id !== editingId && rule.source_key === value)
                      ? Promise.resolve()
                      : Promise.reject(new Error("该源按键已有映射规则")),
                },
              ]}
            >
              <Select<KeyCode>
                showSearch
                filterOption={(query, option) =>
                  matchesMappingKey(query, { search: option?.search })
                }
                placeholder="选择要替换的按键"
                options={sourceKeyOptions}
                disabled={saving}
              />
            </Form.Item>
            <ArrowRightOutlined className={ui.formArrow} aria-hidden />
            <Form.Item
              name="target"
              label="映射为"
              dependencies={["source"]}
              rules={[
                { required: true, message: "请选择目标按键" },
                ({ getFieldValue }) => ({
                  validator: (_, value) =>
                    value !== getFieldValue("source")
                      ? Promise.resolve()
                      : Promise.reject(new Error("源按键与目标按键不能相同")),
                }),
              ]}
            >
              <Select<KeyCode>
                showSearch
                filterOption={(query, option) =>
                  matchesMappingKey(query, { search: option?.search })
                }
                placeholder="选择替换后的按键"
                options={targetKeyOptions}
                disabled={saving}
              />
            </Form.Item>
          </div>
          <Text type="secondary">左右修饰键可分别设置；选择“禁用按键”可屏蔽源键。</Text>
        </Form>
      </Modal>
    </div>
  );
}
