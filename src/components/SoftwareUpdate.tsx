import { useSyncExternalStore } from "react";
import { Alert, Button, Progress, Space, Spin, Typography } from "antd";
import { usePageModal } from "./PageActivity";
import { ReloadOutlined } from "@ant-design/icons";
import { updateController } from "./updateRuntime";
import { updateBusy, updatePercent } from "./updateController";

const STAGES = {
  check: "检查更新失败",
  download: "下载或校验失败",
  install: "安装失败",
  restart: "重启失败",
};
function bytes(value: number) {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
export default function SoftwareUpdate() {
  const state = useSyncExternalStore(updateController.subscribe, updateController.getSnapshot);
  const modal = usePageModal();
  const percent = updatePercent(state);
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Button
          icon={<ReloadOutlined />}
          loading={state.phase === "checking"}
          disabled={updateBusy(state)}
          onClick={() => void updateController.check()}
        >
          检查更新
        </Button>
        {state.phase === "available" && (
          <Button
            type="primary"
            onClick={() =>
              modal.confirm({
                title: `安装 DockMapper v${state.version}？`,
                content: "下载和校验完成后将启动安装程序，应用会退出并重新启动。",
                okText: "下载并安装",
                cancelText: "稍后",
                onOk: () => {
                  void updateController.install();
                },
              })
            }
          >
            下载并安装 v{state.version}
          </Button>
        )}
        {state.phase === "latest" && (
          <Typography.Text type="success">当前已是最新版本</Typography.Text>
        )}
      </Space>
      <div role="status" aria-live="polite">
        {state.phase === "downloading" && (
          <>
            <Typography.Text>
              正在下载 v{state.version} · {bytes(state.downloaded)}
              {state.total ? ` / ${bytes(state.total)}` : " · 总大小未知"}
            </Typography.Text>
            {percent === undefined ? (
              <Spin size="small" />
            ) : (
              <Progress percent={percent} status="active" />
            )}
          </>
        )}
        {state.phase === "installing" && (
          <Typography.Text>下载及校验完成，正在启动安装程序…应用可能自动退出。</Typography.Text>
        )}
        {state.phase === "restarting" && (
          <Typography.Text>安装步骤已完成，正在重新启动…</Typography.Text>
        )}
        {state.phase === "ready" && (
          <Typography.Text>
            已发起重新启动；若窗口仍保留，可手动退出后重新打开应用。
          </Typography.Text>
        )}
      </div>
      {state.phase === "error" && (
        <Alert
          showIcon
          type="error"
          message={STAGES[state.failedAt ?? "check"]}
          description={`${state.error}。${state.failedAt === "restart" ? "可重试重启，或手动退出后重新打开应用。" : "请检查网络、磁盘空间或系统权限后重试；下载和安装失败会重新检查并下载更新。"}`}
          action={
            <Button onClick={() => void updateController.retry()}>
              {state.failedAt === "restart" ? "重试重启" : "重试更新"}
            </Button>
          }
        />
      )}
      {state.warning && <Alert type="warning" showIcon message={state.warning} />}
    </Space>
  );
}
