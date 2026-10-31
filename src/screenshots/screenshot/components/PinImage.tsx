import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Dropdown, Slider } from "antd";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copyBinaryPayload } from "../utils/binaryPayload";
import { invokeCommand, type PinActionCommand } from "../../../api/ipc";
import type { PinOptions } from "../../../api/screenshotTypes";
import { pinDoubleClickAction, savedPinMatchesDraft } from "./pinInteractions";
import { usePinDragging } from "../hooks/usePinDragging";
import { usePinOcr } from "../hooks/usePinOcr";
import { usePinZoomController } from "../hooks/usePinZoomController";
import { createPinOptionStager } from "../hooks/pinOptionStager";

export default function PinImage(): React.JSX.Element {
  const pinId = new URLSearchParams(window.location.search).get("id") ?? getCurrentWindow().label;
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const retryOperation = useRef<(() => void) | null>(null);
  const actionBusy = useRef(false);
  const [actionPending, setActionPending] = useState(false);
  const [dismissedZoom, setDismissedZoom] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [optionsReady, setOptionsReady] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [savingOptions, setSavingOptions] = useState(false);
  const [options, setOptions] = useState<PinOptions>({
    opacity: 1,
    locked: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const imageUrlRef = useRef("");
  const mountedRef = useRef(true);
  const draftOptionsRef = useRef<PinOptions | null>(null);
  const writer = useMemo(
    () =>
      createPinOptionStager({
        save: (next) =>
          invokeCommand("update_pin_options", {
            id: pinId,
            opacity: next.opacity,
            locked: next.locked,
            deferSave: true,
          }),
        onSaved: (saved, latest) => {
          if (!mountedRef.current) return;
          if (latest) setOptions(saved);
        },
        onError: (error, latest) => {
          if (!mountedRef.current || !latest) return;
          setOptionsError(`贴图设置未保存：${String(error)}`);
          if (latest) setSavingOptions(false);
        },
        onBusyChange: (busy) => {
          if (mountedRef.current && busy) setSavingOptions(true);
        },
      }),
    [pinId],
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      writer.cancelPending();
    };
  }, [writer]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const {
    onWheel: scaleAtPointer,
    zoomError,
    reset,
  } = usePinZoomController(pinId, optionsReady && !options.locked);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let revision = 0;

    const refreshImage = async (): Promise<void> => {
      const request = ++revision;
      try {
        // `tauri::ipc::Response` is delivered to JavaScript as an ArrayBuffer.
        // Normalize it instead of relying on the invoke generic, which only
        // affects TypeScript and does not convert the runtime value.
        const png = await invokeCommand("get_pin_image", { id: pinId });
        const pngBuffer = copyBinaryPayload(png);
        if (disposed || request !== revision) return;
        const nextUrl = URL.createObjectURL(new Blob([pngBuffer], { type: "image/png" }));
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = nextUrl;
        setLoadError("");
        setImageUrl(nextUrl);
      } catch (error) {
        if (disposed || request !== revision) return;
        const detail = error instanceof Error ? error.message : String(error);
        setLoadError(`贴图加载失败：${detail}`);
      }
    };

    // Register first, then request current data. This closes the race between
    // the hidden prewarmed renderer loading and the first pin operation.
    void listen<string>("pin-image-updated", ({ payload }) => {
      if (payload === pinId) void refreshImage();
    })
      .then((off) => {
        if (disposed) {
          off();
          return;
        }
        unlisten = off;
        void refreshImage();
      })
      .catch((error) => {
        if (!disposed) {
          setOperationError(`贴图更新监听失败：${String(error)}`);
          void refreshImage();
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = "";
    };
  }, [pinId, reloadAttempt]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    setOptionsReady(false);
    setOptionsError("");
    void listen<{ id: string; options: PinOptions }>("pin-options-changed", ({ payload }) => {
      if (payload.id === pinId && !disposed && !writer.isBusy() && !draftOptionsRef.current) {
        setOptions(payload.options);
        setOptionsReady(true);
      }
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
        const value = await invokeCommand("get_pin_options", { id: pinId });
        if (!disposed && !writer.isBusy() && !draftOptionsRef.current) {
          setOptions(value);
          setOptionsReady(true);
        }
      })
      .catch((error) => {
        if (!disposed) setOptionsError("贴图设置读取失败：" + String(error));
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [pinId, writer, reloadAttempt]);

  useEffect(() => {
    let disposed = false,
      off: (() => void) | undefined;
    void listen<string>("pin-persistence-error", ({ payload }) => {
      if (!disposed) {
        setOptionsError(payload);
        setSavingOptions(false);
      }
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch((error) => {
        if (!disposed) setOptionsError(`贴图保存状态监听失败：${String(error)}`);
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      off: (() => void) | undefined;
    void listen<{ id: string; options: PinOptions }>("pin-options-saved", ({ payload }) => {
      if (disposed || payload.id !== pinId) return;
      const draft = draftOptionsRef.current;
      if (!savedPinMatchesDraft(draft, payload.options)) return;
      draftOptionsRef.current = null;
      setOptionsError("");
      setSavingOptions(false);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch((error) => {
        if (!disposed) setOptionsError("保存状态监听失败：" + String(error));
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [pinId]);
  const ocrLayer = usePinOcr(pinId, imageUrl);

  const pinDragging = usePinDragging(optionsReady && !options.locked && !actionPending, (error) => {
    retryOperation.current = null;
    setOperationError(error);
  });
  const startDragging = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (menuOpen && !(event.target as HTMLElement).closest(".pin-menu")) {
      setMenuOpen(false);
      return;
    }
    pinDragging.down(event);
  };

  const updateOptions = (next: PinOptions): void => {
    draftOptionsRef.current = next;
    setOptions(next);
    setOptionsError("");
    setSavingOptions(true);
    writer.write(next);
  };

  const runPinCommand = async (command: PinActionCommand | "restore_closed_pin"): Promise<void> => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setActionPending(true);
    setOperationError("");
    retryOperation.current = () => void runPinCommand(command);
    try {
      await writer.whenIdle();
      if (command === "close_pin_window" && draftOptionsRef.current) {
        const next = draftOptionsRef.current;
        await invokeCommand("update_pin_options", {
          id: pinId,
          opacity: next.opacity,
          locked: next.locked,
        });
      }
      if (command === "restore_closed_pin") await invokeCommand(command);
      else await invokeCommand(command, { id: pinId });
      if (mountedRef.current) setMenuOpen(false);
    } catch (error) {
      if (mountedRef.current) setOperationError("贴图操作失败：" + String(error));
    } finally {
      actionBusy.current = false;
      if (mountedRef.current) setActionPending(false);
    }
  };

  return (
    <Dropdown
      trigger={["contextMenu"]}
      open={menuOpen}
      onOpenChange={(open, info) => {
        if (info.source === "trigger") setMenuOpen(open);
      }}
      autoFocus
      menu={{
        selectable: false,
        items: [
          {
            key: "lock",
            label: options.locked ? "解除锁定" : "锁定位置",
            disabled: !optionsReady,
            onClick: () => updateOptions({ ...options, locked: !options.locked }),
          },
          {
            key: "restore",
            label: "恢复上次关闭贴图",
            disabled: actionPending,
            onClick: () => void runPinCommand("restore_closed_pin"),
          },
          { key: "copy", label: "复制图片", onClick: () => void runPinCommand("copy_pin_image") },
          { key: "save", label: "保存图片", onClick: () => void runPinCommand("save_pin_image") },
          {
            key: "close",
            label: "关闭贴图",
            danger: true,
            onClick: () => void runPinCommand("close_pin_window"),
          },
        ],
      }}
      popupRender={(menu) => (
        <div
          className="pin-menu"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="pin-menu__settings">
            <span role="status" aria-live="polite">
              {optionsError
                ? optionsReady
                  ? "保存失败"
                  : "读取失败"
                : !optionsReady
                  ? "正在读取…"
                  : savingOptions
                    ? "正在保存…"
                    : draftOptionsRef.current
                      ? "未保存"
                      : "已保存"}
            </span>
            {optionsError && draftOptionsRef.current && (
              <Button
                size="small"
                loading={savingOptions}
                onClick={() => {
                  if (draftOptionsRef.current) updateOptions(draftOptionsRef.current);
                }}
              >
                重试保存
              </Button>
            )}
            <span id="pin-opacity-label">透明度 {Math.round(options.opacity * 100)}%</span>
            <Slider
              ariaLabelledByForHandle="pin-opacity-label"
              min={20}
              max={100}
              step={5}
              disabled={!optionsReady}
              value={Math.round(options.opacity * 100)}
              onChange={(value) => updateOptions({ ...options, opacity: value / 100 })}
            />
          </div>
          {menu}
        </div>
      )}
    >
      <div
        className={`pin-wrap${loadError ? " pin-wrap-error" : ""}`}
        onPointerDown={startDragging}
        onPointerMove={pinDragging.move}
        onWheel={(event) => {
          if (event.ctrlKey) {
            event.preventDefault();
            if (optionsReady)
              updateOptions({
                ...options,
                opacity: Math.max(
                  0.2,
                  Math.min(1, options.opacity + (event.deltaY < 0 ? 0.05 : -0.05)),
                ),
              });
          } else scaleAtPointer(event);
        }}
        onAuxClick={(event) => {
          if (event.button === 1 && optionsReady && !options.locked && !actionPending) {
            event.preventDefault();
            reset();
            updateOptions({ ...options, opacity: 1 });
          }
        }}
        onDoubleClick={(event) => {
          if (
            (event.target as Element).closest(
              "button,.pin-operation-feedback,.pin-load-error,.pin-menu",
            )
          )
            return;
          if (
            pinDoubleClickAction({
              shift: event.shiftKey,
              locked: options.locked,
              busy: actionBusy.current,
              afterDrag: pinDragging.suppressDoubleClick(),
              textSelected: Boolean(window.getSelection()?.toString()),
            }) !== "close"
          )
            return;
          event.preventDefault();
          void runPinCommand("close_pin_window");
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            draggable={false}
            style={{ opacity: options.opacity }}
            onLoad={() => {
              setLoadError("");
              void invokeCommand("pin_image_ready", { id: pinId }).catch((error) => {
                setOperationError(
                  `贴图显示失败：${error instanceof Error ? error.message : String(error)}`,
                );
              });
            }}
            onError={() => setLoadError("贴图加载失败：无法解码 PNG 图片")}
          />
        ) : null}
        {ocrLayer}
        {(operationError || optionsError || (zoomError && zoomError !== dismissedZoom)) && (
          <div
            className="pin-operation-feedback"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Alert
              type="error"
              title={operationError || optionsError || zoomError}
              closable
              onClose={() => {
                setOperationError("");
                setOptionsError("");
                setDismissedZoom(zoomError);
              }}
              action={
                optionsError || (operationError && retryOperation.current) ? (
                  <Button
                    size="small"
                    onClick={() => {
                      if (optionsError) {
                        if (draftOptionsRef.current) updateOptions(draftOptionsRef.current);
                        else setReloadAttempt((value) => value + 1);
                      } else retryOperation.current?.();
                    }}
                  >
                    重试
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
        {options.locked && <span className="pin-lock-status">已锁定</span>}
        {loadError ? (
          <div className="pin-load-error" role="alert">
            {loadError}
            {(loadError || (optionsError && !optionsReady)) && (
              <Button
                size="small"
                onClick={() => {
                  setLoadError("");
                  setReloadAttempt((attempt) => attempt + 1);
                }}
              >
                重新读取
              </Button>
            )}
          </div>
        ) : null}
        <Button
          type="text"
          shape="circle"
          className="pin-close"
          aria-label="关闭贴图"
          title="关闭贴图"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => void runPinCommand("close_pin_window")}
        >
          ×
        </Button>
      </div>
    </Dropdown>
  );
}
