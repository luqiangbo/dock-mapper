import { Component, type PropsWithChildren } from "react";
import { Alert, Button, Popconfirm, Space } from "antd";
import { recordRuntimeLog } from "./runtimeLogging";
import { isModuleResourceError } from "./pageFailure";

export default class PageBoundary extends Component<
  PropsWithChildren<{ pageKey: string }>,
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }
  componentDidCatch(error: Error) {
    recordRuntimeLog(
      "application",
      `页面 ${this.props.pageKey} 显示失败：${String(error)}`,
      "error",
    );
  }
  render() {
    return this.state.error ? (
      <Alert
        type="error"
        showIcon
        title="页面显示失败"
        description={
          <Space orientation="vertical">
            <span>{this.state.error}</span>
            {isModuleResourceError(this.state.error) && (
              <span>界面模块未能正确加载，请重新加载界面以获取完整资源。</span>
            )}
          </Space>
        }
        action={
          isModuleResourceError(this.state.error) ? (
            <Popconfirm
              title="重新加载界面？"
              description="所有页面中尚未保存的内容可能丢失。已保存的设置和截图历史会保留。"
              okText="重新加载"
              cancelText="取消"
              onConfirm={() => window.location.reload()}
            >
              <Button>重新加载界面</Button>
            </Popconfirm>
          ) : (
            <Button onClick={() => this.setState({ error: null })}>重试</Button>
          )
        }
      />
    ) : (
      this.props.children
    );
  }
}
