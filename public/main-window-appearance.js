// This script must run before the bundled entry and only reads appearance preferences.
(() => {
  let mode = "system";
  try {
    const stored = localStorage.getItem("dock-mapper:theme");
    if (stored === "light" || stored === "dark") mode = stored;
  } catch (error) {
    console.warn("启动主题读取失败，使用系统主题", error);
  }
  const dark =
    mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
