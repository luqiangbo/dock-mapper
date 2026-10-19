// Independent of the bundler runtime: a missing initial chunk must not leave an empty window.
(() => {
  const retryKey = "__dock_boot_retry";
  const readyEvent = "dockmapper:main-mounted";
  let ready = false;
  const report = (message) => {
    console.error(message);
    const ipc = window.__TAURI_INTERNALS__;
    if (ipc)
      void ipc
        .invoke("append_runtime_log", {
          source: "application",
          level: "error",
          message,
        })
        .catch((error) => console.error("启动诊断记录失败", error));
  };
  const retry = () => {
    const url = new URL(location.href);
    url.searchParams.set(retryKey, String(Date.now()));
    location.replace(url.href);
  };
  const mounted = () => {
    ready = true;
    clearTimeout(timer);
    document.getElementById("main-window-boot-error")?.remove();
    const url = new URL(location.href);
    if (url.searchParams.has(retryKey)) {
      url.searchParams.delete(retryKey);
      history.replaceState(null, "", url.href);
    }
    window.removeEventListener(readyEvent, mounted);
  };
  const timer = setTimeout(() => {
    if (ready) return;
    report("主窗口入口启动超时：页面资源未完整执行，React 尚未挂载");
    // One automatic retry is safe before the application has mounted; never loop.
    if (!new URL(location.href).searchParams.has(retryKey)) {
      retry();
      return;
    }
    // Ant Design is part of the failed entry; this fallback must use browser primitives.
    const panel = document.createElement("section");
    panel.id = "main-window-boot-error";
    panel.setAttribute("role", "alert");
    panel.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;background:var(--dock-boot-bg,#f3f5f7);color:var(--dock-boot-text,#20252b);font:14px/1.6 'Segoe UI','Microsoft YaHei UI',sans-serif;text-align:center";
    const title = document.createElement("strong");
    title.textContent = "主窗口资源加载失败";
    title.style.fontSize = "20px";
    const description = document.createElement("span");
    description.textContent =
      "界面入口未能启动。请重试加载；若仍然失败，请查看开发终端和应用日志。";
    const button = document.createElement("button");
    button.textContent = "重新加载界面";
    button.style.cssText =
      "padding:8px 20px;border:1px solid #526d87;border-radius:6px;background:#526d87;color:#fff;font:inherit;cursor:pointer";
    button.addEventListener("click", retry);
    panel.append(title, description, button);
    document.body.append(panel);
  }, 12000);
  window.addEventListener(readyEvent, mounted);
  window.addEventListener(
    "error",
    (event) => {
      if (ready) return;
      const target = event.target;
      if (target instanceof HTMLScriptElement)
        report(`主窗口脚本加载失败：${new URL(target.src, location.href).pathname}`);
      else if (event.message) report(`主窗口启动异常：${event.message}`);
    },
    true,
  );
  window.addEventListener(
    "pagehide",
    () => {
      clearTimeout(timer);
      window.removeEventListener(readyEvent, mounted);
    },
    { once: true },
  );
})();
