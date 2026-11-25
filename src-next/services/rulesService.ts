// ==========================================================================
// ProcWeaver src-next 业务规则编织系统服务网关 (Rules Service)
// 规范溯源: rust-pro (Mihomo Rules IPC) / typography-dark-mono-optics
// 对接指令: get_mihomo_rules, get_mihomo_rule_providers, update_mihomo_rule_provider,
//           switch_mihomo_proxy, get_mihomo_proxies
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { RuleItem, RuleProviderItem, RouteSimulateResult } from "../types/rules";

// 常见中国顶级与常见直连域名特征
const DOMESTIC_SUFFIXES = [
  ".cn", ".com.cn", ".net.cn", ".org.cn",
  "baidu.com", "qq.com", "taobao.com", "jd.com", "aliyun.com",
  "bilibili.com", "zhihu.com", "163.com", "sina.com.cn", "weibo.com",
];

// 常见海外需代理特征
const PROXY_KEYWORD_MAP: Record<string, string> = {
  openai: "OpenAI",
  chatgpt: "OpenAI",
  claude: "Claude",
  anthropic: "Claude",
  google: "Google",
  youtube: "YouTube",
  github: "GitHub",
  telegram: "Telegram",
  twitter: "Twitter",
  x: "Twitter",
  discord: "Discord",
  spotify: "Spotify",
  netflix: "Netflix",
};

// 纯浏览器保真 Mock 规则集
const MOCK_RULES: RuleItem[] = [
  { id: "r_1", type: "DOMAIN-SUFFIX", payload: "openai.com", proxy: "OpenAI 官方套件" },
  { id: "r_2", type: "DOMAIN-SUFFIX", payload: "chatgpt.com", proxy: "OpenAI 官方套件" },
  { id: "r_3", type: "DOMAIN-SUFFIX", payload: "oaistatic.com", proxy: "OpenAI 官方套件" },
  { id: "r_4", type: "DOMAIN-SUFFIX", payload: "oaiusercontent.com", proxy: "OpenAI 官方套件" },
  { id: "r_5", type: "DOMAIN-SUFFIX", payload: "anthropic.com", proxy: "Proxy" },
  { id: "r_6", type: "DOMAIN-SUFFIX", payload: "claude.ai", proxy: "Proxy" },
  { id: "r_7", type: "DOMAIN-SUFFIX", payload: "github.com", proxy: "Proxy" },
  { id: "r_8", type: "DOMAIN-SUFFIX", payload: "githubassets.com", proxy: "Proxy" },
  { id: "r_9", type: "DOMAIN-SUFFIX", payload: "githubusercontent.com", proxy: "Proxy" },
  { id: "r_10", type: "DOMAIN-SUFFIX", payload: "google.com", proxy: "Auto - 自动低延迟优选" },
  { id: "r_11", type: "DOMAIN-SUFFIX", payload: "googleapis.com", proxy: "Auto - 自动低延迟优选" },
  { id: "r_12", type: "DOMAIN-SUFFIX", payload: "youtube.com", proxy: "Auto - 自动低延迟优选" },
  { id: "r_13", type: "DOMAIN-SUFFIX", payload: "googlevideo.com", proxy: "Auto - 自动低延迟优选" },
  { id: "r_14", type: "DOMAIN-KEYWORD", payload: "telegram", proxy: "Proxy" },
  { id: "r_15", type: "DOMAIN-SUFFIX", payload: "t.me", proxy: "Proxy" },
  { id: "r_16", type: "DOMAIN-SUFFIX", payload: "discord.com", proxy: "Proxy" },
  { id: "r_17", type: "DOMAIN-SUFFIX", payload: "twitter.com", proxy: "Proxy" },
  { id: "r_18", type: "DOMAIN-SUFFIX", payload: "x.com", proxy: "Proxy" },
  { id: "r_19", type: "DOMAIN-SUFFIX", payload: "spotify.com", proxy: "Proxy" },
  { id: "r_21", type: "GEOSITE", payload: "geolocation-!cn", proxy: "Proxy" },
  { id: "r_22", type: "GEOSITE", payload: "cn", proxy: "DIRECT" },
  { id: "r_23", type: "IP-CIDR", payload: "10.0.0.0/8", proxy: "DIRECT" },
  { id: "r_24", type: "IP-CIDR", payload: "172.16.0.0/12", proxy: "DIRECT" },
  { id: "r_25", type: "IP-CIDR", payload: "192.168.0.0/16", proxy: "DIRECT" },
  { id: "r_26", type: "IP-CIDR", payload: "127.0.0.0/8", proxy: "DIRECT" },
  { id: "r_27", type: "GEOIP", payload: "LAN", proxy: "DIRECT" },
  { id: "r_28", type: "GEOIP", payload: "CN", proxy: "DIRECT" },
  { id: "r_29", type: "MATCH", payload: "", proxy: "Proxy" },
];

const MOCK_PROVIDERS: RuleProviderItem[] = [
  {
    name: "GeoSite 常用海外顶级域名",
    type: "Rule",
    vehicleType: "HTTP",
    behavior: "domain",
    format: "text",
    ruleCount: 18450,
    updatedAt: "2026-11-06 12:00",
    url: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/gfw.txt",
  },
  {
    name: "GeoSite 中国大陆直连白名单",
    type: "Rule",
    vehicleType: "HTTP",
    behavior: "domain",
    format: "text",
    ruleCount: 52180,
    updatedAt: "2026-11-06 15:40",
    url: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/direct.txt",
  },
  {
    name: "GeoIP 中国大陆专用 IP 库",
    type: "Rule",
    vehicleType: "HTTP",
    behavior: "ipcidr",
    format: "text",
    ruleCount: 8420,
    updatedAt: "2026-11-05 21:00",
    url: "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/cncidr.txt",
  },
];

const ruleTypeAliases: Record<string, string> = {
  DOMAINSUFFIX: "DOMAIN-SUFFIX",
  DOMAINKEYWORD: "DOMAIN-KEYWORD",
  DOMAINREGEX: "DOMAIN-REGEX",
  DOMAINWILDCARD: "DOMAIN-WILDCARD",
  IPCIDR: "IP-CIDR",
  IPCIDR6: "IP-CIDR6",
  PROCESSNAME: "PROCESS-NAME",
  PROCESSPATH: "PROCESS-PATH",
  RULESET: "RULE-SET",
};

/**
 * 获取内核当前生效的全部规则
 */
export async function fetchRules(): Promise<RuleItem[]> {
  if (isTauriEnvironment()) {
    const raw = await invokeCommand<any>("get_mihomo_rules");
    if (!Array.isArray(raw?.rules)) throw new Error("核心未返回规则列表");
    return raw.rules.map((rule: any, index: number) => {
      const type = String(rule.type || "UNKNOWN").toUpperCase();
      return {
        id: `rule_${index}`,
        type: ruleTypeAliases[type] ?? type,
        payload: String(rule.payload ?? ""),
        proxy: String(rule.proxy || "DIRECT"),
        size: typeof rule.size === "number" && rule.size >= 0 ? rule.size : undefined,
        hitCount: typeof rule.extra?.hitCount === "number" ? rule.extra.hitCount : undefined,
        disabled: rule.extra?.disabled === true,
        format: rule.format,
      };
    });
  }

  return MOCK_RULES;
}

// 精选开源高质量规则集预设 (严禁 Emoji)
export interface PresetProviderItem {
  id: string;
  name: string;
  title: string;
  category: string;
  url: string;
  behavior: "domain" | "ipcidr" | "classical";
  format: "mrs" | "yaml" | "text";
  target_proxy: string;
  description: string;
  source: string;
  ruleCount: number;
}

export const PRESET_RULE_PROVIDERS: PresetProviderItem[] = [
  {
    id: "cn-domain",
    name: "nb-cn-domain",
    title: "中国大陆域名直连集",
    category: "国内直连",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "DIRECT",
    description: "覆盖中国大陆全网主流网站、政企服务与国内 CDN 直连加速",
    source: "MetaCubeX",
    ruleCount: 52180,
  },
  {
    id: "cn-ip",
    name: "nb-cn-ip",
    title: "中国大陆 IP 段直连集",
    category: "国内直连",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs",
    behavior: "ipcidr",
    format: "mrs",
    target_proxy: "DIRECT",
    description: "中国大陆 IPv4/IPv6 专有 IP 归属网段，防漏直连放行",
    source: "MetaCubeX",
    ruleCount: 8420,
  },
  {
    id: "ai",
    name: "nb-ai",
    title: "AI 智能服务集",
    category: "AI",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "Proxy",
    description: "覆盖 ChatGPT, Claude, Gemini, Copilot 等主流海外 AI 平台",
    source: "MetaCubeX",
    ruleCount: 1240,
  },
  {
    id: "github",
    name: "nb-github",
    title: "GitHub 开发者加速",
    category: "开发工具",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "Proxy",
    description: "GitHub 网页、代码仓库拉取、Raw 资源与 Releases 下载节点分流",
    source: "MetaCubeX",
    ruleCount: 260,
  },
  {
    id: "youtube",
    name: "nb-youtube",
    title: "YouTube 4K 流媒体",
    category: "流媒体",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "Proxy",
    description: "YouTube 主站与全球 CDN 视频流，定向分配高速带宽节点",
    source: "MetaCubeX",
    ruleCount: 890,
  },
  {
    id: "telegram",
    name: "nb-telegram",
    title: "Telegram 通信",
    category: "即时通信",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "Proxy",
    description: "Telegram 官方客户端、Web 端、Bot 接口与长连接代理",
    source: "MetaCubeX",
    ruleCount: 150,
  },
  {
    id: "apple-cn",
    name: "nb-apple-cn",
    title: "Apple 国内直连加速",
    category: "国内直连",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple-cn.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "DIRECT",
    description: "Apple 固件更新、国内 iCloud CDN 与 App Store 极速直连放行",
    source: "MetaCubeX",
    ruleCount: 340,
  },
  {
    id: "steam",
    name: "nb-steam",
    title: "Steam 游戏与下载",
    category: "游戏平台",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/steam.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "Proxy",
    description: "Steam 社区、好友聊天与商店分流，国内 CDN 下载自动识别直连",
    source: "MetaCubeX",
    ruleCount: 420,
  },
  {
    id: "microsoft",
    name: "nb-microsoft",
    title: "Microsoft 全球服务",
    category: "办公服务",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.mrs",
    behavior: "domain",
    format: "mrs",
    target_proxy: "DIRECT",
    description: "Office 365, Teams, Azure 与 Windows Update 稳定直连防跳验证",
    source: "MetaCubeX",
    ruleCount: 1100,
  },
];

// 本地外部规则集持久化存储键
const STORAGE_PROVIDERS_KEY = "procweaver_rule_providers_v2";

interface LocalProviderSpec {
  name: string;
  url: string;
  behavior: string;
  format?: string;
}

/**
 * 合并核心已载入的规则集与保存的本地规则集。
 */
export async function fetchRuleProviders(): Promise<RuleProviderItem[]> {
  if (isTauriEnvironment()) {
    const [liveResult, localResult] = await Promise.allSettled([
      invokeCommand<{ providers: Record<string, Partial<RuleProviderItem>> }>("get_mihomo_rule_providers"),
      invokeCommand<{ providers: LocalProviderSpec[] }>("get_local_rule_plan"),
    ]);
    const live = liveResult.status === "fulfilled" && liveResult.value?.providers;
    const local = localResult.status === "fulfilled" ? localResult.value?.providers : undefined;
    if (!live && !Array.isArray(local)) throw new Error("未读取到外部规则集");

    const active = new Map<string, RuleProviderItem>(Object.entries(live || {}).map(([name, item]) => [name, {
      name,
      type: item?.type || "Rule",
      vehicleType: item?.vehicleType || "HTTP",
      behavior: item?.behavior || "domain",
      format: item?.format || "yaml",
      ruleCount: item?.ruleCount ?? 0,
      updatedAt: item?.updatedAt ? new Date(item.updatedAt).toLocaleString() : undefined,
      url: item?.url,
      loaded: true,
    }]));
    const saved = (Array.isArray(local) ? local : []).map((item): RuleProviderItem => {
      const loaded = active.get(item.name);
      active.delete(item.name);
      return {
        name: item.name,
        type: loaded?.type || "Rule",
        vehicleType: loaded?.vehicleType || "HTTP",
        behavior: item.behavior,
        format: item.format || loaded?.format || "yaml",
        ruleCount: loaded?.ruleCount ?? 0,
        updatedAt: loaded?.updatedAt,
        url: item.url,
        managed: true,
        loaded: live ? Boolean(loaded) : undefined,
      };
    });
    return [...saved, ...active.values()];
  }

  try {
    const rawLocal = localStorage.getItem(STORAGE_PROVIDERS_KEY);
    if (rawLocal) {
      return (JSON.parse(rawLocal) as RuleProviderItem[]).map((item) => ({ ...item, managed: true, loaded: true }));
    }
  } catch {}

  return MOCK_PROVIDERS.map((item) => ({ ...item, managed: true, loaded: true }));
}

/**
 * 添加外部规则集 (支持自定义与开源预设一键挂载)
 */
export async function addExternalRuleProvider(
  provider: Omit<RuleProviderItem, "ruleCount"> & { ruleCount?: number; targetProxy?: string }
): Promise<void> {
  if (isTauriEnvironment()) {
    const added = await invokeCommand<boolean>("add_external_rule_provider", {
      spec: {
        name: provider.name.trim(),
        url: provider.url,
        behavior: provider.behavior,
        format: provider.format,
        targetProxy: provider.targetProxy ?? "Proxy",
      },
    });
    if (!added) throw new Error("未能保存本地规则集");
    return;
  }

  const current = await fetchRuleProviders();
  const nextItem: RuleProviderItem = {
    name: provider.name.trim(),
    type: provider.type || "Rule",
    vehicleType: provider.vehicleType || "HTTP",
    behavior: provider.behavior || "domain",
    format: provider.format || "yaml",
    ruleCount: provider.ruleCount ?? 0,
    updatedAt: new Date().toLocaleString(),
    url: provider.url,
  };

  const filtered = current.filter((p) => p.name !== nextItem.name);
  const next = [nextItem, ...filtered];
  localStorage.setItem(STORAGE_PROVIDERS_KEY, JSON.stringify(next));
}

/**
 * 移除外部规则集
 */
export async function removeExternalRuleProvider(name: string): Promise<void> {
  if (isTauriEnvironment()) {
    const removed = await invokeCommand<boolean>("remove_external_rule_provider", { name });
    if (!removed) throw new Error("核心未确认规则集卸载");
    return;
  }
  const current = await fetchRuleProviders();
  localStorage.setItem(STORAGE_PROVIDERS_KEY, JSON.stringify(current.filter((provider) => provider.name !== name)));
}

/**
 * 刷新单个外部规则集
 */
export async function updateRuleProvider(name: string): Promise<void> {
  if (isTauriEnvironment()) {
    const updated = await invokeCommand<boolean>("update_mihomo_rule_provider", { name });
    if (!updated) throw new Error("核心未确认规则集更新");
  } else {
    // 浏览器仿真延迟
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

/**
 * 路由模拟诊断算法 (Route Simulator)
 * 毫秒级回溯匹配：输入域名或 IP，试算出命中哪条规则以及出站出口
 */
export function simulateRouting(
  input: string,
  rules: RuleItem[]
): RouteSimulateResult {
  const clean = input.trim().toLowerCase();
  if (!clean) {
    return { input, matched: false };
  }

  // 1. 逐条规则匹配引擎
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.disabled) continue;
    const type = rule.type.toUpperCase();
    const payload = rule.payload.toLowerCase();

    // DOMAIN 精确匹配
    if (type === "DOMAIN" && clean === payload) {
      return {
        input,
        matched: true,
        rule,
        ruleIndex: i + 1,
        targetProxy: rule.proxy,
        matchType: "DOMAIN 精确匹配",
        matchDetail: `目标完全匹配域名表达式 [${rule.payload}]`,
      };
    }

    // DOMAIN-SUFFIX 后缀匹配
    if (
      type === "DOMAIN-SUFFIX" &&
      (clean === payload || clean.endsWith(`.${payload}`))
    ) {
      return {
        input,
        matched: true,
        rule,
        ruleIndex: i + 1,
        targetProxy: rule.proxy,
        matchType: "DOMAIN-SUFFIX 后缀匹配",
        matchDetail: `命中域名后缀 [*.${payload}]`,
      };
    }

    // DOMAIN-KEYWORD 关键字匹配
    if (type === "DOMAIN-KEYWORD" && clean.includes(payload)) {
      return {
        input,
        matched: true,
        rule,
        ruleIndex: i + 1,
        targetProxy: rule.proxy,
        matchType: "DOMAIN-KEYWORD 关键字匹配",
        matchDetail: `域名包含特征关键字 [${payload}]`,
      };
    }

    // IP-CIDR 局域网 / IP 匹配
    if (type === "IP-CIDR" || type === "IP-CIDR6") {
      if (clean === payload || (clean.startsWith("192.168.") && payload.startsWith("192.168."))) {
        return {
          input,
          matched: true,
          rule,
          ruleIndex: i + 1,
          targetProxy: rule.proxy,
          matchType: "IP-CIDR 网段匹配",
          matchDetail: `目标 IP 命中网段 [${rule.payload}]`,
        };
      }
    }

    // GEOSITE 分类匹配
    if (type === "GEOSITE") {
      if (payload === "cn" && DOMESTIC_SUFFIXES.some((s) => clean.endsWith(s))) {
        return {
          input,
          matched: true,
          rule,
          ruleIndex: i + 1,
          targetProxy: rule.proxy,
          matchType: "GEOSITE (CN) 大陆域名库",
          matchDetail: "命中中国大陆主流域名白名单库，直连放行",
        };
      }
      for (const [kw, group] of Object.entries(PROXY_KEYWORD_MAP)) {
        if (payload.includes(kw) && clean.includes(kw)) {
          return {
            input,
            matched: true,
            rule,
            ruleIndex: i + 1,
            targetProxy: rule.proxy,
            matchType: `GEOSITE (${group}) 专属特征库`,
            matchDetail: `命中 ${group} 知名云端服务规则集`,
          };
        }
      }
    }

    // 默认 MATCH 兜底
    if (type === "MATCH") {
      return {
        input,
        matched: true,
        rule,
        ruleIndex: i + 1,
        targetProxy: rule.proxy,
        matchType: "MATCH 最终兜底规则",
        matchDetail: "未匹配到上方前置规则，执行分流引擎默认兜底出口",
      };
    }
  }

  return {
    input,
    matched: false,
    matchDetail: "未命中任何已注册规则",
  };
}
