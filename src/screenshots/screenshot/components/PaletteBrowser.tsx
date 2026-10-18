import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { Alert, Button, Empty, Input, Popover, Spin, Tooltip } from "antd";
import { Check, Copy, Star } from "lucide-react";
import type { ColorPaletteConfig } from "../../../types";
import {
  INITIAL_PALETTE_BROWSER,
  paletteBrowserReducer,
  paletteGridNextIndex,
  paletteResultIsCurrent,
  searchFavoriteColors,
} from "./paletteBrowserState";

export interface PaletteBrowserProps {
  palette: ColorPaletteConfig;
  busy?: boolean;
  loading?: boolean;
  error?: string | null;
  onCopy?: (color: string) => Promise<void>;
  onFavorite?: (color: string, favorite: boolean) => Promise<boolean>;
  onReload?: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}
export function PaletteBrowser({
  palette,
  busy,
  loading,
  error,
  onCopy,
  onFavorite,
  onReload,
  onOpenChange,
}: PaletteBrowserProps) {
  const [{ open, selected, query, message, failure }, dispatch] = useReducer(
    paletteBrowserReducer,
    INITIAL_PALETTE_BROWSER,
  );
  const [pending, setPending] = useState<"copy" | "favorite" | null>(null);
  const session = useRef(0);
  const mounted = useRef(true);
  const running = useRef(false);
  const reportOpen = useRef(onOpenChange);
  reportOpen.current = onOpenChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current++;
      reportOpen.current(false);
    };
  }, []);
  useEffect(() => {
    if (open && !selected) dispatch({ type: "hydrate", palette });
  }, [open, selected, palette]);
  const changeOpen = (next: boolean) => {
    session.current++;
    dispatch({ type: "open", next, palette });
    reportOpen.current(next);
    if (next) void onReload?.();
  };
  const run = async (kind: "copy" | "favorite", color: string) => {
    if (running.current || busy) return;
    const request = session.current;
    running.current = true;
    setPending(kind);
    dispatch({ type: "feedback" });
    try {
      if (kind === "copy") {
        if (!onCopy) throw new Error("颜色复制暂不可用");
        await onCopy(color);
      } else {
        if (!onFavorite || !(await onFavorite(color, !palette.favorites.includes(color))))
          throw new Error("收藏修改失败，请重试");
      }
      if (paletteResultIsCurrent(request, session.current, mounted.current))
        dispatch({
          type: "feedback",
          message:
            kind === "copy"
              ? "已复制"
              : palette.favorites.includes(color)
                ? "已取消收藏"
                : "已收藏",
        });
    } catch (cause) {
      if (paletteResultIsCurrent(request, session.current, mounted.current))
        dispatch({ type: "feedback", failure: String(cause) });
    } finally {
      running.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const choose = (color: string) => {
    dispatch({ type: "select", color });
  };
  const disabled = Boolean(busy || pending);
  const saved = Boolean(selected && palette.favorites.includes(selected));
  const filtered = searchFavoriteColors(palette.favorites, query);
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-color]"),
    ];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (disabled || index < 0) return;
    const style = getComputedStyle(event.currentTarget);
    const columns =
      style.display === "grid" ? style.gridTemplateColumns.split(" ").length : buttons.length;
    const next = paletteGridNextIndex(index, event.key, buttons.length, columns);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
    const color = buttons[next]?.dataset.color;
    if (color) choose(color);
  };
  const swatch = (color: string) => (
    <Tooltip key={color} title={`${color}${palette.favorites.includes(color) ? " · 已收藏" : ""}`}>
      <Button
        className={`palette-browser__swatch${selected === color ? " is-selected" : ""}`}
        style={{ backgroundColor: color }}
        aria-label={`选择 ${color}`}
        data-color={color}
        aria-pressed={selected === color}
        disabled={disabled}
        onClick={() => choose(color)}
      />
    </Tooltip>
  );
  return (
    <>
      <span className="tool-options__group">
        <span className="tool-options__label">最近</span>
        <span className="palette-strip" aria-label="最近5个颜色">
          {palette.recent.length ? (
            palette.recent.slice(0, 5).map((color) => (
              <Tooltip
                key={color}
                title={`复制 ${color}${palette.favorites.includes(color) ? " · 已收藏" : ""}`}
              >
                <Button
                  type="text"
                  className="palette-strip__swatch"
                  style={{ backgroundColor: color }}
                  aria-label={`复制 ${color}`}
                  disabled={disabled}
                  onClick={() => void run("copy", color)}
                />
              </Tooltip>
            ))
          ) : (
            <span className="palette-strip__empty">暂无</span>
          )}
        </span>
      </span>
      <Popover
        open={open}
        onOpenChange={changeOpen}
        trigger="click"
        placement="bottomRight"
        autoAdjustOverflow
        content={
          <div
            className="palette-browser"
            data-picker-controls
            data-palette-browser
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && !(event.ctrlKey || event.metaKey))
                event.stopPropagation();
            }}
          >
            <div className="palette-browser__heading">最近颜色</div>
            <div className="palette-browser__recent" onKeyDown={moveFocus}>
              {palette.recent.length ? (
                palette.recent.slice(0, 5).map(swatch)
              ) : (
                <span>尚未复制过颜色</span>
              )}
            </div>
            <Input.Search
              aria-label="搜索收藏的HEX颜色"
              placeholder="搜索收藏 HEX"
              value={query}
              allowClear
              onChange={(event) => dispatch({ type: "query", value: event.target.value })}
            />
            <div className="palette-browser__heading">
              收藏颜色 <span>{palette.favorites.length}</span>
              {loading && <Spin size="small" />}
            </div>
            {error && (
              <Alert
                type="error"
                title={error}
                action={
                  <Button size="small" loading={loading} onClick={() => void onReload?.()}>
                    重试
                  </Button>
                }
              />
            )}
            <div className="palette-browser__grid" aria-label="收藏颜色" onKeyDown={moveFocus}>
              {filtered.length ? (
                filtered.map(swatch)
              ) : loading ? (
                <Spin size="small" />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    palette.favorites.length ? "没有匹配颜色" : "暂无收藏，选择最近色后点击收藏"
                  }
                />
              )}
            </div>
            {selected && (
              <div className="palette-browser__selection">
                <div className="palette-browser__value">
                  <span style={{ backgroundColor: selected }} />
                  <code>{selected}</code>
                </div>
                <div className="palette-browser__actions">
                  <Button
                    size="small"
                    icon={<Copy size={14} />}
                    loading={pending === "copy"}
                    disabled={disabled && pending !== "copy"}
                    onClick={() => void run("copy", selected)}
                  >
                    复制
                  </Button>
                  <Button
                    size="small"
                    icon={<Star size={14} fill={saved ? "currentColor" : "none"} />}
                    aria-pressed={saved}
                    loading={pending === "favorite"}
                    disabled={disabled && pending !== "favorite"}
                    onClick={() => void run("favorite", selected)}
                  >
                    {saved ? "取消收藏" : "收藏"}
                  </Button>
                </div>
              </div>
            )}
            {(failure || message) && (
              <div
                className={failure ? "palette-browser__error" : "palette-browser__feedback"}
                role={failure ? "alert" : "status"}
              >
                {failure ?? message}
              </div>
            )}
          </div>
        }
      >
        <Button
          type="text"
          size="small"
          className="palette-browser__trigger"
          icon={<Star size={14} />}
        >
          收藏 · {palette.favorites.length}
        </Button>
      </Popover>
      {!open && (failure || message) && (
        <Tooltip title={failure ?? message}>
          <span
            className={failure ? "palette-browser__error" : "palette-browser__feedback"}
            role={failure ? "alert" : "status"}
          >
            {failure ? "复制失败" : <Check size={14} />}
          </span>
        </Tooltip>
      )}
    </>
  );
}
