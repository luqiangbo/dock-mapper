// This script must run before the bundled entry and only reads appearance preferences.
(() => {
  let mode = "system";
  try {
    const stored = localStorage.getItem("dock-mapper:theme");
    if (stored === "light" || stored === "dark") mode = stored;
  } catch (error) {
    console.warn("启动主题读取失败，使用系统主题", error);
  }
  try {
    const font = (localStorage.getItem("dock-mapper:ui-font") || "").trim();
    if (font && font.length <= 128 && !/["'\\;{}\r\n\x00-\x1f]/.test(font)) {
      document.documentElement.style.setProperty(
        "--app-font-family",
        `"${font}", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif`,
      );
    }
  } catch (error) {
    console.warn("启动字体读取失败，使用系统字体", error);
  }
  const dark =
    mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
