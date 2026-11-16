// ==========================================================================
// ProcWeaver src-next 节点大盘全量类型体系
// 严格对齐 Mihomo (Clash.Meta) 数据模型、IPpure 健康体检与订阅自建体系
// ==========================================================================

export type OutboundProtocol =
  | "Shadowsocks"
  | "Vmess"
  | "Vless"
  | "Trojan"
  | "Hysteria"
  | "Hysteria2"
  | "WireGuard"
  | "Direct"
  | "Reject"
  | "Compatible"
  | "Unknown";

export type GroupStrategyType =
  | "Selector"
  | "URLTest"
  | "Fallback"
  | "LoadBalance"
  | "Relay";

export interface DelayHistory {
  time: string;
  delay: number;
}

/**
 * IPpure 接口标准健康体检结果 (https://my.ippure.com/v1/info)
 */
export interface NodeHealthResult {
  ip?: string;
  asn?: number;
  asOrganization?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  fraudScore?: number; // 评估风控分 (0 ~ 100，越低越纯净)
  isResidential?: boolean; // 是否原生住宅家宽
  isBroadcast?: boolean; // 是否广播 IP
  ipType: "原生家宽" | "机房商宽" | "广播IP" | "未知";
  testedAt?: string;
  loading?: boolean;
}

/**
 * Mihomo 原生 Proxy 节点对象
 */
export interface ProxyItem {
  name: string;
  type: string;
  udp?: boolean;
  xudp?: boolean;
  history?: DelayHistory[];
  alive?: boolean;
  now?: string;
  all?: string[];
  extra?: Record<string, unknown>;
  health?: NodeHealthResult;
  isCustom?: boolean; // 是否为用户自建 VPS 节点
}

/**
 * 策略组结构体
 */
export interface ProxyGroupItem {
  name: string;
  type: GroupStrategyType;
  now: string;
  all: string[];
  icon?: string;
  hidden?: boolean;
}

/**
 * 解析后的节点富元数据 (用于现代排版光学展示)
 */
export interface ParsedNodeMeta {
  rawName: string;
  cleanName: string;
  regionCode: string; // 如 HK, JP, US, SG, TW
  regionName: string; // 如 中国香港, 日本, 美国
  multiplier: number; // 流量计费倍率，如 1.0, 0.5, 2.0
  protocolBadge: string; // 如 HY2, VLESS, SS
  protocolColor: string; // Tailwind 色阶类
  latestDelay?: number; // 毫秒延迟，0 或 undefined 代表未测速，>0 代表正常延迟，-1 代表超时
  isAdOrInfo: boolean; // 是否为广告/通知/账单信息节点 (将被直接过滤不显示)
}

/**
 * 订阅源配置项
 */
export interface ProfileItem {
  id: string;
  name: string;
  url?: string;
  updatedAt?: string;
  totalBytes?: number;
  usedBytes?: number;
  nodeCount?: number;
  active?: boolean;
}

/**
 * 本地自建自定义节点模型
 */
export interface LocalCustomNode {
  id: string;
  alias: string;
  protocol: OutboundProtocol;
  server: string;
  port: number;
  rawLink: string;
  createdAt: string;
}

/**
 * 测速端点预设模型
 */
export interface SpeedtestEndpoint {
  id: string;
  name: string;
  url: string;
}

/**
 * 视图排序与过滤偏好
 */
export type ProxySortMode = "default" | "delay-asc" | "multiplier-asc" | "fraud-asc" | "name-asc";
export type ProxyViewMode = "grid" | "list";
