import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Typography,
} from "antd";
import { invokeCommand } from "../api/ipc";
import { errorMessage } from "../api/commands";
import { createLogPoller, type LogReadState } from "./runtimeLogPolling";
import { runtimeLogWriter } from "./runtimeLogging";
import styles from "./components.module.scss";
import { usePageActive } from "./PageActivity";

const LEVELS = { info: "信息", warn: "警告", error: "错误" };
export default function RuntimeLogPanel() {
  const active = usePageActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const [state, setState] = useState<LogReadState>({ snapshot: null, loading: true, error: null });
  const [automatic, setAutomatic] = useState(true);
  const automaticRef = useRef(automatic);
  automaticRef.current = automatic;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const poller = useRef<ReturnType<typeof createLogPoller> | null>(null);
  const writing = useSyncExternalStore(runtimeLogWriter.subscribe, runtimeLogWriter.getSnapshot);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const operation = useRef(false);
  const clearing = useRef(false);
  const { notification } = AntApp.useApp();
  useEffect(() => {
    const controller = createLogPoller(
      () => invokeCommand("get_runtime_logs"),
      (next) => {
        const node = host.current;
        if (node && !followRef.current) {
          const top = node.getBoundingClientRect().top;
          const first = [...node.querySelectorAll<HTMLElement>("[data-log-id]")].find(
            (row) => row.getBoundingClientRect().bottom > top,
          );
          anchor.current = first
            ? { id: first.dataset.logId!, top: first.getBoundingClientRect().top - top }
            : null;
        }
        setState(next);
      },
    );
    poller.current = controller;
    controller.setAutomatic(automaticRef.current);
    const visibility = () =>
      controller.setVisible(activeRef.current && !document.hidden && !clearing.current);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      controller.dispose();
      poller.current = null;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    poller.current?.setVisible(active && !document.hidden && !clearing.current);
    if (!active) setConfirmOpen(false);
  }, [active]);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    if (follow) node.scrollTop = node.scrollHeight;
    else if (anchor.current) {
      const saved = anchor.current;
      const row = [...node.querySelectorAll<HTMLElement>("[data-log-id]")].find(
        (row) => row.dataset.logId === saved.id,
      );
      if (row)
        node.scrollTop +=
          row.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.top;
      anchor.current = null;
    }
  }, [state.snapshot, follow]);
  const lines = state.snapshot?.lines ?? [];
  const flushLogs = async () => {
    await runtimeLogWriter.retry();
    const error = runtimeLogWriter.getSnapshot().error;
    if (error) throw new Error(error);
  };
  const copyAll = async () => {
    if (operation.current) return;
    operation.current = true;
    setCopying(true);
    try {
      await flushLogs();
      const value = await invokeCommand("get_runtime_log_text");
      if (!value.trim()) {
        notification.info({ message: "暂无可复制的运行日志" });
        return;
      }
      if (!(await invokeCommand("copy_text", { value }))) throw new Error("剪贴板未完成写入");
      notification.success({ message: "已复制全部运行日志" });
    } catch (error) {
      notification.error({ message: "复制日志失败", description: errorMessage(error) });
    } finally {
      operation.current = false;
      setCopying(false);
    }
  };
  const deleteAll = async () => {
    if (operation.current) return;
    operation.current = true;
    clearing.current = true;
    setDeleting(true);
    poller.current?.setVisible(false);
    try {
      await flushLogs();
      await invokeCommand("clear_runtime_logs");
      anchor.current = null;
      poller.current?.clearSnapshot();
      notification.success({ message: "已删除全部运行日志" });
    } catch (error) {
      notification.error({ message: "删除日志失败", description: errorMessage(error) });
    } finally {
      operation.current = false;
      clearing.current = false;
      setDeleting(false);
      poller.current?.setVisible(activeRef.current && !document.hidden);
    }
  };
  return (
    <Card className={styles.surfaceCard} title="运行日志">
      <Space wrap className={styles.logToolbar}>
        <Button loading={copying} disabled={deleting} onClick={() => void copyAll()}>
          复制所有
        </Button>
        <Popconfirm
          title="删除所有运行日志？"
          description="清空本应用已保存的日志，新日志仍会继续记录。"
          okText="删除所有"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={deleteAll}
          disabled={copying || deleting}
          open={active && confirmOpen}
          onOpenChange={setConfirmOpen}
        >
          <Button danger loading={deleting} disabled={copying}>
            删除所有
          </Button>
        </Popconfirm>
        <Space>
          <Switch
            aria-label="自动刷新"
            checked={automatic}
            onChange={(next) => {
              setAutomatic(next);
              poller.current?.setAutomatic(next);
            }}
          />
          <Typography.Text>自动刷新</Typography.Text>
        </Space>
        <Space>
          <Switch
            aria-label="自动滚动到末尾"
            checked={follow}
            onChange={(next) => {
              followRef.current = next;
              setFollow(next);
            }}
          />
          <Typography.Text>自动滚动到末尾</Typography.Text>
        </Space>
      </Space>
      {writing.error && (
        <Alert
          type="error"
          showIcon
          message={writing.error}
          description={`仍有 ${writing.pending} 条记录等待写入，退出前请重试。`}
          action={<Button onClick={() => void runtimeLogWriter.retry()}>重试记录</Button>}
        />
      )}
      {state.error && (
        <Alert
          type="error"
          showIcon
          message="运行日志读取失败"
          description={state.error}
          action={
            <Button loading={state.loading} onClick={() => void poller.current?.refresh()}>
              重试读取
            </Button>
          }
        />
      )}
      <div
        ref={host}
        className={styles.logViewport}
        role="region"
        aria-label="应用运行日志"
        tabIndex={0}
      >
        {!state.snapshot && state.loading ? (
          <Spin tip="读取运行日志…" />
        ) : lines.length ? (
          lines.map((line) => (
            <div key={line.id} data-log-id={line.id} className={styles.logLine}>
              <time>{line.timestamp ? new Date(line.timestamp).toLocaleString("zh-CN") : ""}</time>
              <span
                className={
                  line.level === "error"
                    ? styles.logError
                    : line.level === "warn"
                      ? styles.logWarning
                      : styles.logInfo
                }
              >
                {LEVELS[line.level]}
              </span>
              <span>{line.source}</span>
              <span>{line.message}</span>
            </div>
          ))
        ) : (
          !state.error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行日志" />
        )}
      </div>
      {state.snapshot?.truncated && (
        <Typography.Text type="secondary">
          仅显示最近 500 行，读取上限 256 KiB；“复制所有”包含全部已保存日志。
        </Typography.Text>
      )}
    </Card>
  );
}
