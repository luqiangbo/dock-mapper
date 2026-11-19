import { App as AntApp, Button, Space, Typography } from "antd";
import { relaunch } from "@tauri-apps/plugin-process";
import { invokeCommand } from "../api/ipc";
import { errorMessage } from "../api/commands";
import { createSettingsReset } from "./settingsResetFlow";

export default function ResetSettings() {
  const { modal, notification } = AntApp.useApp();
  const show = () => {
    let committed = false;
    const reset = createSettingsReset(async () => {
      await invokeCommand("reset_app_settings");
      committed = true;
    }, relaunch);
    const dialog = modal.confirm({
      title: "恢复默认设置并重启？",
      content: (
        <Space orientation="vertical">
          <Typography.Text>
            将恢复应用设置、快捷键、运行时映射、外观和导航，清除翻译服务配置及密钥，并关闭开机启动。
          </Typography.Text>
          <Typography.Text>
            截图历史及收藏、日志和统计归档会保留；Windows 系统键盘映射及恢复资料不受影响。
          </Typography.Text>
          <Typography.Text>应用将重启，当前未完成的截图编辑会结束。</Typography.Text>
        </Space>
      ),
      okText: "恢复并重启",
      cancelText: "取消",
      okButtonProps: { danger: true },
      maskClosable: false,
      keyboard: false,
      onOk: async () => {
        dialog.update({ cancelButtonProps: { disabled: true } });
        try {
          await reset();
          // Keep the modal blocking new edits while the native process exits.
          dialog.update({ title: "设置已恢复，正在重启…", okButtonProps: { disabled: true } });
          return await new Promise<void>(() => {});
        } catch (error) {
          notification.error({
            message: committed ? "设置已恢复，请手动重启" : "恢复设置失败",
            description: errorMessage(error),
            duration: 0,
          });
          dialog.update(
            committed
              ? {
                  title: "设置已恢复，请重启应用",
                  content: errorMessage(error),
                  okText: "重试重启",
                  cancelButtonProps: { disabled: true },
                }
              : { cancelButtonProps: { disabled: false } },
          );
          throw error;
        }
      },
    });
  };
  return (
    <Space orientation="vertical">
      <Typography.Text type="secondary">手动恢复应用默认设置，保留截图历史和收藏。</Typography.Text>
      <Button danger onClick={show}>
        恢复默认设置
      </Button>
    </Space>
  );
}
