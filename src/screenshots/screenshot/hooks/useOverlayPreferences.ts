import { listen } from "@tauri-apps/api/event";
import { defaultScreenshotTools, normalizeScreenshotTools } from "../../../utils/screenshotTools";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAIN_EVENTS, paletteApi } from "../../../api/commands";
import type {
  AnnotationOutlineConfig,
  ColorPaletteConfig,
  ScreenshotAnnotationStyles,
  ScreenshotConfig,
} from "../../../types";
import type { CaptureSizeUnit } from "../components/selectionSizeGeometry";
import {
  cloneAnnotationStyles,
  DEFAULT_ANNOTATION_STYLES,
} from "../components/annotationStyleDefaults";

interface OverlayPreferencesOptions {
  onError: (message: string) => void;
}

export function useOverlayPreferences({ onError }: OverlayPreferencesOptions) {
  const mounted = useRef(true);
  const paletteTail = useRef<Promise<void>>(Promise.resolve());
  const palettePending = useRef(0);
  const configRef = useRef<ScreenshotConfig | null>(null);
  const toolbarRevision = useRef(0);
  const configTail = useRef<Promise<void>>(Promise.resolve());
  const configRevision = useRef(0);
  const configPending = useRef(0);
  const styleRevision = useRef(0);
  const [styleSaveFailed, setStyleSaveFailed] = useState(false);
  const [styleSaveAttempted, setStyleSaveAttempted] = useState(false);
  const [palette, setPalette] = useState<ColorPaletteConfig>({ recent: [], favorites: [] });
  const [paletteBusy, setPaletteBusy] = useState(false);
  const [pickerFormat, setPickerFormat] = useState<ScreenshotConfig["color_copy_format"]>("hex");
  const [annotationColor, setAnnotationColor] = useState("#e03131");
  const [annotationOutline, setAnnotationOutline] = useState<AnnotationOutlineConfig>({
    enabled: true,
    color: "#ffffff",
    width: 1,
  });
  const [annotationStyles, setAnnotationStyles] = useState<ScreenshotAnnotationStyles>(() =>
    cloneAnnotationStyles(DEFAULT_ANNOTATION_STYLES),
  );
  const [captureSizeUnit, setCaptureSizeUnit] = useState<CaptureSizeUnit>("px");
  const [toolbarTools, setToolbarTools] = useState(defaultScreenshotTools);
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      configRevision.current += 1;
    };
  }, []);

  const reloadPalette = useCallback(async (): Promise<void> => {
    try {
      await paletteTail.current;
      const next = await paletteApi.get();
      if (mounted.current) setPalette(next);
    } catch (cause) {
      if (mounted.current) {
        onError(`颜色列表读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }, [onError]);

  const mutatePalette = useCallback(
    async (
      operation: () => Promise<ColorPaletteConfig>,
      failureMessage: string,
    ): Promise<boolean> => {
      palettePending.current += 1;
      setPaletteBusy(true);
      const mutation = paletteTail.current.then(operation, operation);
      paletteTail.current = mutation.then(
        () => undefined,
        () => undefined,
      );
      try {
        const next = await mutation;
        if (mounted.current) setPalette(next);
        return true;
      } catch (cause) {
        if (mounted.current) {
          onError(`${failureMessage}：${cause instanceof Error ? cause.message : String(cause)}`);
        }
        return false;
      } finally {
        palettePending.current -= 1;
        if (mounted.current && palettePending.current === 0) setPaletteBusy(false);
      }
    },
    [onError],
  );

  const updateConfig = useCallback(
    async (changes: Partial<ScreenshotConfig>, failureMessage: string): Promise<boolean> => {
      const revision = ++configRevision.current;
      configPending.current += 1;
      setConfigSaving(true);
      const mutation = configTail.current.then(async () => {
        const current = configRef.current ?? (await window.api.getScreenshotConfig());
        const next = await window.api.updateScreenshotConfig({ ...current, ...changes });
        configRef.current = next;
        if (mounted.current && revision === configRevision.current) {
          setPickerFormat(next.color_copy_format);
          setAnnotationColor(next.annotation_color);
          setAnnotationOutline(next.annotation_outline);
          setAnnotationStyles(cloneAnnotationStyles(next.annotation_styles));
          setCaptureSizeUnit(next.capture_size_unit);
          setToolbarTools(normalizeScreenshotTools(next.toolbar_tools));
        }
      });
      configTail.current = mutation.then(
        () => undefined,
        () => undefined,
      );
      try {
        await mutation;
        return true;
      } catch (cause) {
        if (mounted.current) {
          onError(`${failureMessage}：${cause instanceof Error ? cause.message : String(cause)}`);
        }
        return false;
      } finally {
        configPending.current -= 1;
        if (mounted.current && configPending.current === 0) setConfigSaving(false);
      }
    },
    [onError],
  );

  const updateAnnotationStyles = useCallback(
    async (styles: ScreenshotAnnotationStyles, failureMessage: string): Promise<boolean> => {
      const revision = ++configRevision.current;
      const currentStyleRevision = ++styleRevision.current;
      setStyleSaveAttempted(true);
      setStyleSaveFailed(false);
      configPending.current += 1;
      setConfigSaving(true);
      // Style changes remain usable in the current capture even if the atomic
      // persistence step fails. The visible error explains what will happen
      // after restart.
      setAnnotationStyles(cloneAnnotationStyles(styles));
      const mutation = configTail.current.then(async () => {
        const next = await window.api.updateScreenshotAnnotationStyles(styles);
        if (configRef.current) {
          configRef.current = { ...configRef.current, annotation_styles: next };
        }
        if (mounted.current && revision === configRevision.current) {
          setAnnotationStyles(cloneAnnotationStyles(next));
        }
        if (mounted.current && currentStyleRevision === styleRevision.current) setStyleSaveFailed(false);
      });
      configTail.current = mutation.then(
        () => undefined,
        () => undefined,
      );
      try {
        await mutation;
        return true;
      } catch (cause) {
        if (mounted.current && currentStyleRevision === styleRevision.current) {
          setStyleSaveFailed(true);
          onError(`${failureMessage}：${cause instanceof Error ? cause.message : String(cause)}`);
        }
        return false;
      } finally {
        configPending.current -= 1;
        if (mounted.current && configPending.current === 0) setConfigSaving(false);
      }
    },
    [onError],
  );

  const updateAnnotationColor = useCallback(
    async (color: string, failureMessage: string): Promise<boolean> => {
      const revision = ++configRevision.current;
      configPending.current += 1;
      setConfigSaving(true);
      const mutation = configTail.current.then(async () => {
        const normalized = await window.api.updateScreenshotAnnotationColor(color);
        if (configRef.current) {
          configRef.current = { ...configRef.current, annotation_color: normalized };
        }
        if (mounted.current && revision === configRevision.current) {
          setAnnotationColor(normalized);
        }
      });
      configTail.current = mutation.then(
        () => undefined,
        () => undefined,
      );
      try {
        await mutation;
        return true;
      } catch (cause) {
        if (mounted.current) {
          onError(`${failureMessage}：${cause instanceof Error ? cause.message : String(cause)}`);
        }
        return false;
      } finally {
        configPending.current -= 1;
        if (mounted.current && configPending.current === 0) setConfigSaving(false);
      }
    },
    [onError],
  );

  const updateAnnotationOutline = useCallback(
    async (outline: AnnotationOutlineConfig, failureMessage: string): Promise<boolean> => {
      const revision = ++configRevision.current;
      configPending.current += 1;
      setConfigSaving(true);
      const mutation = configTail.current.then(async () => {
        const normalized = await window.api.updateScreenshotAnnotationOutline(outline);
        if (configRef.current) {
          configRef.current = { ...configRef.current, annotation_outline: normalized };
        }
        if (mounted.current && revision === configRevision.current) {
          setAnnotationOutline(normalized);
        }
      });
      configTail.current = mutation.then(
        () => undefined,
        () => undefined,
      );
      try {
        await mutation;
        return true;
      } catch (cause) {
        if (mounted.current) {
          onError(`${failureMessage}：${cause instanceof Error ? cause.message : String(cause)}`);
        }
        return false;
      } finally {
        configPending.current -= 1;
        if (mounted.current && configPending.current === 0) setConfigSaving(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    const revision = configRevision.current;
    const toolbarReadRevision = toolbarRevision.current;
    void window.api
      .getScreenshotConfig()
      .then((config) => {
        if (!mounted.current || revision !== configRevision.current) return;
        configRef.current =
          toolbarReadRevision === toolbarRevision.current
            ? config
            : {
                ...config,
                toolbar_tools: configRef.current?.toolbar_tools ?? config.toolbar_tools,
              };
        setPickerFormat(config.color_copy_format);
        setAnnotationColor(config.annotation_color);
        setAnnotationOutline(config.annotation_outline);
        setAnnotationStyles(cloneAnnotationStyles(config.annotation_styles));
        setCaptureSizeUnit(config.capture_size_unit);
        if (toolbarReadRevision === toolbarRevision.current)
          setToolbarTools(normalizeScreenshotTools(config.toolbar_tools));
      })
      .catch((cause) => {
        if (mounted.current) {
          onError(`截图配置读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      });
    void reloadPalette();
  }, [onError, reloadPalette]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    let request = 0;
    const receive = (config: ScreenshotConfig) => {
      if (disposed) return;
      toolbarRevision.current += 1;
      configRef.current = { ...(configRef.current ?? config), toolbar_tools: config.toolbar_tools };
      setToolbarTools(normalizeScreenshotTools(config.toolbar_tools));
    };
    void listen<ScreenshotConfig>(MAIN_EVENTS.screenshotConfigChanged, ({ payload }) => {
      request += 1;
      receive(payload);
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
        const observed = request;
        const config = await window.api.getScreenshotConfig();
        if (observed === request) receive(config);
      })
      .catch((cause) => {
        if (!disposed) onError("常用工具配置读取或监听失败：" + String(cause));
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [onError]);

  return {
    styleSaveFailed,
    styleSaveAttempted,
    palette,
    paletteBusy,
    pickerFormat,
    annotationColor,
    annotationOutline,
    annotationStyles,
    captureSizeUnit,
    toolbarTools,
    configSaving,
    reloadPalette,
    mutatePalette,
    updateConfig,
    updateAnnotationColor,
    updateAnnotationOutline,
    updateAnnotationStyles,
  };
}
