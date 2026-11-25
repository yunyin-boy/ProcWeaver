import type { ConnectionItem, ConnectionsSnapshot } from "../types/connections";
import { invokeCommand, isTauriEnvironment } from "./client";

export const MAX_CLOSED_CONNECTIONS = 500;
let history: ConnectionItem[] = [];
let previousConnections = new Map<string, ConnectionItem>();
let lastSample: { at: number; download: number; upload: number } | undefined;
let requestQueue = Promise.resolve();

// 读取与断开共用顺序，避免较早的快照覆盖已确认的断开。
function enqueueConnectionRequest<T>(action: () => Promise<T>): Promise<T> {
  const request = requestQueue.then(action);
  requestQueue = request.then(() => undefined, () => undefined);
  return request;
}

let mockConnections: ConnectionItem[] = [
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
    chains: ["香港 01 | 极速专线 [BGP]", "OpenAI 官方套件"],
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
    chains: ["日本 02 | 低延迟游戏专线", "Cursor 智能套件"],
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
    chains: ["香港 01 | 极速专线 [BGP]", "开发工具加速"],
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
    chains: ["台湾 01 | 4K流媒体原生", "流媒体优选"],
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

// 浏览器预览的历史样例。
const mockHistory: ConnectionItem[] = [
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
    closedAt: new Date(Date.now() - 10500).toISOString(),
    durationMs: 1500,
    chains: ["香港 01 | 极速专线 [BGP]", "OpenAI 官方套件"],
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
    closedAt: new Date(Date.now() - 33850).toISOString(),
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
    closedAt: new Date(Date.now() - 55200).toISOString(),
    durationMs: 800,
    chains: ["香港 01 | 极速专线 [BGP]", "开发工具加速"],
    rule: "RULE-SET",
    rulePayload: "nb-github",
    downloadSpeed: 0,
    uploadSpeed: 0,
  },
];

if (!isTauriEnvironment()) history = mockHistory;

interface CoreConnectionsSnapshot {
  downloadTotal: number;
  uploadTotal: number;
  connections: (Omit<ConnectionItem, "chains"> & { chains: string[] | null })[] | null;
}

function recordClosed(connections: ConnectionItem[]) {
  if (!connections.length) return;
  const now = Date.now();
  const closedAt = new Date(now).toISOString();
  const closed = connections.map((item) => {
    const started = Date.parse(item.start);
    return {
      ...item, closedAt,
      durationMs: Number.isFinite(started) ? Math.max(0, now - started) : undefined,
      downloadSpeed: undefined,
      uploadSpeed: undefined,
    };
  });
  history = [...closed, ...history].slice(0, MAX_CLOSED_CONNECTIONS);
}

function sampleRate(total: number, previous: number | undefined, seconds: number): number | undefined {
  return previous !== undefined && total >= previous && seconds > 0
    ? (total - previous) / seconds
    : undefined;
}

function collectSnapshot(snapshot: CoreConnectionsSnapshot): ConnectionsSnapshot {
  const at = performance.now();
  const seconds = lastSample ? (at - lastSample.at) / 1000 : 0;
  const connections = (snapshot.connections ?? []).map((item): ConnectionItem => {
    const previous = previousConnections.get(item.id);
    return {
      ...item,
      chains: item.chains ?? [],
      downloadSpeed: item.downloadSpeed ?? sampleRate(item.download, previous?.download, seconds),
      uploadSpeed: item.uploadSpeed ?? sampleRate(item.upload, previous?.upload, seconds),
    };
  });
  const current = new Map(connections.map((item) => [item.id, item]));
  recordClosed([...previousConnections.values()].filter((item) => !current.has(item.id)));
  previousConnections = current;
  const result = {
    connections,
    downloadTotal: snapshot.downloadTotal,
    uploadTotal: snapshot.uploadTotal,
    downloadSpeed: sampleRate(snapshot.downloadTotal, lastSample?.download, seconds),
    uploadSpeed: sampleRate(snapshot.uploadTotal, lastSample?.upload, seconds),
  };
  lastSample = { at, download: snapshot.downloadTotal, upload: snapshot.uploadTotal };
  return result;
}

let mockDownloadTotal = mockConnections.reduce((sum, item) => sum + item.download, 0);
let mockUploadTotal = mockConnections.reduce((sum, item) => sum + item.upload, 0);

function sampleMockConnections(): CoreConnectionsSnapshot {
  mockConnections = mockConnections.map((connection) => {
    const down = Math.floor((connection.downloadSpeed ?? 0) * (1.3 + Math.random() * 0.4));
    const up = Math.floor((connection.uploadSpeed ?? 0) * (1.3 + Math.random() * 0.4));
    mockDownloadTotal += down;
    mockUploadTotal += up;
    return { ...connection, download: connection.download + down, upload: connection.upload + up };
  });
  return { connections: mockConnections, downloadTotal: mockDownloadTotal, uploadTotal: mockUploadTotal };
}

export function fetchActiveConnections(): Promise<ConnectionsSnapshot> {
  return enqueueConnectionRequest(async () => {
    if (!isTauriEnvironment()) return collectSnapshot(sampleMockConnections());
    const snapshot = await invokeCommand<CoreConnectionsSnapshot>("get_active_connections");
    if (!snapshot || (snapshot.connections !== null && !Array.isArray(snapshot.connections))) {
      throw new Error("核心未返回连接快照");
    }
    return collectSnapshot(snapshot);
  });
}

export function getClosedConnections(): ConnectionItem[] {
  return [...history];
}

export function clearClosedConnections(): void {
  history = [];
}

export function killConnection(id: string): Promise<boolean> {
  return enqueueConnectionRequest(async () => {
    if (isTauriEnvironment()) {
      if (!(await invokeCommand<boolean>("close_connection", { id }))) return false;
    } else {
      mockConnections = mockConnections.filter((item) => item.id !== id);
    }

    const target = previousConnections.get(id);
    if (target) recordClosed([target]);
    previousConnections.delete(id);
    return true;
  });
}

export function killAllConnections(): Promise<boolean> {
  return enqueueConnectionRequest(async () => {
    if (isTauriEnvironment()) {
      if (!(await invokeCommand<boolean>("close_all_connections"))) return false;
    } else {
      mockConnections = [];
    }

    recordClosed([...previousConnections.values()]);
    previousConnections.clear();
    return true;
  });
}

export function formatAddress(host: string, port: string): string {
  if (!host) return "—";
  if (!port || port === "0") return host;
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${address}:${port}`;
}

export function formatConnectionTarget({ metadata }: ConnectionItem): string {
  return formatAddress(metadata.host || metadata.destinationIP, metadata.destinationPort);
}

export function formatConnectionRule({ rule, rulePayload }: ConnectionItem): string {
  return [rule, rulePayload].filter(Boolean).join(" · ");
}

export function getConnectionProcess({ metadata }: ConnectionItem): string {
  return metadata.process || metadata.processPath?.split(/[\\/]/).filter(Boolean).pop() || "未知进程";
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSec?: number): string {
  return bytesPerSec !== undefined && Number.isFinite(bytesPerSec) ? formatBytes(bytesPerSec) + "/s" : "—";
}

export function formatDuration(startTime: string): string {
  const start = Date.parse(startTime);
  return Number.isFinite(start) ? formatDurationMs(Math.max(0, Date.now() - start)) : "—";
}

export function formatDurationMs(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} 分 ${Math.floor(ms / 1000) % 60} 秒`;
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
}
