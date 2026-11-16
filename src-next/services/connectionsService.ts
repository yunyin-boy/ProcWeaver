// ==========================================================================
// ProcWeaver src-next 链接追踪服务层 (Connections Service)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics
// ==========================================================================

import {
  ConnectionItem,
  ConnectionsSnapshot,
} from "../types/connections";
import { isTauriEnvironment } from "./client";

// 历史连接缓冲池 (最大保留 500 条)
const MAX_CLOSED_CONNECTIONS = 500;
let CLOSED_CONNECTIONS_BUFFER: ConnectionItem[] = [];
let PREV_CONNECTIONS_MAP = new Map<string, ConnectionItem>();

// 浏览器开发模式下的保真仿真数据池
let MOCK_CONNECTIONS_POOL: ConnectionItem[] = [
  {
    id: "conn-ai-01",
    metadata: {
      network: "tcp",
      type: "HTTPS",
      sourceIP: "127.0.0.1",
      sourcePort: "54231",
      destinationIP: "104.18.32.7",
      destinationPort: "443",
      host: "api.openai.com",
      dnsMode: "fake-ip",
      process: "ChatGPT.exe",
      processPath: "C:\\Program Files\\OpenAI\\ChatGPT.exe",
      inboundName: "pw-windivert-in",
      hookTier: "Direct",
    },
    upload: 124500,
    download: 3892000,
    start: new Date(Date.now() - 420000).toISOString(),
    chains: ["OpenAI 官方套件", "香港 01 | 极速专线 [BGP]"],
    rule: "RULE-SET",
    rulePayload: "nb-ai",
    downloadSpeed: 142000,
    uploadSpeed: 4500,
  },
  {
    id: "conn-ai-02",
    metadata: {
      network: "tcp",
      type: "HTTPS",
      sourceIP: "127.0.0.1",
      sourcePort: "54238",
      destinationIP: "172.64.155.209",
      destinationPort: "443",
      host: "api.anthropic.com",
      dnsMode: "fake-ip",
      process: "cursor.exe",
      processPath: "C:\\Users\\Admin\\AppData\\Local\\Programs\\cursor\\cursor.exe",
      inboundName: "pw-windivert-in",
      hookTier: "IAT",
    },
    upload: 84000,
    download: 1920000,
    start: new Date(Date.now() - 180000).toISOString(),
    chains: ["Cursor 智能套件", "日本 02 | 低延迟游戏专线"],
    rule: "RULE-SET",
    rulePayload: "nb-ai",
    downloadSpeed: 89000,
    uploadSpeed: 2300,
  },
  {
    id: "conn-git-01",
    metadata: {
      network: "tcp",
      type: "HTTPS",
      sourceIP: "127.0.0.1",
      sourcePort: "54312",
      destinationIP: "140.82.114.4",
      destinationPort: "443",
      host: "github.com",
      dnsMode: "fake-ip",
      process: "git.exe",
      processPath: "C:\\Program Files\\Git\\cmd\\git.exe",
      inboundName: "pw-windivert-in",
      hookTier: "Detours",
    },
    upload: 15400,
    download: 8950000,
    start: new Date(Date.now() - 65000).toISOString(),
    chains: ["开发工具加速", "香港 01 | 极速专线 [BGP]"],
    rule: "RULE-SET",
    rulePayload: "nb-github",
    downloadSpeed: 2350000,
    uploadSpeed: 12000,
  },
  {
    id: "conn-media-01",
    metadata: {
      network: "tcp",
      type: "HTTPS",
      sourceIP: "127.0.0.1",
      sourcePort: "54401",
      destinationIP: "142.250.190.46",
      destinationPort: "443",
      host: "rr4---sn-a5meknez.googlevideo.com",
      dnsMode: "fake-ip",
      process: "chrome.exe",
      processPath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      inboundName: "pw-windivert-in",
      hookTier: "Direct",
    },
    upload: 43200,
    download: 24500000,
    start: new Date(Date.now() - 520000).toISOString(),
    chains: ["流媒体优选", "台湾 01 | 4K流媒体原生"],
    rule: "RULE-SET",
    rulePayload: "nb-youtube",
    downloadSpeed: 4120000,
    uploadSpeed: 8400,
  },
  {
    id: "conn-direct-01",
    metadata: {
      network: "tcp",
      type: "HTTP",
      sourceIP: "127.0.0.1",
      sourcePort: "54520",
      destinationIP: "119.29.29.29",
      destinationPort: "80",
      host: "doh.pub",
      dnsMode: "real_ip",
      process: "System",
      inboundName: "pw-windivert-in",
      hookTier: "Direct",
    },
    upload: 4800,
    download: 9200,
    start: new Date(Date.now() - 950000).toISOString(),
    chains: ["DIRECT"],
    rule: "GEOSITE",
    rulePayload: "cn",
    downloadSpeed: 0,
    uploadSpeed: 0,
  },
  {
    id: "conn-bili-01",
    metadata: {
      network: "tcp",
      type: "HTTPS",
      sourceIP: "127.0.0.1",
      sourcePort: "54605",
      destinationIP: "116.140.35.21",
      destinationPort: "443",
      host: "api.bilibili.com",
      dnsMode: "real_ip",
      process: "msedge.exe",
      inboundName: "pw-windivert-in",
      hookTier: "Direct",
    },
    upload: 32000,
    download: 1420000,
    start: new Date(Date.now() - 110000).toISOString(),
    chains: ["DIRECT"],
    rule: "GEOSITE",
    rulePayload: "cn",
    downloadSpeed: 24000,
    uploadSpeed: 800,
  },
];

// 预填充部分保真历史连接
if (CLOSED_CONNECTIONS_BUFFER.length === 0) {
  CLOSED_CONNECTIONS_BUFFER = [
    {
      id: "hist-01",
      metadata: {
        network: "tcp",
        type: "HTTPS",
        sourceIP: "127.0.0.1",
        sourcePort: "54112",
        destinationIP: "104.18.33.8",
        destinationPort: "443",
        host: "chatgpt.com",
        dnsMode: "fake-ip",
        process: "ChatGPT.exe",
        processPath: "C:\\Program Files\\OpenAI\\ChatGPT.exe",
        inboundName: "pw-windivert-in",
        hookTier: "Direct",
      },
      upload: 4200,
      download: 68400,
      start: new Date(Date.now() - 12000).toISOString(),
      closedAt: new Date(Date.now() - 10500).toLocaleTimeString(),
      durationMs: 1500,
      chains: ["OpenAI 官方套件", "香港 01 | 极速专线 [BGP]"],
      rule: "RULE-SET",
      rulePayload: "nb-ai",
      downloadSpeed: 0,
      uploadSpeed: 0,
    },
    {
      id: "hist-02",
      metadata: {
        network: "udp",
        type: "DNS",
        sourceIP: "127.0.0.1",
        sourcePort: "53201",
        destinationIP: "223.5.5.5",
        destinationPort: "53",
        host: "dns.alidns.com",
        dnsMode: "real_ip",
        process: "System",
        inboundName: "pw-dns-in",
        hookTier: "Direct",
      },
      upload: 120,
      download: 240,
      start: new Date(Date.now() - 34000).toISOString(),
      closedAt: new Date(Date.now() - 33850).toLocaleTimeString(),
      durationMs: 150,
      chains: ["DIRECT"],
      rule: "IP-CIDR",
      rulePayload: "223.5.5.5/32",
      downloadSpeed: 0,
      uploadSpeed: 0,
    },
    {
      id: "hist-03",
      metadata: {
        network: "tcp",
        type: "HTTPS",
        sourceIP: "127.0.0.1",
        sourcePort: "54180",
        destinationIP: "140.82.112.4",
        destinationPort: "443",
        host: "api.github.com",
        dnsMode: "fake-ip",
        process: "cursor.exe",
        processPath: "C:\\Users\\Admin\\AppData\\Local\\Programs\\cursor\\cursor.exe",
        inboundName: "pw-windivert-in",
        hookTier: "IAT",
      },
      upload: 1800,
      download: 14200,
      start: new Date(Date.now() - 56000).toISOString(),
      closedAt: new Date(Date.now() - 55200).toLocaleTimeString(),
      durationMs: 800,
      chains: ["开发工具加速", "香港 01 | 极速专线 [BGP]"],
      rule: "RULE-SET",
      rulePayload: "nb-github",
      downloadSpeed: 0,
      uploadSpeed: 0,
    },
  ];
}

/**
 * 差分沉淀已关闭连接到历史缓冲池
 */
function processDiffAndRecordClosed(currentConns: ConnectionItem[]) {
  const currentIds = new Set(currentConns.map((c) => c.id));
  const newlyClosed: ConnectionItem[] = [];

  PREV_CONNECTIONS_MAP.forEach((item, id) => {
    if (!currentIds.has(id)) {
      const startMs = new Date(item.start).getTime();
      const durationMs = Math.max(0, Date.now() - (isNaN(startMs) ? Date.now() : startMs));
      newlyClosed.push({
        ...item,
        closedAt: new Date().toLocaleTimeString(),
        durationMs,
        downloadSpeed: 0,
        uploadSpeed: 0,
      });
    }
  });

  if (newlyClosed.length > 0) {
    CLOSED_CONNECTIONS_BUFFER = [...newlyClosed, ...CLOSED_CONNECTIONS_BUFFER].slice(
      0,
      MAX_CLOSED_CONNECTIONS
    );
  }

  // 更新上一轮映射表
  const nextMap = new Map<string, ConnectionItem>();
  currentConns.forEach((c) => nextMap.set(c.id, c));
  PREV_CONNECTIONS_MAP = nextMap;
}

/**
 * 获取当前所有活跃连接快照
 */
export async function fetchActiveConnections(): Promise<ConnectionsSnapshot> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<any>("get_active_connections");
      if (res && typeof res === "object") {
        const rawConns: ConnectionItem[] = Array.isArray(res.connections) ? res.connections : [];
        processDiffAndRecordClosed(rawConns);
        return {
          downloadTotal: res.downloadTotal || 0,
          uploadTotal: res.uploadTotal || 0,
          connections: rawConns,
        };
      }
    } catch (err) {
      console.warn("[connectionsService] get_active_connections failed:", err);
    }
  }

  // 浏览器开发仿真: 随机产生微量速率跳动与流量累加
  MOCK_CONNECTIONS_POOL = MOCK_CONNECTIONS_POOL.map((conn) => {
    const downDelta = Math.floor(Math.random() * 50000);
    const upDelta = Math.floor(Math.random() * 3000);
    return {
      ...conn,
      download: conn.download + downDelta,
      upload: conn.upload + upDelta,
      downloadSpeed: conn.downloadSpeed ? Math.max(0, conn.downloadSpeed + (Math.random() * 20000 - 10000)) : 0,
    };
  });

  processDiffAndRecordClosed(MOCK_CONNECTIONS_POOL);

  const totalDown = MOCK_CONNECTIONS_POOL.reduce((acc, c) => acc + c.download, 0);
  const totalUp = MOCK_CONNECTIONS_POOL.reduce((acc, c) => acc + c.upload, 0);

  return {
    downloadTotal: totalDown,
    uploadTotal: totalUp,
    connections: [...MOCK_CONNECTIONS_POOL],
  };
}

/**
 * 获取沉淀的历史已关闭连接列表 (历史连接)
 */
export function getClosedConnections(): ConnectionItem[] {
  return [...CLOSED_CONNECTIONS_BUFFER];
}

/**
 * 清空历史连接缓冲池
 */
export function clearClosedConnections(): void {
  CLOSED_CONNECTIONS_BUFFER = [];
}

/**
 * 切断单条指定连接
 */
export async function killConnection(id: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("close_connection", { id });
    } catch (err) {
      console.warn("[connectionsService] close_connection failed:", err);
      return false;
    }
  }

  // 浏览器仿真: 移出连接池并推入历史连接
  const target = MOCK_CONNECTIONS_POOL.find((c) => c.id === id);
  if (target) {
    CLOSED_CONNECTIONS_BUFFER = [
      {
        ...target,
        closedAt: new Date().toLocaleTimeString(),
        durationMs: Math.max(0, Date.now() - new Date(target.start).getTime()),
        downloadSpeed: 0,
        uploadSpeed: 0,
      },
      ...CLOSED_CONNECTIONS_BUFFER,
    ].slice(0, MAX_CLOSED_CONNECTIONS);
  }
  MOCK_CONNECTIONS_POOL = MOCK_CONNECTIONS_POOL.filter((c) => c.id !== id);
  return true;
}

/**
 * 切断所有活跃连接
 */
export async function killAllConnections(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("close_all_connections");
    } catch (err) {
      console.warn("[connectionsService] close_all_connections failed:", err);
      return false;
    }
  }

  MOCK_CONNECTIONS_POOL = [];
  return true;
}

/**
 * 专业字节与数据量格式化 (保留 2 位小数)
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 实时瞬时速率格式化
 */
export function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) return "0 B/s";
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

/**
 * 连接存活持续时间格式化
 */
export function formatDuration(startTime: string): string {
  try {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - start) / 1000));
    if (diffSec < 60) return `${diffSec}秒`;
    const min = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    if (min < 60) return `${min}分${sec}秒`;
    const hr = Math.floor(min / 60);
    return `${hr}时${min % 60}分`;
  } catch {
    return "刚刚";
  }
}

/**
 * 毫秒级耗时格式化 (供历史连接使用)
 */
export function formatDurationMs(ms?: number): string {
  if (!ms || ms <= 0) return "< 10ms";
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${sec}秒`;
  const min = Math.floor(ms / 60000);
  return `${min}分${Math.floor((ms % 60000) / 1000)}秒`;
}
