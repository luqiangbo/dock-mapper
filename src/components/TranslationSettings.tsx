import { TranslationServicePicker } from "./TranslationServicePicker";
import {
  saveTranslationSettingsPatch,
  translationConfigured,
  discardCredentialEdits,
} from "./translationSettingsSave";
import styles from "./TranslationSettings.module.scss";
import {
  CopyOutlined,
  CheckOutlined,
  TranslationOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import { TranslationTrial, EMPTY_TRIAL, trialValidation } from "./translationTrial";
import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Form, Input, Select, Spin, Tag } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePageActive } from "./PageActivity";
import { useQueuedAutosave } from "../hooks/useQueuedAutosave";
import { takeDetachedAutosaveError, waitForPendingAutosave } from "../hooks/queuedAutosave";
import {
  translationApi,
  settingsDraft,
  translationSettingsError,
  translationProviderLabel,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  type TranslationSettings as Settings,
  type TranslationSettingsDraft,
} from "../api/translation";

export default function TranslationSettings() {
  const active = usePageActive();
  const { notification } = App.useApp();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<TranslationSettingsDraft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [credentialError, setCredentialError] = useState("");
  const drafts = useRef<
    Partial<Record<TranslationSettingsDraft["provider"], TranslationSettingsDraft>>
  >({});
  const operationPending = useRef(false);
  const [linkError, setLinkError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [testText, setTestText] = useState("Hello world");
  const [trialState, setTrialState] = useState(EMPTY_TRIAL);
  const trialRef = useRef<TranslationTrial | null>(null);
  if (!trialRef.current) trialRef.current = new TranslationTrial(setTrialState);
  const trial = trialRef.current;
  const { schedule } = useQueuedAutosave({
    key: "translation-settings",
    delayMs: 600,
    save: (patch: Partial<TranslationSettingsDraft>) => saveTranslationSettingsPatch(patch),
    onSavingChange: setSaving,
    onSuccess: (result, { latest }) => {
      setSaved(result);
      if (latest) {
        setDirty(false);
        setSaveError("");
      }
    },
    onError: (error, { latest }) => {
      if (latest) setSaveError(String(error));
    },
    onDetachedError: (error) =>
      notification.error({ message: "翻译设置未保存", description: String(error) }),
  });
  useEffect(() => {
    if (!active || saved) return;
    let disposed = false;
    setLoadError("");
    void (async () => {
      await waitForPendingAutosave("translation-settings");
      const error = takeDetachedAutosaveError("translation-settings");
      const result = await translationApi.settings();
      if (disposed) return;
      setSaved(result);
      setDraft(settingsDraft(result));
      setEditing(!translationConfigured(result));
      if (error) setSaveError(`上次翻译设置未保存：${String(error)}`);
    })().catch((error) => {
      if (!disposed) setLoadError(String(error));
    });
    return () => {
      disposed = true;
    };
  }, [active, saved, attempt]);
  useEffect(() => () => trial.dispose(), [trial]);
  useEffect(() => {
    if (!active) trial.invalidate();
  }, [active, trial]);
  const change = (patch: Partial<TranslationSettingsDraft>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    trial.invalidate();
    setDraft(next);
    if (patch.source || patch.target) setDirty(true);
    if (patch.source || patch.target) setSaveError("");
    else setCredentialError("");
    if (patch.source || patch.target) schedule({ source: next.source, target: next.target });
  };
  const saveCredentials = async () => {
    if (!draft || operationPending.current) return;
    operationPending.current = true;
    setCredentialSaving(true);
    setCredentialError("");
    try {
      const patch =
        draft.provider === "baidu"
          ? { baiduAppId: draft.baiduAppId, baiduKey: draft.baiduKey }
          : { deeplFree: draft.deeplFree, deeplKey: draft.deeplKey };
      const result = await saveTranslationSettingsPatch({ ...patch, provider: draft.provider });
      setSaved(result);
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, baiduKey: null, deeplKey: null };
        drafts.current[current.provider] = next;
        return next;
      });
      setEditing(false);
    } catch (error) {
      setCredentialError(String(error));
    } finally {
      operationPending.current = false;
      setCredentialSaving(false);
    }
  };
  const cancelEdit = () => {
    if (!saved) return;
    trial.invalidate();
    setDraft(
      (current) =>
        current && { ...discardCredentialEdits(saved, current), provider: current.provider },
    );
    setCredentialError("");
    setEditing(false);
  };
  const switchService = async (provider: TranslationSettingsDraft["provider"]) => {
    if (!draft || !saved || operationPending.current || provider === draft.provider) return;
    drafts.current[draft.provider] = draft;
    trial.invalidate();
    const next = {
      ...settingsDraft(saved),
      ...drafts.current[provider],
      provider,
      source: draft.source,
      target: draft.target,
    };
    setDraft(next);
    setEditing(!(provider === "baidu" ? saved.baiduKeyConfigured : saved.deeplKeyConfigured));
    setCredentialError("");
    setLinkError("");
    const verified = provider === "baidu" ? saved.baiduVerified : saved.deeplVerified;
    const unchanged =
      provider === "baidu"
        ? next.baiduKey === null && next.baiduAppId === saved.baiduAppId
        : next.deeplKey === null && next.deeplFree === saved.deeplFree;
    if (!verified || !unchanged) return;
    operationPending.current = true;
    setCredentialSaving(true);
    try {
      setSaved(await saveTranslationSettingsPatch({ provider }));
    } catch (error) {
      setCredentialError(String(error));
    } finally {
      operationPending.current = false;
      setCredentialSaving(false);
    }
  };
  const test = () => {
    if (draft && !operationPending.current) trial.run(draft, testText, translationApi.test);
  };
  const savedTrial = useRef<unknown>(null);
  useEffect(() => {
    if (!trialState.result || savedTrial.current === trialState.result) return;
    savedTrial.current = trialState.result;
    void saveCredentials();
  }, [trialState.result]);
  const link = (url: string) => {
    setLinkError("");
    void openUrl(url).catch((error) => setLinkError(String(error)));
  };
  if (loadError)
    return (
      <Alert
        type="error"
        showIcon
        message="读取翻译设置失败"
        description={loadError}
        action={<Button onClick={() => setAttempt(attempt + 1)}>重试</Button>}
      />
    );
  if (!draft || !saved)
    return (
      <Spin tip="正在读取翻译设置…">
        <div style={{ minHeight: 100 }} />
      </Spin>
    );
  const baidu = draft.provider === "baidu";
  const keyField = baidu ? "baiduKey" : "deeplKey";
  const configured = baidu ? saved.baiduKeyConfigured : saved.deeplKeyConfigured;
  const keyReady = draft[keyField] === null ? configured : Boolean(draft[keyField]?.trim());
  const credentialReady = keyReady && (!baidu || Boolean(draft.baiduAppId.trim()));
  const settingsError = translationSettingsError(draft);
  const testError = trialValidation(draft, testText);
  const languageLabel = (value: string) =>
    SOURCE_LANGUAGES.find((item) => item.value === value)?.label ?? value;
  const savedLabel = saving
    ? "正在保存…"
    : saveError
      ? "保存失败"
      : dirty
        ? "等待保存…"
        : "已自动保存";
  const applyUrl = baidu
    ? "https://fanyi-api.baidu.com/manage/developer"
    : "https://www.deepl.com/pro-api";
  return (
    <div className={styles.page}>
      <Card
        size="small"
        className={`${styles.card} ${styles.trial}`}
        title="翻译测试"
        aria-label="翻译测试"
        extra={
          <Button
            size="small"
            type="primary"
            icon={<TranslationOutlined />}
            loading={trialState.pending}
            disabled={Boolean(testError || settingsError) || !credentialReady || credentialSaving}
            onClick={test}
          >
            {trialState.error ? "重试翻译" : "测试翻译"}
          </Button>
        }
      >
        <div className={styles.workspace}>
          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <span>
                原文 <small>{languageLabel(draft.source)}</small>
              </span>
              <Button
                size="small"
                type="text"
                disabled={!testText}
                onClick={() => {
                  trial.invalidate();
                  setTestText("");
                }}
              >
                清空
              </Button>
            </div>
            <Input.TextArea
              aria-label="测试原文"
              value={testText}
              rows={4}
              className={styles.editor}
              placeholder="输入或粘贴需要翻译的文字"
              onChange={(event) => {
                trial.invalidate();
                setTestText(event.target.value);
              }}
            />
            <div className={styles.paneFooter} data-error={Boolean(testError)}>
              <span>{testError || "支持中、英、日、韩"}</span>
              <span>{Array.from(testText).length.toLocaleString()} / 5,000</span>
            </div>
          </div>
          <div className={`${styles.pane} ${styles.output}`}>
            <div className={styles.paneHeader}>
              <span>
                译文 <small>{languageLabel(draft.target)}</small>
              </span>
              <Button
                size="small"
                type="text"
                disabled={!trialState.result || trialState.pending}
                icon={trialState.copy === "copied" ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => void trial.copy(translationApi.copy)}
              >
                {trialState.copy === "copied" ? "已复制" : "复制"}
              </Button>
            </div>
            <div className={styles.outputBody} aria-live="polite" aria-busy={trialState.pending}>
              <Input.TextArea
                aria-label="测试译文"
                readOnly
                value={trialState.result?.text ?? ""}
                rows={4}
                className={styles.editor}
                placeholder={trialState.pending || trialState.error ? "" : "译文会显示在这里"}
              />
              {trialState.pending && (
                <div className={styles.pending} role="status">
                  <Spin size="small" />
                  <span>正在翻译…</span>
                </div>
              )}
              {trialState.error && (
                <div className={styles.resultError}>
                  <Alert type="error" showIcon message="翻译失败" description={trialState.error} />
                </div>
              )}
            </div>
            <div className={styles.paneFooter} data-error={trialState.copy === "failed"}>
              <span>
                {trialState.copy === "failed"
                  ? "复制失败，请重试"
                  : `${trialState.result ? "本次试译成功 · " : ""}${translationProviderLabel(trialState.result?.provider ?? draft.provider)}`}
              </span>
              <span>
                {trialState.result ? `${(trialState.result.elapsedMs / 1000).toFixed(2)} 秒` : ""}
              </span>
            </div>
          </div>
        </div>
        <p className={styles.privacyNote}>
          仅向所选服务发送文字，不上传截图；测试原文与译文不写入历史。
        </p>
      </Card>
      <div className={styles.topGrid}>
        <Card
          size="small"
          className={`${styles.card} ${styles.serviceConfig}`}
          title="翻译服务"
          aria-label="翻译服务设置"
          extra={
            <div className={styles.headerActions}>
              {editing ? (
                <div className={styles.editActions}>
                  <Button
                    size="small"
                    type="primary"
                    loading={credentialSaving}
                    disabled={
                      trialState.pending ||
                      credentialSaving ||
                      (draft[keyField] !== "" && !credentialReady) ||
                      Boolean(settingsError)
                    }
                    onClick={() => void saveCredentials()}
                  >
                    保存
                  </Button>
                  <Button size="small" disabled={credentialSaving} onClick={cancelEdit}>
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  size="small"
                  disabled={credentialSaving}
                  onClick={() => {
                    setEditing(true);
                    setCredentialError("");
                  }}
                >
                  编辑 API 配置
                </Button>
              )}
              <Button
                type="link"
                size="small"
                icon={<ExportOutlined />}
                onClick={() => link(applyUrl)}
              >
                申请 API
              </Button>
            </div>
          }
        >
          <Form layout="horizontal" size="small" disabled={credentialSaving} className={styles.form}>
            <div className={styles.serviceRow}>
              <TranslationServicePicker
                value={draft.provider}
                busy={credentialSaving}
                className={styles.providerSelect}
                onSwitch={(provider) => void switchService(provider)}
              />
              {credentialSaving && (
                <span className={styles.operationStatus} role="status">
                  <Spin size="small" />
                  正在保存…
                </span>
              )}
            </div>
            <div className={styles.summary}>
              <strong>{translationProviderLabel(draft.provider)}</strong>
              <Tag
                color={(baidu ? saved.baiduVerified : saved.deeplVerified) ? "success" : "default"}
              >
                {(baidu ? saved.baiduVerified : saved.deeplVerified)
                  ? saved.provider === draft.provider
                    ? "已启用"
                    : "测试通过"
                  : configured
                    ? "已保存 · 待测试"
                    : "未配置"}
              </Tag>
              <span>
                {baidu
                  ? saved.baiduAppId
                    ? `App ID：${saved.baiduAppId}`
                    : "填写 App ID 和密钥"
                  : saved.deeplFree
                    ? "API Free"
                    : "API Pro"}
              </span>
            </div>
            {editing && (
              <fieldset disabled={credentialSaving} className={styles.credentialFields}>
                <div className={baidu ? styles.baiduCredentials : styles.deeplCredentials}>
                  {baidu && (
                    <Form.Item
                      label="App ID"
                      required
                      validateStatus={settingsError ? "error" : undefined}
                      help={settingsError || undefined}
                    >
                      <Input
                        aria-label="百度 App ID"
                        maxLength={64}
                        autoComplete="off"
                        value={draft.baiduAppId}
                        placeholder="百度开放平台的 App ID"
                        onChange={(event) => change({ baiduAppId: event.target.value })}
                      />
                    </Form.Item>
                  )}
                  <Form.Item label={baidu ? "密钥" : "API Key"} required>
                    <div className={styles.keyRow}>
                      <Input.Password
                        aria-label={baidu ? "百度密钥" : "DeepL API Key"}
                        autoComplete="new-password"
                        value={draft[keyField] ?? ""}
                        placeholder={configured ? "已保存，留空保留原 Key" : "粘贴服务商提供的 Key"}
                        onChange={(event) => change({ [keyField]: event.target.value || null })}
                      />
                      <Button
                        type="text"
                        disabled={!configured && draft[keyField] === null}
                        onClick={() => change({ [keyField]: "" })}
                      >
                        清除
                      </Button>
                    </div>
                  </Form.Item>
                  {!baidu && (
                    <Form.Item label="API 套餐">
                      <Select
                        aria-label="DeepL API 套餐"
                        value={draft.deeplFree ? "free" : "pro"}
                        options={[
                          { value: "free", label: "API Free" },
                          { value: "pro", label: "API Pro" },
                        ]}
                        onChange={(value) => change({ deeplFree: value === "free" })}
                      />
                    </Form.Item>
                  )}
                </div>
              </fieldset>
            )}
          </Form>
          {editing && (
            <div className={styles.configurationNote}>
              <span>
                {draft[keyField] === ""
                  ? "保存后将清除当前服务的 Key。"
                  : "凭据以明文保存在本机配置中，输入框仅隐藏显示。"}
              </span>
              <span>{baidu ? "需开通通用文本翻译 API" : "API Free 也需要申请自己的 Key"}</span>
            </div>
          )}
          {credentialError && (
            <Alert
              type="error"
              showIcon
              message="配置未保存"
              description={credentialError}
              action={
                <Button
                  size="small"
                  disabled={credentialSaving || Boolean(settingsError)}
                  onClick={() => void saveCredentials()}
                >
                  重试
                </Button>
              }
            />
          )}
          {linkError && (
            <Alert
              type="error"
              showIcon
              message="无法打开申请页面"
              description={linkError}
              action={
                <Button
                  size="small"
                  onClick={() =>
                    void translationApi
                      .copy(applyUrl)
                      .then((ok) => {
                        if (!ok) throw new Error("剪贴板未接受链接");
                        notification.success({ message: "链接已复制" });
                      })
                      .catch((error) =>
                        notification.error({ message: "复制链接失败", description: String(error) }),
                      )
                  }
                >
                  复制链接
                </Button>
              }
            />
          )}
          {!baidu && saved.credentialError && (
            <Alert type="warning" showIcon message={saved.credentialError} />
          )}
        </Card>
        <Card
          size="small"
          className={`${styles.card} ${styles.languageConfig}`}
          title="默认语言"
          aria-label="默认语言设置"
          extra={
            <span className={styles.saveStatus} role="status" data-error={Boolean(saveError)}>
              {savedLabel}
            </span>
          }
        >
          <Form layout="horizontal" size="small" className={styles.form}>
            <div className={styles.languageGrid}>
              <Form.Item label="源语言">
                <Select
                  aria-label="默认源语言"
                  value={draft.source}
                  options={SOURCE_LANGUAGES}
                  onChange={(source) => change({ source })}
                />
              </Form.Item>
              <Form.Item label="目标语言">
                <Select
                  aria-label="默认目标语言"
                  value={draft.target}
                  options={TARGET_LANGUAGES}
                  onChange={(target) => change({ target })}
                />
              </Form.Item>
            </div>
          </Form>
          {saveError && (
            <Alert
              type="error"
              showIcon
              message="设置未保存"
              description={saveError}
              action={
                <Button
                  size="small"
                  onClick={() => schedule({ source: draft.source, target: draft.target }, 0)}
                >
                  重试
                </Button>
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}
