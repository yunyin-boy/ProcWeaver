// ==========================================================================
// ProcWeaver src-next 实时日志系统类型定义 (Logs Types)
// 规范溯源: typography-dark-mono-optics / tauri-desktop-layout-typography
// ==========================================================================

export type LogLevel = "all" | "info" | "warning" | "error" | "debug";

export interface LogEntry {
  id: string;
  time: string;           // 格式化时间字符串 HH:mm:ss.SSS
  timestamp: number;      // 毫秒时间戳
  level: "info" | "warning" | "error" | "debug";
  payload: string;        // 日志原始内容
}

export interface LogFilterState {
  level: LogLevel;
  search: string;
  autoScroll: boolean;
  isPaused: boolean;
}
