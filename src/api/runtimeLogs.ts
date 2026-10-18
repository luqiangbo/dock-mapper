export type LogLevel = "info" | "warn" | "error";
export type LogSource =
  | "application"
  | "screenshot"
  | "history"
  | "ocr"
  | "update"
  | "settings"
  | "monitor"
  | "key_mapping";
export type RuntimeLogRecord = { level: LogLevel; source: LogSource; message: string };
export interface RuntimeLogLine {
  id: string;
  timestamp: string;
  source: string;
  level: LogLevel;
  message: string;
}
export interface RuntimeLogSnapshot {
  lines: RuntimeLogLine[];
  truncated: boolean;
}
