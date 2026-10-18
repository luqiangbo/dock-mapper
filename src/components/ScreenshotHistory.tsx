import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { captureStartup } from "./captureStartupRuntime";
import { captureStarting } from "./captureStartup";
import { listen } from "@tauri-apps/api/event";
import {
  CopyOutlined,
  CameraOutlined,
  DeleteOutlined,
  PushpinOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  ConfigProvider,
  DatePicker,
  Alert,
  Button,
  Empty,
  Grid,
  InputNumber,
  Masonry,
  Popconfirm,
  Select,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import { errorMessage, historyApi, MAIN_EVENTS, screenshotSettingsApi } from "../api/commands";
import {
  loadScreenshotHistoryView,
  saveScreenshotHistoryView,
  selectScreenshotHistory,
  responsiveHistoryColumnCount,
  screenshotHistoryPhase,
  groupScreenshotHistory,
  type HistoryFilter,
  type HistorySort,
} from "./screenshotHistoryView";
import styles from "./components.module.scss";
import HistoryImage from "./HistoryImage";
import { usePageActive } from "./PageActivity";
import { historyDateLocale, historyDateRange, historyDatesFromRange } from "./historyDateRange";

const { Text } = Typography;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

type HistoryAction = "copy" | "pin" | "favorite" | "delete";

export default function ScreenshotHistory() {
  const active = usePageActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const loaded = useRef(false);
  const screens = Grid.useBreakpoint();
  const { notification } = AntApp.useApp();
  const [entries, setEntries] = useState<ScreenshotHistorySummary[]>([]);
  const [view, setView] = useState(loadScreenshotHistoryView);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const captureSnapshot = useSyncExternalStore(
    captureStartup.subscribe,
    captureStartup.getSnapshot,
  );
  const startingCapture = captureStarting(captureSnapshot);
  const [working, setWorking] = useState<{ id: string; action: HistoryAction } | null>(null);
  const workingRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const visibleEntries = useMemo(() => selectScreenshotHistory(entries, view), [entries, view]);
  const groups = useMemo(() => groupScreenshotHistory(visibleEntries), [visibleEntries]);
  const previewIds = useMemo(() => visibleEntries.map((entry) => entry.id), [visibleEntries]);

  const onColumnCountChange = (columns: number | null) => {
    if (columns === null || !Number.isInteger(columns) || columns < 1 || columns > 10) return;
    setView((current) => ({ ...current, columns }));
  };
  const sharedProps = {
    mode: "spinner" as const,
    min: 1,
    max: 10,
    defaultValue: 3,
    onChange: onColumnCountChange,
    style: { width: 150 },
  };
  const visibleColumnCount = responsiveHistoryColumnCount(view.columns, screens);
  const phase = screenshotHistoryPhase(
    loading && !loaded.current,
    loaded.current ? null : readError,
    entries.length,
    visibleEntries.length,
  );

  const saveView = useCallback(() => {
    if (view.startDate && view.endDate && view.startDate > view.endDate) return;
    try {
      saveScreenshotHistoryView(view);
      setPreferenceError(null);
    } catch (error) {
      setPreferenceError(errorMessage(error));
    }
  }, [view]);
  useEffect(saveView, [saveView]);

  useEffect(() => {
    const error = window.sessionStorage.getItem("dockmapper.history-write-error");
    if (!error) return;
    window.sessionStorage.removeItem("dockmapper.history-write-error");
    setWriteError(error);
  }, []);

  const refresh = useCallback(async () => {
    if (!activeRef.current) return;
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    setReadError(null);
    try {
      const nextEntries = await historyApi.list();
      if (generation === refreshGenerationRef.current) {
        loaded.current = true;
        setEntries(nextEntries);
      }
    } catch (error) {
      if (generation === refreshGenerationRef.current) {
        setReadError(errorMessage(error));
      }
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (!activeRef.current) return;
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 150);
  }, [refresh]);

  useLayoutEffect(() => {
    if (!active) {
      refreshGenerationRef.current += 1;
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(MAIN_EVENTS.historyChanged, scheduleRefresh)
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) => {
        if (!disposed) setReadError(`历史更新监听失败：${errorMessage(error)}`);
      });
    return () => {
      disposed = true;
      refreshGenerationRef.current += 1;
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      unlisten?.();
    };
  }, [refresh, scheduleRefresh, active]);

  const run = async (
    id: string,
    action: HistoryAction,
    task: () => Promise<unknown>,
    success?: string,
  ) => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking({ id, action });
    try {
      await task();
      if (success) notification.success({ message: success });
    } catch (error) {
      notification.error({ message: "截图历史操作失败", description: errorMessage(error) });
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  const startCapture = async () => {
    try {
      await screenshotSettingsApi.start();
    } catch (error) {
      notification.error({ message: "启动截图失败", description: errorMessage(error) });
    }
  };

  return (
    <div className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <div className={styles.historyTitleRow}>
          <div className={styles.historyHeading}>
            <Text strong>本地截图历史</Text>
            <span className={styles.description}>
              未收藏记录最多保留 100 条且不超过 30 天；连续点击贴图可创建多个独立窗口。
            </span>
          </div>
          <Button
            type="primary"
            icon={<CameraOutlined />}
            loading={startingCapture}
            onClick={() => void startCapture()}
          >
            开始截图
          </Button>
        </div>
        <div className={styles.historyToolbar}>
          <label className={styles.historyControl}>
            <span>排序</span>
            <Select<HistorySort>
              value={view.sort}
              onChange={(sort) => setView((current) => ({ ...current, sort }))}
              options={[
                { value: "newest", label: "最新优先" },
                { value: "oldest", label: "最早优先" },
                { value: "favorite", label: "当日收藏优先" },
              ]}
            />
          </label>
          <label className={styles.historyControl}>
            <span>筛选</span>
            <Select<HistoryFilter>
              value={view.filter}
              onChange={(filter) => setView((current) => ({ ...current, filter }))}
              options={[
                { value: "all", label: "全部" },
                { value: "favorite", label: "仅收藏" },
              ]}
            />
          </label>
          <div className={styles.historyControl}>
            <span>日期范围</span>
            <ConfigProvider locale={historyDateLocale}>
              <DatePicker.RangePicker
                size="small"
                aria-label="截图日期范围"
                allowEmpty={[true, true]}
                allowClear
                value={historyDateRange(view)}
                onChange={(range) =>
                  setView((current) => ({ ...current, ...historyDatesFromRange(range) }))
                }
              />
            </ConfigProvider>
          </div>
          {(view.startDate || view.endDate) && (
            <Button
              onClick={() => setView((current) => ({ ...current, startDate: "", endDate: "" }))}
            >
              清除日期
            </Button>
          )}
          <label className={styles.historyControl}>
            <span>列数</span>
            <InputNumber
              {...sharedProps}
              aria-label="截图展示列数"
              value={view.columns}
              precision={0}
            />
          </label>
          <Text type="secondary" className={styles.historyCount}>
            {visibleEntries.length} 条
          </Text>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            disabled={working !== null}
            onClick={() => void refresh()}
          >
            刷新
          </Button>
        </div>
      </div>

      {preferenceError && (
        <Alert
          type="warning"
          showIcon
          message="历史浏览偏好未保存"
          description={preferenceError}
          action={<Button onClick={saveView}>重试保存</Button>}
        />
      )}
      {view.startDate && view.endDate && view.startDate > view.endDate && (
        <Alert type="warning" showIcon message="开始日期不能晚于结束日期，请调整日期范围" />
      )}
      {readError && (
        <Alert
          type="error"
          showIcon
          message="截图历史读取失败"
          description={readError}
          action={
            <Button loading={loading} onClick={() => void refresh()}>
              重试
            </Button>
          }
        />
      )}

      {writeError && (
        <Alert
          type="warning"
          showIcon
          closable
          message="有一张截图未保存到历史"
          description={writeError}
          onClose={() => setWriteError(null)}
        />
      )}

      {phase === "loading" ? (
        <div className={styles.historyEmpty}>
          <Spin />
        </div>
      ) : phase === "error" ? null : phase === "empty" ? (
        <Empty description="完成复制、保存或贴图后，截图会出现在这里" />
      ) : phase === "filtered" ? (
        <Empty description="没有符合当前筛选条件的截图" />
      ) : (
        groups.map((group) => (
          <section
            key={group.date}
            className={styles.historyDateGroup}
            aria-label={`${group.date}截图`}
          >
            <Typography.Title level={5}>
              {new Intl.DateTimeFormat("zh-CN", {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "short",
              }).format(new Date(`${group.date}T12:00:00`))}{" "}
              <Text type="secondary">{group.entries.length} 张</Text>
            </Typography.Title>
            <Masonry<ScreenshotHistorySummary>
              className={styles.historyMasonry}
              columns={visibleColumnCount}
              gutter={[12, 12]}
              items={group.entries.map((entry) => ({ key: entry.id, data: entry }))}
              itemRender={({ data: entry }) => (
                <article className={styles.historyCard} tabIndex={0}>
                  <div
                    className={styles.historyPreview}
                    style={{ aspectRatio: `${entry.width} / ${entry.height}` }}
                  >
                    <HistoryImage id={entry.id} ids={previewIds} />
                  </div>
                  <div className={styles.historyMeta}>
                    <Text ellipsis title={new Date(entry.createdAtMs).toLocaleString("zh-CN")}>
                      {new Date(entry.createdAtMs).toLocaleString("zh-CN")}
                    </Text>
                    <span className={styles.description}>
                      {entry.width} × {entry.height} · {formatBytes(entry.totalBytes)}
                    </span>
                  </div>
                  <div className={styles.historyActions}>
                    <Tooltip title="复制">
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        aria-label="复制截图历史"
                        loading={working?.id === entry.id && working.action === "copy"}
                        disabled={
                          loading ||
                          (working !== null &&
                            (working.id !== entry.id || working.action !== "copy"))
                        }
                        onClick={() =>
                          void run(entry.id, "copy", () => historyApi.copy(entry.id), "截图已复制")
                        }
                      />
                    </Tooltip>
                    <Tooltip title="贴图">
                      <Button
                        type="text"
                        size="small"
                        icon={<PushpinOutlined />}
                        aria-label="贴出截图历史"
                        loading={working?.id === entry.id && working.action === "pin"}
                        disabled={
                          loading ||
                          (working !== null &&
                            (working.id !== entry.id || working.action !== "pin"))
                        }
                        onClick={() =>
                          void run(
                            entry.id,
                            "pin",
                            () => historyApi.pin(entry.id),
                            "贴图已创建，可继续贴其他截图",
                          )
                        }
                      />
                    </Tooltip>
                    <Tooltip title={entry.favorite ? "取消收藏" : "收藏"}>
                      <Button
                        type="text"
                        size="small"
                        icon={entry.favorite ? <StarFilled /> : <StarOutlined />}
                        className={entry.favorite ? styles.favoriteButton : undefined}
                        aria-label={entry.favorite ? "取消收藏截图历史" : "收藏截图历史"}
                        loading={working?.id === entry.id && working.action === "favorite"}
                        disabled={
                          loading ||
                          (working !== null &&
                            (working.id !== entry.id || working.action !== "favorite"))
                        }
                        onClick={() =>
                          void run(
                            entry.id,
                            "favorite",
                            async () => {
                              const updated = await historyApi.favorite(entry.id, !entry.favorite);
                              setEntries((current) =>
                                current.map((item) => (item.id === updated.id ? updated : item)),
                              );
                            },
                            entry.favorite ? "已取消收藏" : "已收藏",
                          )
                        }
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除这条截图历史？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() =>
                        void run(
                          entry.id,
                          "delete",
                          async () => {
                            await historyApi.delete(entry.id);
                            setEntries((current) => current.filter((item) => item.id !== entry.id));
                          },
                          "截图历史已删除",
                        )
                      }
                    >
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label="删除截图历史"
                          loading={working?.id === entry.id && working.action === "delete"}
                          disabled={
                            loading ||
                            (working !== null &&
                              (working.id !== entry.id || working.action !== "delete"))
                          }
                        />
                      </Tooltip>
                    </Popconfirm>
                  </div>
                </article>
              )}
            />
          </section>
        ))
      )}
    </div>
  );
}
