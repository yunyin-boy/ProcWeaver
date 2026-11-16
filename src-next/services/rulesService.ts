// ==========================================================================
// ProcWeaver src-next 业务规则编织系统服务网关 (Rules Service)
// 规范溯源: rust-pro (Mihomo Rules IPC) / typography-dark-mono-optics
// 对接指令: get_mihomo_rules, get_mihomo_rule_providers, update_mihomo_rule_provider,
//           switch_mihomo_proxy, get_mihomo_proxies
// ==========================================================================

import { isTauriEnvironment } from "./client";
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

/**
 * 获取内核当前生效的全部规则
 */
export async function fetchRules(): Promise<RuleItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<any>("get_mihomo_rules");
      if (raw && Array.isArray(raw.rules)) {
        return raw.rules.map((r: any, idx: number) => ({
          id: `rule_${idx}`,
          type: r.type || "UNKNOWN",
          payload: r.payload || "",
          proxy: r.proxy || "DIRECT",
          size: r.size,
          format: r.format,
        }));
      }
    } catch (err) {
      console.warn("[rulesService] get_mihomo_rules failed:", err);
    }
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

/**
 * 获取内核外部规则集订阅 (带空值绝对防护)
 */
export async function fetchRuleProviders(): Promise<RuleProviderItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<any>("get_mihomo_rule_providers");
      if (raw && typeof raw === "object") {
        const providers = raw.providers || raw;
        return Object.entries<any>(providers).map(([name, item]) => ({
          name,
          type: item?.type || "Rule",
          vehicleType: item?.vehicleType || "HTTP",
          behavior: item?.behavior || "domain",
          format: item?.format || "yaml",
          ruleCount: item?.ruleCount ?? 0,
          updatedAt: item?.updatedAt ? new Date(item.updatedAt).toLocaleString() : undefined,
          url: item?.url,
        }));
      }
    } catch (err) {
      console.warn("[rulesService] get_mihomo_rule_providers failed:", err);
    }
  }

  try {
    const rawLocal = localStorage.getItem(STORAGE_PROVIDERS_KEY);
    if (rawLocal) {
      return JSON.parse(rawLocal);
    }
  } catch {}

  return MOCK_PROVIDERS;
}

/**
 * 添加外部规则集 (支持自定义与开源预设一键挂载)
 */
export async function addExternalRuleProvider(
  provider: Omit<RuleProviderItem, "ruleCount"> & { ruleCount?: number }
): Promise<RuleProviderItem[]> {
  const current = await fetchRuleProviders();
  const nextItem: RuleProviderItem = {
    name: provider.name.trim(),
    type: provider.type || "Rule",
    vehicleType: provider.vehicleType || "HTTP",
    behavior: provider.behavior || "domain",
    format: provider.format || "yaml",
    ruleCount: provider.ruleCount || 1000,
    updatedAt: new Date().toLocaleString(),
    url: provider.url,
  };

  const filtered = current.filter((p) => p.name !== nextItem.name);
  const next = [nextItem, ...filtered];
  localStorage.setItem(STORAGE_PROVIDERS_KEY, JSON.stringify(next));

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("add_external_rule_provider", {
        name: nextItem.name,
        url: nextItem.url,
        behavior: nextItem.behavior,
        format: nextItem.format,
        target_proxy: "Proxy",
      });
    } catch (err) {
      console.warn("[rulesService] add_external_rule_provider in Tauri failed:", err);
    }
  }

  return next;
}

/**
 * 移除外部规则集
 */
export async function removeExternalRuleProvider(name: string): Promise<RuleProviderItem[]> {
  const current = await fetchRuleProviders();
  const next = current.filter((p) => p.name !== name);
  localStorage.setItem(STORAGE_PROVIDERS_KEY, JSON.stringify(next));

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("remove_external_rule_provider", { name });
    } catch (err) {
      console.warn("[rulesService] remove_external_rule_provider in Tauri failed:", err);
    }
  }

  return next;
}

/**
 * 刷新单个外部规则集
 */
export async function updateRuleProvider(name: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("update_mihomo_rule_provider", { name });
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
