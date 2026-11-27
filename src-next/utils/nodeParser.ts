// ==========================================================================
// ProcWeaver src-next 节点元数据智能光学解析器
// 规范溯源: typography-dark-mono-optics / taste-skill
// 特性: 智能剔除广告信息节点、解析地域、倍率、协议与 IPpure 评估风控分
// ==========================================================================

import recognition from "../../src/data/nodeRecognition.json";
import { ProxyItem, ParsedNodeMeta } from "../types/proxy";

const REGION_RULES = recognition.regions.map(rule => ({
  ...rule, regex: new RegExp(rule.pattern, "i"),
}));
const REGION_NAMES = new Map(REGION_RULES.map(({ code, name }) => [code, name]));
const localizedRegions = typeof Intl.DisplayNames === "function" && Intl.DisplayNames.supportedLocalesOf("zh-CN").length > 0
  ? new Intl.DisplayNames("zh-CN", { type: "region", fallback: "none" })
  : undefined;
const MULTIPLIERS = recognition.multipliers.map(pattern => new RegExp(pattern, "i"));

export function getRegionDisplayName(code: string): string {
  const normalized = code.trim().toUpperCase();
  return REGION_NAMES.get(normalized)
    ?? (/^[A-Z]{2}$/.test(normalized) ? localizedRegions?.of(normalized) : undefined)
    ?? "地区未知";
}

/**
 * 严格判定是否为机场广告、公告、通知、账单等信息节点 (将被直接过滤不显示)
 */
export function isAdOrInfoNode(nodeName: string): boolean {
  if (!nodeName) return true;
  const name = nodeName.trim().toLowerCase();

  // 1. 匹配常见公告、流量、到期、网址关键词
  const adKeywords = [
    "剩余流量",
    "到期时间",
    "套餐到期",
    "重置时间",
    "距离下次重置",
    "官网地址",
    "官方网址",
    "官方频道",
    "电报频道",
    "群组",
    "客服",
    "通知",
    "公告",
    "traffic",
    "expire",
    "reset",
    "channel",
    "website",
    "telegram",
    "github.com",
    "t.me/",
    "防失联",
  ];

  for (const kw of adKeywords) {
    if (name.includes(kw)) return true;
  }

  // 2. 匹配纯日期形式节点 (如 "2026-12-31")
  if (/202[0-9][-\/.][0-9]{1,2}[-\/.][0-9]{1,2}/.test(name)) {
    return true;
  }

  // 3. 匹配容量比值提示 (如 "580.4G/1000G", "320GB | 500GB")
  if (/\d+(?:\.\d+)?\s*[gmt]b?\s*[\/|]\s*\d+(?:\.\d+)?\s*[gmt]b?/i.test(name)) {
    return true;
  }

  // 4. 匹配以域名结尾的推广名
  if (/\b[a-zA-Z0-9-]+\.(?:com|net|org|xyz|top|cc|me|vip|site|shop)\b/i.test(name)) {
    // 排除特定节点名中含有正常地域字符的
    if (!/香港|日本|美国|新加坡|专线|bgp|iplc/i.test(name)) {
      return true;
    }
  }

  return false;
}

/**
 * 从节点原始名称中智能提取地域信息
 */
export function parseRegion(nodeName: string): { code: string; name: string } {
  const flag = nodeName.match(/[🇦-🇿]{2}/u)?.[0];
  if (flag) {
    const code = Array.from(flag, letter => String.fromCharCode(letter.codePointAt(0)! - 0x1f1e6 + 65)).join("");
    if (code !== "EU" && code !== "UN") return { code, name: getRegionDisplayName(code) };
  }
  for (const rule of REGION_RULES) {
    if (rule.regex.test(nodeName)) {
      return { code: rule.code, name: rule.name };
    }
  }
  if (/direct|直连/i.test(nodeName)) return { code: "DIR", name: "直连出站" };
  if (/reject|拦截/i.test(nodeName)) return { code: "REJ", name: "直接拒绝" };
  return { code: "GLB", name: "通用全球" };
}

/**
 * 从节点名中提取流量倍率 (如 0.5x, 1.0x, 2.0x, 3x)
 */
export function parseMultiplier(nodeName: string): number {
  for (const pattern of MULTIPLIERS) {
    const match = nodeName.match(pattern);
    if (match) return parseFloat(match[1]);
  }
  return 1.0;
}

/**
 * 协议徽章与光学配色映射 (明暗光学双轨，彻底根治浅色模式下白底浅字看不清)
 */
export function getProtocolBadge(rawType: string): { label: string; color: string } {
  const t = (rawType || "").toLowerCase();

  if (t === "hysteria2" || t === "hy2") {
    return { label: "HY2", color: "bg-purple-500/10 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30" };
  }
  if (t === "hysteria" || t === "hy") {
    return { label: "HY", color: "bg-fuchsia-500/10 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30" };
  }
  if (t === "vless") {
    return { label: "VLESS", color: "bg-blue-500/10 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" };
  }
  if (t === "vmess") {
    return { label: "VMESS", color: "bg-sky-500/10 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" };
  }
  if (t === "trojan") {
    return { label: "TROJAN", color: "bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30" };
  }
  if (t === "shadowsocks" || t === "ss") {
    return { label: "SS", color: "bg-slate-200/80 dark:bg-zinc-500/15 text-slate-800 dark:text-zinc-200 border-slate-300/80 dark:border-zinc-500/30" };
  }
  if (t === "wireguard" || t === "wg") {
    return { label: "WG", color: "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" };
  }
  if (t === "direct") {
    return { label: "DIRECT", color: "bg-teal-500/10 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30" };
  }
  if (t === "reject") {
    return { label: "REJECT", color: "bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" };
  }

  return { label: (rawType || "PROXY").toUpperCase(), color: "bg-slate-200/80 dark:bg-zinc-500/15 text-slate-800 dark:text-zinc-300 border-slate-300/80 dark:border-zinc-500/30" };
}

/**
 * 提取最新的有效延迟毫秒数
 */
export function getLatestDelay(item: ProxyItem): number | undefined {
  if (!item.history || item.history.length === 0) return undefined;
  const last = item.history[item.history.length - 1];
  return last.delay;
}

/**
 * 延迟色阶判定
 */
export function getDelayColorClass(delay?: number): {
  dotColor: string;
  textColor: string;
  label: string;
} {
  if (delay === undefined || delay === 0) {
    return {
      dotColor: "bg-slate-400 dark:bg-zinc-500",
      textColor: "text-slate-600 dark:text-zinc-400 font-medium",
      label: "未测速",
    };
  }
  if (delay < 0 || delay >= 5000) {
    return {
      dotColor: "bg-rose-500",
      textColor: "text-rose-600 dark:text-rose-400 font-semibold",
      label: "超时",
    };
  }
  if (delay <= 75) {
    return {
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-700 dark:text-emerald-400 font-semibold",
      label: `${delay}ms`,
    };
  }
  if (delay <= 160) {
    return {
      dotColor: "bg-sky-500",
      textColor: "text-sky-700 dark:text-sky-400 font-semibold",
      label: `${delay}ms`,
    };
  }
  if (delay <= 300) {
    return {
      dotColor: "bg-amber-500",
      textColor: "text-amber-700 dark:text-amber-400 font-semibold",
      label: `${delay}ms`,
    };
  }
  return {
    dotColor: "bg-orange-500",
    textColor: "text-orange-700 dark:text-orange-400 font-semibold",
    label: `${delay}ms`,
  };
}

/**
 * 评估风控分色阶计算 (严格命名为: 评估风控分，0~100，越低越纯净)
 */
export function getFraudScoreBadge(score?: number): {
  label: string;
  dotColor: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
} {
  if (score === undefined || score === null) {
    return {
      label: "未测风控",
      dotColor: "bg-slate-400 dark:bg-zinc-500",
      textColor: "text-slate-600 dark:text-zinc-400 font-medium",
      bgColor: "bg-slate-100 dark:bg-zinc-500/10",
      borderColor: "border-slate-300/80 dark:border-zinc-500/20",
    };
  }

  if (score <= 25) {
    return {
      label: `风控 ${score}`,
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-600 dark:text-emerald-400 font-bold",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/30",
    };
  }

  if (score <= 59) {
    return {
      label: `风控 ${score}`,
      dotColor: "bg-amber-500",
      textColor: "text-amber-600 dark:text-amber-400 font-bold",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/30",
    };
  }

  return {
    label: `风控 ${score}`,
    dotColor: "bg-rose-500",
    textColor: "text-rose-600 dark:text-rose-400 font-bold",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/30",
  };
}

/**
 * 解析完整节点元数据 (包含广告屏蔽判定)
 */
export function parseNodeMeta(item: ProxyItem): ParsedNodeMeta {
  const isAd = isAdOrInfoNode(item.name);
  const region = parseRegion(item.name);
  const multiplier = parseMultiplier(item.name);
  const protocol = getProtocolBadge(item.type);
  const latestDelay = getLatestDelay(item);
  const cleanName = item.name.replace(/^[\s\-_|:]+|[\s\-_|:]+$/g, "");

  return {
    rawName: item.name,
    cleanName: cleanName || item.name,
    regionCode: region.code,
    regionName: region.name,
    multiplier,
    protocolBadge: protocol.label,
    protocolColor: protocol.color,
    latestDelay,
    isAdOrInfo: isAd,
  };
}

/**
 * 严格判定某个项目是否为真实的代理出站节点 (排除策略组、内置直连/拒绝、内部系统规则组与广告公告)
 */
export function isRealProxyNode(item?: ProxyItem | null): boolean {
  if (!item || !item.name) return false;
  if (item.isCustom) return true;
  if (isAdOrInfoNode(item.name)) return false;

  // 1. 过滤策略组与内置动作类型
  const t = String(item.type || "").toLowerCase();
  const groupTypes = [
    "selector",
    "urltest",
    "fallback",
    "loadbalance",
    "relay",
    "direct",
    "reject",
    "compatible",
    "pass",
    "unknown",
  ];
  if (groupTypes.includes(t)) return false;

  // 2. 具有 all 成员列表的一律属于策略组
  if (item.all && Array.isArray(item.all) && item.all.length > 0) return false;

  // 3. 过滤系统内部命名特征 (如 GLOBAL, DIRECT, REJECT, REJECT-DROP, PASS, PASS-RULE, PW-xxx-main, 本地方案·xxx)
  const name = item.name.trim();
  const upper = name.toUpperCase();
  if (
    upper.startsWith("DIRECT") ||
    upper.startsWith("REJECT") ||
    upper.startsWith("GLOBAL") ||
    upper.startsWith("PASS") ||
    upper.startsWith("COMPATIBLE")
  ) {
    return false;
  }
  if (name.startsWith("PW-") || name.startsWith("本地方案")) {
    return false;
  }

  return true;
}
