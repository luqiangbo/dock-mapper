import { invokeCommand } from "../api/ipc";
import type { LogLevel, LogSource } from "../api/runtimeLogs";
import { createLogWriter } from "./runtimeLogWriter";

export const runtimeLogWriter = createLogWriter((record) =>
  invokeCommand("append_runtime_log", record),
);
export function recordRuntimeLog(source: LogSource, message: string, level: LogLevel = "info") {
  // Only fixed operation names and error summaries are passed here, never command payloads/results.
  runtimeLogWriter.record({ source, level, message: Array.from(message).slice(0, 500).join("") });
}
export async function logOperation<T>(
  source: LogSource,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  recordRuntimeLog(source, `${name}开始`);
  try {
    const result = await run();
    recordRuntimeLog(source, `${name}完成`);
    return result;
  } catch (error) {
    recordRuntimeLog(source, `${name}失败：${String(error)}`, "error");
    throw error;
  }
}

const readFailures = new Map<string, string>();
export async function logRead<T>(
  source: LogSource,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = source + ":" + name;
  try {
    const result = await run();
    if (readFailures.has(key)) {
      recordRuntimeLog(source, name + "已恢复");
      readFailures.delete(key);
    }
    return result;
  } catch (error) {
    const message = String(error);
    if (readFailures.get(key) !== message)
      recordRuntimeLog(source, name + "失败：" + message, "error");
    readFailures.set(key, message);
    throw error;
  }
}
