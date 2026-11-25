// ==========================================================================
// ProcWeaver src-next 实时日志服务层 (Logs Service)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics
// ==========================================================================

import { LogEntry } from "../types/logs";
import { isTauriEnvironment } from "./client";

export const MAX_LOG_BUFFER_SIZE = 2000;
let logSeq = 0;
let GLOBAL_LOG_POOL: LogEntry[] = [];
const LISTENERS = new Set<() => void>();

function notify() {
  for (const cb of LISTENERS) {
    try {
      cb();
    } catch (e) {
      console.warn("[logsService] notify failed:", e);
    }
  }
}

/**
 * 追加一条结构化日志到全局池
 */
export function appendLog(
  level: "info" | "warning" | "error" | "debug",
  payload: string
): LogEntry {
  const now = new Date();
  const timeStr = `${now.toTimeString().split(" ")[0]}.${String(
    now.getMilliseconds()
  ).padStart(3, "0")}`;

  const entry: LogEntry = {
    id: `${now.getTime()}-${++logSeq}`,
    time: timeStr,
    timestamp: now.getTime(),
    level,
    payload,
  };

  GLOBAL_LOG_POOL.push(entry);
  if (GLOBAL_LOG_POOL.length > MAX_LOG_BUFFER_SIZE) {
    GLOBAL_LOG_POOL.splice(0, GLOBAL_LOG_POOL.length - MAX_LOG_BUFFER_SIZE);
  }

  notify();
  return entry;
}

/**
 * 获取当前全局池中全部日志快照
 */
export function getSnapshotLogs(): LogEntry[] {
  return [...GLOBAL_LOG_POOL];
}

/**
 * 清空全局日志池
 */
export function clearLogs(): void {
  GLOBAL_LOG_POOL = [];
  notify();
}

/**
 * 订阅实时日志更新
 */
export function subscribeLogs(cb: () => void): () => void {
  LISTENERS.add(cb);
  return () => {
    LISTENERS.delete(cb);
  };
}

// 模拟仿真日志模板 (供浏览器端预览体验)
const MOCK_EVENTS: { level: LogEntry["level"]; text: string }[] = [
  { level: "info", text: "[TCP] 127.0.0.1:54321 --> api.openai.com:443 match RuleSet(nb-ai) using Proxy[香港 01 | 极速专线 [BGP]]" },
  { level: "info", text: "[DNS] resolve domain: chatgpt.com --> 104.18.32.7 from remote Doh(1.1.1.1) in 18ms" },
  { level: "debug", text: "[WinDivert] early bypass non-proxied packet from PID 11204 (svchost.exe), offloaded in 0.001ms" },
  { level: "info", text: "[TCP] 127.0.0.1:54328 --> api.anthropic.com:443 match ProcessName(cursor.exe) using Proxy[日本 02 | 专线]" },
  { level: "info", text: "[TCP] 127.0.0.1:54402 --> github.com:443 match RuleSet(nb-github) using Proxy[香港 01 | 极速专线 [BGP]]" },
  { level: "warning", text: "[STUN] blocked WebRTC STUN probe packet to 142.250.190.127:3478 from browser, leak prevented" },
  { level: "info", text: "[TCP] 127.0.0.1:54510 --> api.bilibili.com:443 match GEOSITE(cn) using DIRECT" },
  { level: "debug", text: "[Fake-IP] map 198.18.0.42 <--> api.anthropic.com stored in memory table" },
  { level: "info", text: "[Rule-Provider] provider [nb-ai] verified cache SHA256 matches remote, status 304" },
  { level: "error", text: "[Dial] connect to fallback node node-us-backup.example.org:443 timeout after 3000ms" },
];

/**
 * 建立与核心的 WebSocket 实时日志流管道
 */
export function initLogsStream(
  controllerPort: number = 9090,
  secret?: string,
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void
): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let mockTimer: ReturnType<typeof setInterval> | undefined;
  let isClosed = false;

  const connect = () => {
    if (isClosed) return;
    if (onStatusChange) onStatusChange("connecting");

    const wsUrl = `ws://127.0.0.1:${controllerPort}/logs?level=debug${
      secret ? `&token=${encodeURIComponent(secret)}` : ""
    }`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (isClosed) return;
        if (onStatusChange) onStatusChange("connected");
        appendLog("info", `[系统] 已成功连接至内核实时日志流 (Port ${controllerPort})`);
        if (mockTimer) clearInterval(mockTimer);
      };

      ws.onmessage = (e) => {
        if (isClosed || typeof e.data !== "string") return;
        try {
          const data = JSON.parse(e.data);
          const rawLevel = typeof data?.type === "string" ? data.type.toLowerCase() : "info";
          const cleanLevel = rawLevel === "warn" || rawLevel === "warning"
            ? "warning"
            : rawLevel === "error" || rawLevel === "debug" ? rawLevel : "info";
          appendLog(cleanLevel, typeof data?.payload === "string" ? data.payload : e.data);
        } catch {
          appendLog("info", e.data);
        }
      };

      ws.onerror = () => {
        // 静默处理，由 onclose 触发重连或退避
      };

      ws.onclose = () => {
        if (isClosed) return;
        if (onStatusChange) onStatusChange("disconnected");
        reconnectTimer = setTimeout(connect, 3000);
      };
    } catch (err) {
      if (onStatusChange) onStatusChange("disconnected");
      if (!isClosed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    }
  };

  if (isTauriEnvironment()) {
    connect();
  } else {
    // 浏览器开发模式: 初始化一批日志并周期性生成仿真事件
    if (GLOBAL_LOG_POOL.length === 0) {
      appendLog("info", "[系统] 浏览器前端开发预览环境已就绪，启动模拟内核日志流...");
      MOCK_EVENTS.forEach((e) => appendLog(e.level, e.text));
    }
    if (onStatusChange) onStatusChange("connected");

    mockTimer = setInterval(() => {
      const idx = Math.floor(Math.random() * MOCK_EVENTS.length);
      const ev = MOCK_EVENTS[idx];
      appendLog(ev.level, ev.text);
    }, 2400);
  }

  return () => {
    isClosed = true;
    if (ws) {
      ws.close();
      ws = null;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (mockTimer) clearInterval(mockTimer);
  };
}

/**
 * 导出当前过滤后的日志为纯文本文件 (.txt)
 */
export function formatLogLine(entry: LogEntry): string {
  return `[${entry.time}] [${entry.level.toUpperCase()}] ${entry.payload}`;
}

export function exportLogsText(logs: LogEntry[]): void {
  const content = logs.map(formatLogLine).join("\r\n");

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `procweaver-logs-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
