/** A retry after a failed relaunch must not reset a second time. */
export function createSettingsReset(reset: () => Promise<unknown>, restart: () => Promise<void>) {
  let committed = false;
  return async () => {
    if (!committed) {
      await reset();
      committed = true;
    }
    try {
      await restart();
    } catch (error) {
      throw new Error(`设置已恢复，请手动重启，或点击确定重试重启：${String(error)}`);
    }
  };
}
