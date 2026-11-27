import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { captureStartup } from "./captureStartupRuntime";
import { captureStarting } from "./captureStartup";
import { listen } from "@tauri-apps/api/event";
import {
  ClearOutlined,
  CopyOutlined,
  CameraOutlined,
  DeleteOutlined,
  PushpinOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { ScanText } from "lucide-react";
import {
  App as AntApp,
  ConfigProvider,
  DatePicker,
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import { errorMessage, historyApi, MAIN_EVENTS, screenshotSettingsApi } from "../api/commands";
import { invokeCommand } from "../api/ipc";
import { useMediaQuery } from "../hooks/useMediaQuery";
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

const HISTORY_GROUP_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const HISTORY_FULL_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const HISTORY_SHORT_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
});

type HistoryAction = "copy" | "pin" | "favorite" | "delete" | "clear" | "ocr" | "qr";

interface RecognitionDialog {
  kind: "ocr" | "qr";
  id: string;
  loading: boolean;
  text: string;
  items: string[];
  error: string | null;
}

interface HistoryCardProps {
  entry: ScreenshotHistorySummary;
  previewIds: string[];
  loading: boolean;
  workingAction: HistoryAction | null;
  anyWorking: boolean;
  confirming: boolean;
  onCopy: (id: string) => void;
  onPin: (id: string) => void;
  onInspect: (id: string, kind: "ocr" | "qr") => void;
  onToggleFavorite: (entry: ScreenshotHistorySummary) => void;
  onConfirmOpenChange: (id: string, open: boolean) => void;
  onDelete: (id: string) => void;
}

const HistoryCard = memo(function HistoryCard({
  entry,
  previewIds,
  loading,
  workingAction,
  anyWorking,
  confirming,
  onCopy,
  onPin,
  onInspect,
  onToggleFavorite,
  onConfirmOpenChange,
  onDelete,
}: HistoryCardProps) {
  const otherWorking = anyWorking && workingAction === null;
  return (
    <article
      className={styles.historyCard}
      tabIndex={0}
      data-active={workingAction !== null || confirming}
    >
      <div
        className={styles.historyPreview}
        style={{ aspectRatio: `${entry.width} / ${entry.height}` }}
      >
        <HistoryImage id={entry.id} ids={previewIds} />
      </div>
      <div className={styles.historyMeta}>
        <Text ellipsis title={HISTORY_FULL_TIME_FORMATTER.format(entry.createdAtMs)}>
          {HISTORY_SHORT_TIME_FORMATTER.format(entry.createdAtMs)}
        </Text>
        <span className={styles.description}>
          {entry.width} × {entry.height}
        </span>
      </div>
      <div className={styles.historyActions}>
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          title="复制"
          aria-label="复制截图历史"
          loading={workingAction === "copy"}
          disabled={loading || otherWorking || (workingAction !== null && workingAction !== "copy")}
          onClick={() => onCopy(entry.id)}
        />
        <Button
          type="text"
          size="small"
          icon={<PushpinOutlined />}
          title="贴图"
          aria-label="贴出截图历史"
          loading={workingAction === "pin"}
          disabled={loading || otherWorking || (workingAction !== null && workingAction !== "pin")}
          onClick={() => onPin(entry.id)}
        />
        <Button
          type="text"
          size="small"
          icon={<ScanText size={14} strokeWidth={2} aria-hidden="true" />}
          title="识别文字 (OCR)"
          aria-label="识别截图文字"
          disabled={loading || anyWorking}
          onClick={() => onInspect(entry.id, "ocr")}
        />
        <Button
          type="text"
          size="small"
          icon={<QrcodeOutlined />}
          title="识别二维码"
          aria-label="识别截图二维码"
          disabled={loading || anyWorking}
          onClick={() => onInspect(entry.id, "qr")}
        />
        <Button
          type="text"
          size="small"
          icon={entry.favorite ? <StarFilled /> : <StarOutlined />}
          className={entry.favorite ? styles.favoriteButton : undefined}
          title={entry.favorite ? "取消收藏" : "收藏"}
          aria-label={entry.favorite ? "取消收藏截图历史" : "收藏截图历史"}
          loading={workingAction === "favorite"}
          disabled={
            loading || otherWorking || (workingAction !== null && workingAction !== "favorite")
          }
          onClick={() => onToggleFavorite(entry)}
        />
        <Popconfirm
          title="删除这条截图历史？"
          onOpenChange={(open) => onConfirmOpenChange(entry.id, open)}
          okText="删除"
          cancelText="取消"
          onConfirm={() => onDelete(entry.id)}
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            title="删除"
            aria-label="删除截图历史"
            loading={workingAction === "delete"}
            disabled={
              loading || otherWorking || (workingAction !== null && workingAction !== "delete")
            }
          />
        </Popconfirm>
      </div>
    </article>
  );
});

function ScreenshotHistory() {
  const active = usePageActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const loaded = useRef(false);
  const isSm = useMediaQuery("(min-width: 576px)");
  const isLg = useMediaQuery("(min-width: 992px)");
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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<{ id: string; action: HistoryAction } | null>(null);
  const [recognition, setRecognition] = useState<RecognitionDialog | null>(null);
  const recognitionRevision = useRef(0);
  const workingRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const visibleEntries = useMemo(() => selectScreenshotHistory(entries, view), [entries, view]);
  const unfavoritedCount = useMemo(
    () => entries.filter((entry) => !entry.favorite).length,
    [entries],
  );
  const groups = useMemo(() => groupScreenshotHistory(visibleEntries), [visibleEntries]);
  const previewIds = useMemo(() => visibleEntries.map((entry) => entry.id), [visibleEntries]);

  const onColumnCountChange = (columns: number | null) => {
    if (columns === null || !Number.isInteger(columns) || columns < 1 || columns > 10) return;
    setView((current) => ({ ...current, columns }));
  };
  const visibleColumnCount = responsiveHistoryColumnCount(view.columns, { sm: isSm, lg: isLg });
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

  const run = useCallback(
    async (
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
    },
    [notification],
  );

  const startCapture = async () => {
    try {
      await screenshotSettingsApi.start();
    } catch (error) {
      notification.error({ message: "启动截图失败", description: errorMessage(error) });
    }
  };

  const inspectHistory = useCallback(async (id: string, kind: "ocr" | "qr") => {
    const request = ++recognitionRevision.current;
    setRecognition({ kind, id, loading: true, text: "", items: [], error: null });
    try {
      if (kind === "ocr") {
        const result = await historyApi.recognize(id);
        if (recognitionRevision.current !== request) return;
        setRecognition({ kind, id, loading: false, text: result.text.trim(), items: [], error: null });
      } else {
        const result = await historyApi.decodeQr(id);
        if (recognitionRevision.current !== request) return;
        const items = result.contents.filter((value) => value.trim().length > 0);
        setRecognition({
          kind,
          id,
          loading: false,
          text: items.join("\n"),
          items,
          error: null,
        });
      }
    } catch (error) {
      if (recognitionRevision.current !== request) return;
      setRecognition({ kind, id, loading: false, text: "", items: [], error: errorMessage(error) });
    }
  }, []);

  const handleCopyCard = useCallback(
    (id: string) => {
      void run(id, "copy", () => historyApi.copy(id), "截图已复制");
    },
    [run],
  );
  const handlePinCard = useCallback(
    (id: string) => {
      void run(id, "pin", () => historyApi.pin(id), "贴图已创建，可继续贴其他截图");
    },
    [run],
  );
  const handleInspectCard = useCallback(
    (id: string, kind: "ocr" | "qr") => {
      void inspectHistory(id, kind);
    },
    [inspectHistory],
  );
  const handleToggleFavorite = useCallback(
    (entry: ScreenshotHistorySummary) => {
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
      );
    },
    [run],
  );
  const handleConfirmOpenChange = useCallback((id: string, open: boolean) => {
    setConfirming(open ? id : null);
  }, []);
  const handleDeleteCard = useCallback(
    (id: string) => {
      void run(
        id,
        "delete",
        async () => {
          await historyApi.delete(id);
          setEntries((current) => current.filter((item) => item.id !== id));
        },
        "截图历史已删除",
      );
    },
    [run],
  );

  const copyRecognizedText = async (value: string) => {
    try {
      await invokeCommand("copy_text", { value });
      notification.success({ message: "识别结果已复制" });
    } catch (error) {
      notification.error({ message: "复制失败", description: errorMessage(error) });
    }
  };

  return (
    <div className={styles.historyPanel}>
      <ConfigProvider componentSize="middle" locale={historyDateLocale}>
        <div className={styles.historyHeader}>
          <div className={styles.historyTitleRow}>
            <div className={styles.historyHeading}>
              <Text strong>本地截图历史</Text>
              <span className={styles.description}>未收藏截图保留 30 天，最多 100 张</span>
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
          <Form component="div" layout="vertical" className={styles.historyToolbar}>
            <Form.Item label="排序" htmlFor="history-sort" className={styles.historyControl}>
              <Select<HistorySort>
                id="history-sort"
                value={view.sort}
                onChange={(sort) => setView((current) => ({ ...current, sort }))}
                options={[
                  { value: "newest", label: "最新优先" },
                  { value: "oldest", label: "最早优先" },
                  { value: "favorite", label: "当日收藏优先" },
                ]}
              />
            </Form.Item>
            <Form.Item label="筛选" htmlFor="history-filter" className={styles.historyControl}>
              <Select<HistoryFilter>
                id="history-filter"
                value={view.filter}
                onChange={(filter) => setView((current) => ({ ...current, filter }))}
                options={[
                  { value: "all", label: "全部" },
                  { value: "favorite", label: "仅收藏" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="日期范围"
              className={`${styles.historyControl} ${styles.historyDateControl}`}
            >
              <DatePicker.RangePicker
                aria-label="截图日期范围"
                allowEmpty={[true, true]}
                allowClear
                value={historyDateRange(view)}
                onChange={(range) =>
                  setView((current) => ({ ...current, ...historyDatesFromRange(range) }))
                }
              />
            </Form.Item>
            <Form.Item
              label="列数"
              htmlFor="history-columns"
              className={`${styles.historyControl} ${styles.historyColumnsControl}`}
            >
              <Select<number>
                id="history-columns"
                aria-label="截图展示列数"
                value={view.columns}
                onChange={onColumnCountChange}
                options={Array.from({ length: 10 }, (_, index) => ({
                  value: index + 1,
                  label: `${index + 1} 列`,
                }))}
              />
            </Form.Item>
            <div className={styles.historyToolbarActions}>
              {(view.startDate || view.endDate) && (
                <Button
                  onClick={() => setView((current) => ({ ...current, startDate: "", endDate: "" }))}
                >
                  清除日期
                </Button>
              )}
              <Text type="secondary" className={styles.historyCount}>
                {visibleEntries.length} 条
              </Text>
              <Popconfirm
                title={`清理全部 ${unfavoritedCount} 条未收藏截图？`}
                description="收藏的截图会保留，清理后无法恢复。"
                okText="清理"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                disabled={unfavoritedCount === 0 || loading || working !== null}
                onConfirm={() =>
                  void run("__clear__", "clear", async () => {
                    const removed = await historyApi.clearUnfavorited();
                    setEntries((current) => current.filter((item) => item.favorite));
                    notification.success({
                      message: removed > 0 ? `已清理 ${removed} 条未收藏截图` : "没有可清理的未收藏截图",
                    });
                  })
                }
              >
                <Button
                  icon={<ClearOutlined />}
                  loading={working?.action === "clear"}
                  disabled={unfavoritedCount === 0 || loading || working !== null}
                >
                  清理未收藏
                </Button>
              </Popconfirm>
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                disabled={working !== null}
                onClick={() => void refresh()}
              >
                刷新
              </Button>
            </div>
          </Form>
        </div>
      </ConfigProvider>

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
              {HISTORY_GROUP_DATE_FORMATTER.format(new Date(`${group.date}T12:00:00`))}{" "}
              <Text type="secondary">{group.entries.length} 张</Text>
            </Typography.Title>
            <div
              className={styles.historyMasonry}
              style={{ "--history-columns": visibleColumnCount } as CSSProperties}
            >
              {group.entries.map((entry) => (
                <HistoryCard
                  key={entry.id}
                  entry={entry}
                  previewIds={previewIds}
                  loading={loading}
                  workingAction={working?.id === entry.id ? working.action : null}
                  anyWorking={working !== null}
                  confirming={confirming === entry.id}
                  onCopy={handleCopyCard}
                  onPin={handlePinCard}
                  onInspect={handleInspectCard}
                  onToggleFavorite={handleToggleFavorite}
                  onConfirmOpenChange={handleConfirmOpenChange}
                  onDelete={handleDeleteCard}
                />
              ))}
            </div>
          </section>
        ))
      )}
      <Modal
        open={recognition !== null}
        title={recognition?.kind === "qr" ? "二维码识别结果" : "文字识别结果 (OCR)"}
        onCancel={() => {
          recognitionRevision.current += 1;
          setRecognition(null);
        }}
        footer={
          recognition && !recognition.loading && recognition.text ? (
            <Space>
              <Button onClick={() => setRecognition(null)}>关闭</Button>
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => void copyRecognizedText(recognition.text)}
              >
                复制全部
              </Button>
            </Space>
          ) : (
            <Button onClick={() => setRecognition(null)}>关闭</Button>
          )
        }
      >
        {recognition?.loading ? (
          <div className={styles.centerState}>
            <Spin tip={recognition.kind === "qr" ? "正在识别二维码…" : "正在识别文字…"} />
          </div>
        ) : recognition?.error ? (
          <Alert
            type="error"
            showIcon
            message="识别失败"
            description={recognition.error}
            action={
              <Button size="small" onClick={() => void inspectHistory(recognition.id, recognition.kind)}>
                重试
              </Button>
            }
          />
        ) : !recognition?.text ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              recognition?.kind === "qr" ? "未在截图中检测到二维码" : "未在截图中识别到文字"
            }
          />
        ) : recognition.kind === "qr" ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {recognition.items.map((item, index) => (
              <Input
                key={`${index}-${item}`}
                readOnly
                value={item}
                addonAfter={
                  <Button
                    type="link"
                    size="small"
                    onClick={() => void copyRecognizedText(item)}
                  >
                    复制
                  </Button>
                }
              />
            ))}
          </Space>
        ) : (
          <Input.TextArea value={recognition.text} readOnly autoSize={{ minRows: 4, maxRows: 14 }} />
        )}
      </Modal>
    </div>
  );
}

export default memo(ScreenshotHistory);
