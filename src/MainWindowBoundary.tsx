import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Alert, Button, ConfigProvider, Space } from "antd";
import { recordRuntimeLog } from "./components/runtimeLogging";

export function reportMainWindowError(phase: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  recordRuntimeLog("application", `主窗口${phase}：${message}`, "error");
}

/** Lives outside settings and theme initialization so their failures stay visible. */
export default class MainWindowBoundary extends Component<
  PropsWithChildren,
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  private onWindowError = (event: ErrorEvent) => {
    reportMainWindowError("未捕获异常", event.error ?? event.message);
  };

  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportMainWindowError("未处理异步异常", event.reason);
  };

  componentDidMount() {
    window.dispatchEvent(new Event("dockmapper:main-mounted"));
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportMainWindowError("界面渲染失败", error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <ConfigProvider>
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 24,
            overflow: "auto",
            background: "#f5f7fa",
            color: "#17202a",
          }}
        >
          <Alert
            type="error"
            showIcon
            title="主窗口显示失败"
            description={
              <Space orientation="vertical" style={{ maxWidth: 560, overflowWrap: "anywhere" }}>
                <span>{this.state.error}</span>
                <span>可以重试显示，或重新加载界面。已保存的设置和截图历史会保留。</span>
                <Space wrap>
                  <Button type="primary" onClick={() => this.setState({ error: null })}>
                    重试显示
                  </Button>
                  <Button onClick={() => window.location.reload()}>重新加载界面</Button>
                </Space>
              </Space>
            }
          />
        </div>
      </ConfigProvider>
    );
  }
}
