import type { RuntimeLogRecord } from "../api/runtimeLogs";

/** Bounded, ordered writes with explicit failure and manual retry. */
export function createLogWriter(write: (record: RuntimeLogRecord) => Promise<void>) {
  let snapshot = { error: null as string | null, pending: 0 };
  const queue: RuntimeLogRecord[] = [];
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  const notify = (error: string | null) => {
    snapshot = { error, pending: queue.length };
    listeners.forEach((listener) => listener());
  };
  const flush = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (queue.length) {
        try {
          await write(queue[0]);
          queue.shift();
          notify(null);
        } catch (error) {
          notify(`日志记录失败：${String(error)}`);
          return;
        }
      }
    })().finally(() => {
      running = null;
      if (queue.length && !snapshot.error) void flush();
    });
    return running;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record(record: RuntimeLogRecord) {
      if (queue.length >= 100) {
        notify("日志待写队列已满，请重试记录或导出诊断；新的记录未保存");
        return;
      }
      queue.push(record);
      notify(snapshot.error);
      if (!snapshot.error) void flush();
    },
    retry: flush,
  };
}
