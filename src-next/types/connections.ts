// ==========================================================================
// ProcWeaver src-next 链接追踪系统类型定义 (Connections Types)
// 规范溯源: typography-dark-mono-optics / tauri-desktop-layout-typography
// ==========================================================================

export interface ConnectionMetadata {
  network: string;          // "tcp" | "udp"
  type: string;             // "HTTP" | "HTTPS" | "SOCKS5" | "Inner"
  sourceIP: string;
  destinationIP: string;
  sourcePort: string;
  destinationPort: string;
  host: string;
  dnsMode?: string;
  process?: string;         // 如 "ChatGPT.exe"
  processPath?: string;     // 完整执行路径
  inboundName?: string;
  hookTier?: "Detours" | "IAT" | "Direct" | string;
  processContext?: {
    source: "windivert_context";
    kind: "path" | "name" | "any" | "unknown";
    value: string;
    owner?: string;
  };
}

export interface ConnectionItem {
  id: string;
  metadata: ConnectionMetadata;
  upload: number;           // 累计上传字节数
  download: number;         // 累计下载字节数
  start: string;            // 连接建立时间 (ISO 字符串)
  chains: string[];         // 出站策略链 (如 ["PW-openai-main", "香港01 | 极速专线 [BGP]"])
  rule: string;             // 命中规则类型 (如 "RULE-SET" 或 "PROCESS-NAME")
  rulePayload: string;      // 命中规则内容 (如 "nb-ai" 或 "ChatGPT.exe")
  uploadSpeed?: number;     // 实时上传速度 (bytes/s)
  downloadSpeed?: number;   // 实时下载速度 (bytes/s)
  closedAt?: string;        // 若已断开，记录断开时间戳
  durationMs?: number;      // 会话持续时长 (毫秒)
}

export type ConnectionViewMode = "active" | "history";

export interface ConnectionsSnapshot {
  downloadTotal: number;
  uploadTotal: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  connections: ConnectionItem[];
}

export type ConnectionProtocolFilter = "all" | "tcp" | "udp";
export type ConnectionSortField = "download" | "upload" | "downSpeed" | "upSpeed" | "time";
