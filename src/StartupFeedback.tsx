import type { ReactNode } from "react";
import { ConfigProvider, Spin, theme } from "antd";

/** Safe outside application settings/theme providers, including initialization failures. */
export default function StartupFeedback({
  slow = false,
  error,
}: {
  slow?: boolean;
  error?: ReactNode;
}) {
  const dark = document.documentElement.dataset.theme === "dark";
  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#526d87",
          fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
        },
      }}
    >
      <main className="dock-startup" aria-busy={!error}>
        <div className="dock-startup__card">
          <strong className="dock-startup__name">DockMapper</strong>
          {error ? (
            <div className="dock-startup__error">{error}</div>
          ) : (
            <>
              <div className="dock-startup__indicator" aria-hidden="true">
                <Spin size="large" />
              </div>
              <span className="dock-startup__detail" role="status" aria-live="polite">
                正在初始化应用…
              </span>
              <span className="dock-startup__hint" role="status" aria-live="polite">
                {slow ? "启动耗时较长，仍在初始化" : ""}
              </span>
            </>
          )}
        </div>
      </main>
    </ConfigProvider>
  );
}
