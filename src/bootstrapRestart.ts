/** A self-relaunch exits Tauri's watched child and tears down its dev server. */
export async function restartForBuild(development: boolean, relaunch: () => Promise<void>) {
  if (development)
    throw new Error(
      "开发服务的构建标识已变化。请从托盘退出旧实例，再重新运行 pnpm tauri dev；开发模式不会自动重启原生进程，以免关闭开发服务。",
    );
  await relaunch();
}
