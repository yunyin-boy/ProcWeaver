// ==========================================================================
// ProcWeaver src-next 进程分流与业务规则包类型定义
// 规范溯源: tauri-desktop-layout-typography / typography-dark-mono-optics
// ==========================================================================

import type { RoutingTarget } from "../../src/types/routingOverrides";
import type { BundleRepositoryOrigin } from "../../src/types/bundleRepository";

export type ProcessRuleAction = "proxy" | "direct" | "reject";
export type ProcessMatchKind = "process-name" | "process-path";

/**
 * DNS 解析模式
 *   safe_pure     — 推荐 · 100% 兼容：专有纯净通道向 DoH 获取真实公网 IP，SOCKS5 发送真实 IP；
 *   fake_ip       — 秒开 · 零本地泄露：本地 0ms 瞬间生成 198.18.x.x 假 IP，远端节点解析；
 *   system_native — 直接放行：完全不劫持 DNS 解析，直接使用系统物理网卡配置的 DNS 服务器。
 */
export type BundleDnsMode = "safe_pure" | "fake_ip" | "system_native";

export type BundleTrafficMode = "strict" | "sandbox"; // strict = 强锁独占, sandbox = 智能沙盒
export type BundleFallback = "rules" | "system" | "direct"; // 沙盒未命中域名时回落策略
export type BundlePortFilterMode = "all" | "web_only" | "custom";
export type BundleTargetFilterMode = "all" | "include" | "exclude";
export type BundleStaleConnectionStrategy = "prompt" | "auto_reset" | "ignore";

/**
 * 业务规则包安全与网络策略 (与 Rust 后端 BundlePolicy 严格对齐)
 */
export interface BundlePolicyConfig {
  proxyTcp: boolean;               // 代理 TCP 连接 (默认 true)
  blockIpv6: boolean;              // 阻止 IPv6 旁路泄露 (默认 true)
  blockUdp: boolean;               // 禁止 UDP (最高优先，防 QUIC 延迟与 WebRTC 泄露，默认 true)
  proxyUdp: boolean;               // 代理 UDP (仅 SOCKS5 支持，默认 false)
  proxySubprocesses: boolean;      // 代理衍生子进程 (默认 true)
  bypassLan: boolean;              // 绕过本地回环与局域网 (默认 true)
  dnsMode: BundleDnsMode;          // DNS 解析模式 (默认 "safe_pure")
  portFilterMode: BundlePortFilterMode; // 端口过滤模式 (默认 "all")
  customPorts?: string;            // 自定义端口列表 (如 "80,443,8000-8080")
  targetFilterMode: BundleTargetFilterMode; // 目标过滤模式 (默认 "all")
  targetRules?: string[];          // 目标过滤规则 (域名/IP 列表)
  disallowProxyArgs?: boolean;     // 禁用启动代理参数 (--proxy-server)
  staleConnectionStrategy: BundleStaleConnectionStrategy; // 存量旧长连接策略 (默认 "prompt")
  useExistingRules?: boolean;
}

/**
 * 业务规则包实例 (Business Bundle)
 * 遵循 AGENTS.md 约定：OpenAI 与 反重力为核心发布包
 */
export interface ProcessBundleItem {
  id: string;
  packageId?: string;
  repositoryOrigin?: BundleRepositoryOrigin;
  name: string;
  description: string;
  icon?: string;
  mainExe: string;
  exes: string[];
  enabled: boolean;
  targetProxy: string; // 绑定的代理出口插槽 (如 "香港 01", "Auto - 自动低延迟优选")
  targetIdentity?: RoutingTarget;
  mode: BundleTrafficMode; // "strict" 强锁独占 | "sandbox" 智能沙盒
  fallback: BundleFallback; // 沙盒模式下未命中时的策略
  domains: string[]; // 专属出口域名清单
  policy: BundlePolicyConfig;
  updatedAt?: string;
}

export function usesExistingBundleRules(bundle: {
  mode: BundleTrafficMode;
  policy: Pick<BundlePolicyConfig, "useExistingRules">;
}): boolean {
  return bundle.mode === "sandbox" && bundle.policy?.useExistingRules === true;
}

/**
 * 自定义单进程分流规则
 */
export interface ProcessRuleItem {
  id: string;
  enabled: boolean;
  label: string;
  matchKind: ProcessMatchKind;
  matchValue: string; // 如 "chrome.exe" 或 "D:\Apps\Git\cmd\git.exe"
  action: ProcessRuleAction;
  targetProxy?: string; // 当 action === "proxy" 时绑定的节点或策略组
  includeDescendants: boolean; // 是否递归接管子进程
  ruleMode?: "strict" | "inherit"; // 严格指定出口 vs 继承域名分流
  createdAt?: string;
}

/**
 * 系统进程快照
 */
export interface LiveProcessItem {
  pid: number;
  name: string;
  path?: string;
  isRouted: boolean; // 当前是否匹配规则或业务包
  matchedRuleName?: string; // 命中的规则或业务包名称
  matchedProxy?: string; // 命中的出站出口
}

export type ProcessTrafficDriver = "windivert_v1" | "user_mode" | "app_proxy";
export type CaptureMode = ProcessTrafficDriver | "tun";

export interface ProcessDriverOption {
  id: ProcessTrafficDriver;
  title: string;
  subLabel: string;
  tag: string;
  description: string;
  requiresAdmin: boolean;
}

export const PROCESS_DRIVER_OPTIONS: ProcessDriverOption[] = [
  {
    id: "app_proxy",
    title: "纯应用层代理",
    subLabel: "App-Proxy",
    tag: "0 系统入侵",
    description: "依靠命令行代理参数 (--proxy-server) 或系统环境变量，极简无入侵",
    requiresAdmin: false,
  },
  {
    id: "user_mode",
    title: "用户态 Hook",
    subLabel: "Detours 注入",
    tag: "免提权无痕",
    description: "免管理员权限绿色运行！通过动态 Hook 进程 Winsock，精准劫持应用连接",
    requiresAdmin: false,
  },
  {
    id: "windivert_v1",
    title: "WinDivert 驱动",
    subLabel: "内核转发",
    tag: "0 虚拟网卡",
    description: "按已识别的进程规则转发新连接，无需虚拟网卡",
    requiresAdmin: true,
  },
];

/**
 * 进程分流全局总控状态
 */
export interface ProcessRoutingState {
  bundlesEnabled: boolean; // 业务包总开关
  processEnabled: boolean; // 进程分流总开关
  driverActive: boolean; // 驱动是否就绪
  engineMode: CaptureMode; // 已选择的接管模式
  activeDriverName?: string; // 内核实际运行状态 (windivert | windivert_pending | user_mode | app_proxy)
  isAdmin?: boolean; // 是否拥有管理员权限
  matchedProcessCount: number; // 当前匹配已启用规则的进程数
  totalBundleCount: number;
  totalRuleCount: number;
}

export interface CaptureConnectionEvidence {
  connectionId: number;
  timeMs: number;
  pid: number;
  processName: string;
  ruleOwner?: string | null;
  entryPort?: number | null;
  destination: string;
  dnsName?: string | null;
  dnsUpstream?: string | null;
  protocol: "tcp" | "udp";
  stage: string;
  outcome: "attributed" | "relayed" | "failed";
  errorKind?: string | null;
}

export interface ProcessCaptureEvidence {
  unclassified: number;
  failures: number;
  recentConnections?: CaptureConnectionEvidence[];
}
