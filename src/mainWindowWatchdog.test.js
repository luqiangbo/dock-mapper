import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../public/main-window-watchdog.js", import.meta.url), "utf8");
function start(url = "http://127.0.0.1:21420/") {
  const handlers = new Map();
  const element = () => ({
    style: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
  });
  const body = element();
  const location = { href: url, replace: vi.fn() };
  const history = { replaceState: vi.fn() };
  const invoke = vi.fn().mockResolvedValue(undefined);
  let timeout;
  runInNewContext(source, {
    URL,
    Date,
    location,
    history,
    console: { error: vi.fn() },
    HTMLScriptElement: class {},
    window: {
      __TAURI_INTERNALS__: { invoke },
      addEventListener: (name, handler) => handlers.set(name, handler),
      removeEventListener: (name) => handlers.delete(name),
    },
    document: { body, createElement: element, getElementById: () => null },
    setTimeout: (callback) => {
      timeout = callback;
      return 1;
    },
    clearTimeout: vi.fn(),
  });
  return {
    body,
    location,
    history,
    invoke,
    emit: (name) => handlers.get(name)?.(),
    timeout: () => timeout(),
  };
}

describe("入口分块未执行时的主窗口恢复", () => {
  it("入口一直等待缺失分块时记录原因，只自动重试一次", () => {
    const first = start();
    first.timeout();
    expect(first.invoke).toHaveBeenCalledWith(
      "append_runtime_log",
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("React 尚未挂载"),
      }),
    );
    expect(first.location.replace).toHaveBeenCalledTimes(1);
    const second = start(first.location.replace.mock.calls[0][0]);
    second.timeout();
    expect(second.location.replace).not.toHaveBeenCalled();
    const panel = second.body.children[0];
    expect(panel.setAttribute).toHaveBeenCalledWith("role", "alert");
    expect(panel.children[0].textContent).toBe("主窗口资源加载失败");
    expect(panel.children[2].textContent).toBe("重新加载界面");
  });

  it("主窗口正常挂载后不重载，也不再留下重试查询参数", () => {
    const page = start("http://127.0.0.1:21420/?__dock_boot_retry=123");
    page.emit("dockmapper:main-mounted");
    page.timeout();
    expect(page.location.replace).not.toHaveBeenCalled();
    expect(page.invoke).not.toHaveBeenCalled();
    expect(page.body.children).toHaveLength(0);
    expect(page.history.replaceState).toHaveBeenCalledWith(null, "", "http://127.0.0.1:21420/");
  });
});
