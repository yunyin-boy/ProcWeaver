import type { RoutingTarget } from "./routingOverrides";
import type { BundleRepositoryOrigin } from "./bundleRepository";
// 业务规则包系统核心数据类型定义 (Business Rule Bundle Types)

export type BundleSlotId = "main" | "dns";

export interface BundleSlot {
  id: BundleSlotId;
  name: string;
  description: string;
  required: boolean;
  followSlotId?: BundleSlotId; // 允许跟随其他插槽 (例如 dns 跟随 main)
}

export interface BundleProcessMember {
  exe: string;
  role: "main" | "worker" | "cli" | "helper";
  description: string;
  includeDescendants?: boolean;
}

// 本机程序定位；不导出路径、PID 或采集记录。
export interface BundleProcessBinding {
  exe: string;
  executablePath: string;
  includeDescendants: boolean;
}
export type BundleProcessBindings = Partial<Record<"windows" | "macos", BundleProcessBinding[]>>;

export type BundleCategory = "dev" | "chat" | "browser" | "game" | "media" | "custom";
export type BundleTrafficMode = "strict" | "sandbox"; // strict = 强锁独占, sandbox = 智能沙盒
export type BundleFallback = "rules" | "system" | "direct";
// 热替换单独选择；旧版 auto 继续只检测，不能升级为自动重启授权。
export type BundleWatcherMode = "auto" | "hot_swap" | "notify" | "disabled";

export type BundleDnsMode = "safe_pure" | "fake_ip" | "system_native";
export type BundlePortFilterMode = "all" | "web_only" | "custom";
export type BundleTargetFilterMode = "all" | "include" | "exclude";

export interface BundlePolicy {
  proxyTcp: boolean;               // 代理 TCP 连接 (默认 true)
  blockIpv6: boolean;              // 阻止 IPv6 旁路泄露 (默认 true)
  blockUdp: boolean;               // 禁止 UDP (最高优先，防 QUIC 延迟与 WebRTC 泄露，默认 true)
  proxyUdp: boolean;               // 代理 UDP (仅 SOCKS5 支持，默认 false)
  proxySubprocesses: boolean;      // 代理衍生子进程 (默认 true)
  bypassLan: boolean;              // 绕过本地回环与局域网 (默认 true)
  disallowProxyArgs?: boolean;     // 禁用命令行代理参数 (默认 false，适用于 Google Gemini 等安全自检排斥 --proxy-server 的应用)
  dnsMode: BundleDnsMode;          // DNS 解析模式 (默认 "safe_pure")
  portFilterMode: BundlePortFilterMode; // 端口过滤模式 (默认 "all")
  customPorts?: string;            // 自定义端口列表 (如 "80,443,8080")
  targetFilterMode: BundleTargetFilterMode; // 目标域名/IP 过滤模式 (默认 "all")
  targetRules?: string[];          // 目标过滤规则 (域名/IP)
}

export function defaultBundlePolicy(): BundlePolicy {
  return {
    proxyTcp: true,
    blockIpv6: true,
    blockUdp: true,
    proxyUdp: false,
    proxySubprocesses: true,
    bypassLan: true,
    disallowProxyArgs: false,
    dnsMode: "safe_pure",
    portFilterMode: "all",
    customPorts: "",
    targetFilterMode: "all",
    targetRules: [],
  };
}

export function normalizeBundlePolicy(policy?: Partial<BundlePolicy> | null): BundlePolicy {
  const defaults = defaultBundlePolicy();
  if (!policy) return defaults;
  return {
    proxyTcp: policy.proxyTcp ?? defaults.proxyTcp,
    blockIpv6: policy.blockIpv6 ?? defaults.blockIpv6,
    blockUdp: policy.blockUdp ?? defaults.blockUdp,
    proxyUdp: policy.proxyUdp ?? defaults.proxyUdp,
    proxySubprocesses: policy.proxySubprocesses ?? defaults.proxySubprocesses,
    bypassLan: policy.bypassLan ?? defaults.bypassLan,
    disallowProxyArgs: policy.disallowProxyArgs ?? defaults.disallowProxyArgs,
    dnsMode: policy.dnsMode ?? defaults.dnsMode,
    portFilterMode: policy.portFilterMode ?? defaults.portFilterMode,
    customPorts: policy.customPorts ?? defaults.customPorts,
    targetFilterMode: policy.targetFilterMode ?? defaults.targetFilterMode,
    targetRules: Array.isArray(policy.targetRules) ? policy.targetRules : defaults.targetRules,
  };
}

export interface BusinessBundleDefinition {
  packageId: string;
  packageName: string;
  packageVersion: string;
  category: BundleCategory;
  mode: BundleTrafficMode;
  fallback?: BundleFallback; // 缺省保留旧包的原规则；system 仅跟随本软件系统代理开关
  policy?: BundlePolicy;     // 规则包推荐接管与防护策略
  description: string;
  icon: string;
  slots: BundleSlot[];
  processes: BundleProcessMember[];
  // 旧规则的 processes / additionalExes 属于 Windows；macOS 必须明确提供进程定义。
  macosProcesses?: BundleProcessMember[];
  androidPackages?: string[];
  additionalExes?: string[];
  domains?: string[];
  author?: string;
}

// 本机实例 (Local Instance)，实现包定义与本机出口节点完全解耦
export interface BundleLocalInstance {
  instanceId: string;
  definition: BusinessBundleDefinition;
  enabled: boolean; // 停用状态下彻底不干涉网络 (跟随系统默认)
  slotBindings: Record<string, string | null>; // 插槽绑定 (如 { main: "🌸 日本 04", dns: "FOLLOW_MAIN" })
  slotTargets?: Partial<Record<BundleSlotId, RoutingTarget>>; // 仅本机保存，不进入导出白名单
  backend?: "core" | "external"; // 旧实例缺省使用核心；认证仅保存在原生后台
  externalEndpointId?: string | null; // null / 缺省跟随独立代理默认出口
  externalFallback?: "direct" | "default";
  watcherMode: BundleWatcherMode;
  policy?: BundlePolicy; // 本机实例专属策略 (缺省继承 definition.policy 或全局标准默认)
  isModified: boolean;
  createdAt: number;
  updatedAt: number;
  repositoryOrigin?: BundleRepositoryOrigin; // 本机来源记录，不进入规则包导出
  processBindings?: BundleProcessBindings;
}

// 规范的 .pwpack.json 纯净脱敏导出文件结构 (白名单脱敏)
export interface ExportableBundlePackage {
  formatVersion: "1.0";
  exportedAt: string;
  bundle: BusinessBundleDefinition;
}
