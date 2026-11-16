// ==========================================================================
// ProcWeaver src-next 节点大盘服务网关
// 规范溯源: rust-pro (Mihomo IPC) / IPpure 健康体检 / 订阅与自建管理
// 对接指令: get_mihomo_proxies, switch_mihomo_proxy, switch_public_node,
//           test_mihomo_delay, list_profiles, select_profile,
//           get_local_nodes, preview_local_nodes, save_local_nodes,
//           begin_health_probe, probe_node_health, end_health_probe,
//           get_health_cache, save_health_cache
// ==========================================================================

import { isTauriEnvironment } from "./client";
import {
  ProxyGroupItem,
  ProxyItem,
  NodeHealthResult,
  ProfileItem,
  LocalCustomNode,
  SpeedtestEndpoint,
} from "../types/proxy";

export interface ProxiesSnapshot {
  groups: ProxyGroupItem[];
  proxies: Record<string, ProxyItem>;
  activeProfile?: ProfileItem;
}

// 默认测速端点预设表
export const SPEEDTEST_ENDPOINTS: SpeedtestEndpoint[] = [
  { id: "google", name: "Google Gstatic (默认)", url: "http://www.gstatic.com/generate_204" },
  { id: "cloudflare", name: "Cloudflare 边缘节点", url: "https://cp.cloudflare.com/generate_204" },
  { id: "microsoft", name: "Microsoft 连通性测试", url: "http://www.msftconnecttest.com/connecttest.txt" },
  { id: "rom", name: "国内互联优化 (MIUI ROM)", url: "http://connect.rom.miui.com/generate_204" },
];

const SPEEDTEST_STORAGE_KEY = "procweaver_speedtest_url";
const IGNORED_NODES_KEY = "procweaver_ignored_nodes";
const HEALTH_CACHE_KEY = "procweaver_node_health_cache";
const LOCAL_NODES_KEY = "procweaver_local_custom_nodes";

// ==========================================================================
// 纯浏览器环境保真 Mock 数据池
// ==========================================================================
let mockProfiles: ProfileItem[] = [
  {
    id: "profile-1",
    name: "极速云专线 [主力全能]",
    url: "https://subscribe.example.com/api/v1/client/subscribe?token=main",
    updatedAt: "2026-11-06 14:30",
    totalBytes: 500 * 1024 * 1024 * 1024,
    usedBytes: 182 * 1024 * 1024 * 1024,
    nodeCount: 16,
    active: true,
  },
  {
    id: "profile-2",
    name: "低延迟海外流媒体备用源",
    url: "https://backup.example.com/sub/v3",
    updatedAt: "2026-11-05 09:12",
    totalBytes: 300 * 1024 * 1024 * 1024,
    usedBytes: 45 * 1024 * 1024 * 1024,
    nodeCount: 12,
    active: false,
  },
];

let mockProxiesState: Record<string, ProxyItem> = {
  // 香港
  "香港 01 | 极速专线 [BGP]": {
    name: "香港 01 | 极速专线 [BGP]",
    type: "Hysteria2",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 28 }],
    alive: true,
  },
  "香港 02 | HKT 家宽原生": {
    name: "香港 02 | HKT 家宽原生",
    type: "Vless",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 35 }],
    alive: true,
  },
  "香港 03 | HKBN 企业专网": {
    name: "香港 03 | HKBN 企业专网",
    type: "Trojan",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 42 }],
    alive: true,
  },
  "香港 04 | IPLC 极速内网 | 1.5x": {
    name: "香港 04 | IPLC 极速内网 | 1.5x",
    type: "Shadowsocks",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 22 }],
    alive: true,
  },

  // 日本
  "日本 01 | 东京 Softbank 专线": {
    name: "日本 01 | 东京 Softbank 专线",
    type: "Hysteria2",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 68 }],
    alive: true,
  },
  "日本 02 | 大阪 IIJ 优化": {
    name: "日本 02 | 大阪 IIJ 优化",
    type: "Vless",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 75 }],
    alive: true,
  },
  "日本 03 | 东京 NTT 宽带 | 0.5x": {
    name: "日本 03 | 东京 NTT 宽带 | 0.5x",
    type: "Shadowsocks",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 82 }],
    alive: true,
  },

  // 新加坡
  "新加坡 01 | 狮城 BGP 骨干原生": {
    name: "新加坡 01 | 狮城 BGP 骨干原生",
    type: "Hysteria2",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 58 }],
    alive: true,
  },
  "新加坡 02 | Singtel 极速专线": {
    name: "新加坡 02 | Singtel 极速专线",
    type: "Vless",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 62 }],
    alive: true,
  },

  // 美国
  "美国 01 | 圣何塞 硅谷超速": {
    name: "美国 01 | 圣何塞 硅谷超速",
    type: "Hysteria2",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 145 }],
    alive: true,
  },
  "美国 02 | 洛杉矶 BGP 优质 | 1.0x": {
    name: "美国 02 | 洛杉矶 BGP 优质 | 1.0x",
    type: "Vless",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 152 }],
    alive: true,
  },
  "美国 03 | 纽约 全球抗封锁 | 0.5x": {
    name: "美国 03 | 纽约 全球抗封锁 | 0.5x",
    type: "Trojan",
    udp: true,
    history: [{ time: "2026-11-06T08:00:00Z", delay: 178 }],
    alive: true,
  },

  // 广告/公告节点 (用于测试静默过滤机制)
  "剩余流量: 318GB | 距离重置 12 天": { name: "剩余流量: 318GB | 距离重置 12 天", type: "Unknown" },
  "套餐到期时间: 2026-12-31": { name: "套餐到期时间: 2026-12-31", type: "Unknown" },
  "官网地址: https://example-cloud.com": { name: "官网地址: https://example-cloud.com", type: "Unknown" },
  "官方 Telegram 交流群组": { name: "官方 Telegram 交流群组", type: "Unknown" },

  // 直连
  "DIRECT": { name: "DIRECT", type: "Direct", udp: true, history: [{ time: "", delay: 1 }], alive: true },
};

let mockGroupsState: ProxyGroupItem[] = [
  {
    name: "Proxy",
    type: "Selector",
    now: "香港 01 | 极速专线 [BGP]",
    all: [
      "Auto - 自动低延迟优选",
      "剩余流量: 318GB | 距离重置 12 天",
      "套餐到期时间: 2026-12-31",
      "官网地址: https://example-cloud.com",
      "香港 01 | 极速专线 [BGP]",
      "香港 02 | HKT 家宽原生",
      "香港 03 | HKBN 企业专网",
      "香港 04 | IPLC 极速内网 | 1.5x",
      "日本 01 | 东京 Softbank 专线",
      "日本 02 | 大阪 IIJ 优化",
      "日本 03 | 东京 NTT 宽带 | 0.5x",
      "新加坡 01 | 狮城 BGP 骨干原生",
      "新加坡 02 | Singtel 极速专线",
      "美国 01 | 圣何塞 硅谷超速",
      "美国 02 | 洛杉矶 BGP 优质 | 1.0x",
      "美国 03 | 纽约 全球抗封锁 | 0.5x",
      "官方 Telegram 交流群组",
      "DIRECT",
    ],
  },
  {
    name: "Auto - 自动低延迟优选",
    type: "URLTest",
    now: "香港 04 | IPLC 极速内网 | 1.5x",
    all: [
      "香港 01 | 极速专线 [BGP]",
      "香港 04 | IPLC 极速内网 | 1.5x",
      "日本 01 | 东京 Softbank 专线",
      "新加坡 01 | 狮城 BGP 骨干原生",
    ],
  },
  {
    name: "Fallback - 故障转移保障",
    type: "Fallback",
    now: "香港 01 | 极速专线 [BGP]",
    all: [
      "香港 01 | 极速专线 [BGP]",
      "日本 01 | 东京 Softbank 专线",
      "新加坡 01 | 狮城 BGP 骨干原生",
      "DIRECT",
    ],
  },
];

// ==========================================================================
// 测速端点管理
// ==========================================================================
export function getSpeedtestUrl(): string {
  return localStorage.getItem(SPEEDTEST_STORAGE_KEY) || SPEEDTEST_ENDPOINTS[0].url;
}

export function setSpeedtestUrl(url: string): void {
  localStorage.setItem(SPEEDTEST_STORAGE_KEY, url);
}

// ==========================================================================
// 节点忽略/隐藏名单管理
// ==========================================================================
export function getIgnoredNodes(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORED_NODES_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {
    // pass
  }
  return new Set();
}

export function toggleIgnoreNode(nodeName: string): boolean {
  const set = getIgnoredNodes();
  let isIgnored = false;
  if (set.has(nodeName)) {
    set.delete(nodeName);
    isIgnored = false;
  } else {
    set.add(nodeName);
    isIgnored = true;
  }
  localStorage.setItem(IGNORED_NODES_KEY, JSON.stringify(Array.from(set)));
  return isIgnored;
}

export function clearIgnoredNodes(): void {
  localStorage.removeItem(IGNORED_NODES_KEY);
}

// ==========================================================================
// IPpure 健康体检缓存管理
// ==========================================================================
export function getHealthCache(): Record<string, NodeHealthResult> {
  try {
    const raw = localStorage.getItem(HEALTH_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // pass
  }
  return {};
}

export function saveHealthCache(cache: Record<string, NodeHealthResult>): void {
  try {
    localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(cache));
    if (isTauriEnvironment()) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("save_health_cache", { cache }).catch(() => {});
      });
    }
  } catch (e) {
    // pass
  }
}

// ==========================================================================
// 本地自建自定义节点管理
// ==========================================================================
export function getLocalCustomNodes(): LocalCustomNode[] {
  try {
    const raw = localStorage.getItem(LOCAL_NODES_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // pass
  }
  return [];
}

export function saveLocalCustomNodes(nodes: LocalCustomNode[]): void {
  localStorage.setItem(LOCAL_NODES_KEY, JSON.stringify(nodes));
}

export function addLocalCustomNode(rawLink: string, customAlias?: string): LocalCustomNode {
  const link = rawLink.trim();
  let protocol = "Unknown" as any;
  const server = "127.0.0.1";
  const port = 443;
  let alias = customAlias || "自建节点";

  if (link.startsWith("hysteria2://") || link.startsWith("hy2://")) {
    protocol = "Hysteria2";
  } else if (link.startsWith("vless://")) {
    protocol = "Vless";
  } else if (link.startsWith("vmess://")) {
    protocol = "Vmess";
  } else if (link.startsWith("trojan://")) {
    protocol = "Trojan";
  } else if (link.startsWith("ss://")) {
    protocol = "Shadowsocks";
  } else if (link.startsWith("wireguard://")) {
    protocol = "WireGuard";
  }

  // 尝试提取别名 (哈希锚点 #name)
  const hashIdx = link.indexOf("#");
  if (hashIdx !== -1 && !customAlias) {
    try {
      alias = decodeURIComponent(link.slice(hashIdx + 1).trim());
    } catch (e) {
      alias = link.slice(hashIdx + 1).trim();
    }
  }

  const newNode: LocalCustomNode = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    alias: alias || "未命名自建节点",
    protocol,
    server,
    port,
    rawLink: link,
    createdAt: new Date().toISOString(),
  };

  const list = getLocalCustomNodes();
  list.unshift(newNode);
  saveLocalCustomNodes(list);

  // 若处于 Tauri 桌面环境，异步同步至 Rust 后端本地代理节点持久化库
  if (isTauriEnvironment()) {
    import("@tauri-apps/api/core").then(async ({ invoke }) => {
      try {
        const drafts = await invoke<any[]>("preview_local_nodes", { text: link });
        if (Array.isArray(drafts) && drafts.length > 0) {
          const view = await invoke<any>("get_local_nodes");
          const rev = view?.revision || 0;
          await invoke("save_local_nodes", {
            expectedRevision: rev,
            upserts: drafts,
            deletes: [],
          });
        }
      } catch (err) {
        console.warn("[proxyService] sync local node to Rust backend warning:", err);
      }
    });
  }

  return newNode;
}

export function deleteLocalCustomNode(id: string): void {
  const list = getLocalCustomNodes().filter((n) => n.id !== id);
  saveLocalCustomNodes(list);

  if (isTauriEnvironment()) {
    import("@tauri-apps/api/core").then(async ({ invoke }) => {
      try {
        const view = await invoke<any>("get_local_nodes");
        const rev = view?.revision || 0;
        await invoke("save_local_nodes", {
          expectedRevision: rev,
          upserts: [],
          deletes: [id],
        });
      } catch {}
    });
  }
}

// ==========================================================================
// 核心数据获取与切换
// ==========================================================================

/**
 * 获取完整节点与策略组快照 (附带健康体检缓存与自建节点合并)
 */
export async function fetchProxiesData(): Promise<ProxiesSnapshot> {
  const healthCache = getHealthCache();
  const customNodes = getLocalCustomNodes();

  let resultGroups: ProxyGroupItem[] = [];
  let resultProxies: Record<string, ProxyItem> = {};
  let activeProfile: ProfileItem | undefined;

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // 1. 同步加载 Rust 磁盘中的持久化健康体检缓存
      try {
        const diskCache = await invoke<Record<string, any>>("get_health_cache");
        if (diskCache && typeof diskCache === "object") {
          Object.assign(healthCache, diskCache);
          localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(healthCache));
        }
      } catch {}

      // 2. 从 Mihomo 内核拉取全部出站代理与策略组
      const raw = await invoke<any>("get_mihomo_proxies");
      if (raw && raw.proxies) {
        for (const [key, value] of Object.entries<any>(raw.proxies)) {
          if (value.all && Array.isArray(value.all)) {
            resultGroups.push({
              name: key,
              type: value.type || "Selector",
              now: value.now || "",
              all: value.all || [],
              icon: value.icon,
              hidden: Boolean(value.hidden),
            });
          }
          resultProxies[key] = {
            name: key,
            type: value.type || "Unknown",
            udp: value.udp ?? true,
            history: value.history || [],
            alive: value.alive ?? true,
            now: value.now,
            all: value.all,
            health: healthCache[key],
          };
        }
      }

      // 3. 读取当前激活的 Profile
      try {
        const profilesList = await invoke<any[]>("list_profiles");
        if (Array.isArray(profilesList) && profilesList.length > 0) {
          const selected = profilesList.find((p) => p.isSelected) || profilesList[0];
          if (selected) {
            activeProfile = {
              id: selected.id,
              name: selected.name,
              url: selected.url,
              updatedAt: selected.updatedAt,
              nodeCount: selected.nodeCount,
              active: true,
              totalBytes: selected.total,
              usedBytes: (selected.upload || 0) + (selected.download || 0),
            };
          }
        }
      } catch {}

      // 4. 同步读取 Rust 后端本地自建节点
      try {
        const localNodesView = await invoke<any>("get_local_nodes");
        if (localNodesView && Array.isArray(localNodesView.nodes) && localNodesView.nodes.length > 0) {
          const customNames: string[] = [];
          for (const ln of localNodesView.nodes) {
            const nodeName = `[自建] ${ln.name || ln.alias || "自建节点"}`;
            customNames.push(nodeName);
            resultProxies[nodeName] = {
              name: nodeName,
              type: ln.protocol || "Custom",
              udp: true,
              alive: true,
              isCustom: true,
              history: [{ time: "", delay: 35 }],
              health: healthCache[nodeName],
            };
          }

          if (customNames.length > 0) {
            resultGroups.unshift({
              name: "自建 VPS 节点",
              type: "Selector",
              now: customNames[0] || "",
              all: customNames,
            });
          }
        }
      } catch {}
    } catch (e) {
      console.warn("[proxyService] fetchProxiesData failed in Tauri, fallback to mock", e);
    }
  }

  // 仅在纯浏览器开发预览环境 (无 Tauri 后端 IPC) 下注入保真 Mock
  if (!isTauriEnvironment()) {
    if (resultGroups.length === 0) {
      resultGroups = [...mockGroupsState];
      resultProxies = { ...mockProxiesState };

      for (const [k, p] of Object.entries(resultProxies)) {
        p.health = healthCache[k];
      }
    }

    // 浏览器环境下合并本地自建节点到大盘
    if (customNodes.length > 0) {
      const customNames = customNodes.map((n) => `[自建] ${n.alias}`);
      for (const cn of customNodes) {
        const nodeName = `[自建] ${cn.alias}`;
        resultProxies[nodeName] = {
          name: nodeName,
          type: cn.protocol,
          udp: true,
          alive: true,
          isCustom: true,
          history: [{ time: cn.createdAt, delay: 45 }],
          health: healthCache[nodeName],
        };
      }

      resultGroups.unshift({
        name: "自建 VPS 节点",
        type: "Selector",
        now: customNames[0] || "",
        all: customNames,
      });
    }

    if (!activeProfile) {
      activeProfile = mockProfiles.find((p) => p.active) || mockProfiles[0];
    }
  }

  return {
    groups: resultGroups,
    proxies: resultProxies,
    activeProfile,
  };
}

/**
 * 切换指定策略组的当前活动节点，并智能联动受管公共出站组（GLOBAL / PROXY / 节点选择）
 * 规范溯源: rust-pro (switch_public_node / switch_mihomo_proxy) / 旧版 LinesManagementView
 */
export async function switchGroupProxy(groupName: string, proxyName: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      
      // 1. 切换目标单组
      await invoke("switch_mihomo_proxy", { group: groupName, proxy: proxyName });

      // 若当前操作的是订阅原生主组（如“节点选择”），尝试同步保持底层合成 PROXY 组选项一致
      if (groupName !== "PROXY") {
        invoke("switch_mihomo_proxy", { group: "PROXY", proxy: proxyName }).catch(() => {});
      }

      // 2. 深度联动：若选中的是具体物理节点（非内部策略组），联动切换所有受管公共组 (PROXY / GLOBAL / 节点选择) 并热重置旧长连接
      const isSpecialGroupOrAction =
        proxyName === "DIRECT" ||
        proxyName === "REJECT" ||
        proxyName === "PASS" ||
        proxyName.startsWith("PW-") ||
        proxyName.includes("自动选择");

      if (!isSpecialGroupOrAction) {
        invoke("switch_public_node", { node: proxyName }).catch((err) => {
          console.warn("[proxyService] switch_public_node linkage notice:", err);
        });
      }

      window.dispatchEvent(
        new CustomEvent("netbox-active-node-changed", { detail: { nodeName: proxyName } })
      );
      window.dispatchEvent(new Event("netbox-route-changed"));
      return true;
    } catch (e) {
      console.warn("[proxyService] switchGroupProxy failed in Tauri", e);
      return false;
    }
  }

  const targetGroup = mockGroupsState.find((g) => g.name === groupName);
  if (targetGroup) {
    targetGroup.now = proxyName;
  }
  return true;
}

/**
 * 测试单个节点延迟 (基于选定测速端点)
 * Rust 端指令: test_mihomo_delay (返回 Option<u32>)
 */
export async function testSingleDelay(
  proxyName: string,
  testUrl?: string
): Promise<number> {
  const targetUrl = testUrl || getSpeedtestUrl();

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<number | null>("test_mihomo_delay", {
        proxy: proxyName,
        url: targetUrl,
        timeout: 4000,
      });
      if (typeof res === "number" && res >= 0) {
        return res;
      }
      return -1;
    } catch (e) {
      return -1;
    }
  }

  // 纯浏览器模拟
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  let simDelay = Math.floor(22 + Math.random() * 110);
  if (proxyName.includes("美国")) simDelay += 110;
  if (proxyName.includes("日本")) simDelay += 40;
  if (proxyName.includes("DIRECT")) simDelay = 1;
  if (Math.random() < 0.03) simDelay = -1;

  if (mockProxiesState[proxyName]) {
    mockProxiesState[proxyName].history = [
      ...(mockProxiesState[proxyName].history || []),
      { time: new Date().toISOString(), delay: simDelay },
    ];
  }

  return simDelay;
}

/**
 * 批量并发测速整个策略组下的所有节点
 */
export async function testGroupBatchDelay(
  _groupName: string,
  nodes: string[],
  onProgress?: (node: string, delay: number) => void
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const concurrency = 6;
  const queue = [...nodes];

  const workers = Array.from({ length: concurrency }).map(async () => {
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      const delay = await testSingleDelay(node);
      results[node] = delay;
      if (onProgress) onProgress(node, delay);
    }
  });

  await Promise.all(workers);
  return results;
}

// ==========================================================================
// IPpure 深度健康体检引擎 (测订阅源所有节点)
// 对接 Rust 指令: begin_health_probe, probe_node_health, end_health_probe
// ==========================================================================

/**
 * 针对单个节点执行 IPpure 测健康
 */
export async function probeSingleNodeHealth(
  nodeName: string
): Promise<NodeHealthResult> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const session = await invoke<string>("begin_health_probe", { names: [nodeName] });
      try {
        const res = await invoke<any>("probe_node_health", { session, node: nodeName });
        if (res && res.ip) {
          const isRes = res.isResidential ?? (res.asOrganization ? !/cloudflare|google|amazon|microsoft|alibaba|tencent|oracle|digitalocean/i.test(res.asOrganization) : false);
          const result: NodeHealthResult = {
            ip: res.ip,
            asn: res.asn,
            asOrganization: res.asOrganization,
            country: res.country,
            countryCode: res.countryCode,
            region: res.region,
            city: res.city,
            fraudScore: res.fraudScore ?? 15,
            isResidential: isRes,
            isBroadcast: res.isBroadcast ?? false,
            ipType: isRes ? "原生家宽" : res.isBroadcast ? "广播IP" : "机房商宽",
            testedAt: new Date().toISOString(),
          };
          return result;
        }
      } finally {
        await invoke("end_health_probe", { session }).catch(() => {});
      }
    } catch (e) {
      console.warn(`[proxyService] probeSingleNodeHealth failed for ${nodeName}`, e);
    }
  }

  // 纯浏览器模拟健康体检
  await new Promise((r) => setTimeout(r, 220 + Math.random() * 250));

  const isHkHome = nodeName.includes("家宽") || nodeName.includes("HKT") || nodeName.includes("中华电信");
  const isBroadcast = nodeName.includes("抗封锁");
  let score = Math.floor(10 + Math.random() * 25);
  if (!isHkHome) score += 35;
  if (isBroadcast) score += 30;

  return {
    ip: `104.28.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}`,
    asn: 13335,
    asOrganization: isHkHome ? "Hong Kong Telecommunications (HKT) Limited" : "Cloudflare, Inc.",
    countryCode: nodeName.includes("香港") ? "HK" : nodeName.includes("日本") ? "JP" : "US",
    city: nodeName.includes("香港") ? "Hong Kong" : nodeName.includes("日本") ? "Tokyo" : "Los Angeles",
    fraudScore: score,
    isResidential: isHkHome,
    isBroadcast,
    ipType: isHkHome ? "原生家宽" : isBroadcast ? "广播IP" : "机房商宽",
    testedAt: new Date().toISOString(),
  };
}

/**
 * 批量并发测健康：对传入的所有节点进行 IPpure 深度体检
 * 带有实时回调与持久化写入
 */
export async function probeNodesHealthBatch(
  nodes: string[],
  onProgress?: (node: string, health: NodeHealthResult, completed: number, total: number) => void
): Promise<Record<string, NodeHealthResult>> {
  const cache = getHealthCache();
  const results: Record<string, NodeHealthResult> = { ...cache };
  const unique = [...new Set(nodes)];
  const total = unique.length;
  let completed = 0;

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const chunkSize = 8;
      for (let i = 0; i < total; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        let session = "";
        try {
          session = await invoke<string>("begin_health_probe", { names: chunk });
        } catch (e) {
          console.warn("[proxyService] begin_health_probe failed:", e);
          continue;
        }

        await Promise.allSettled(
          chunk.map(async (node, idx) => {
            if (idx > 0) {
              await new Promise((r) => setTimeout(r, idx * 50));
            }
            try {
              const res = await invoke<any>("probe_node_health", { session, node });
              if (res && res.ip) {
                const isRes = res.isResidential ?? (res.asOrganization ? !/cloudflare|google|amazon|microsoft|alibaba|tencent|oracle|digitalocean/i.test(res.asOrganization) : false);
                const health: NodeHealthResult = {
                  ip: res.ip,
                  asn: res.asn,
                  asOrganization: res.asOrganization,
                  country: res.country,
                  countryCode: res.countryCode,
                  region: res.region,
                  city: res.city,
                  fraudScore: res.fraudScore ?? 15,
                  isResidential: isRes,
                  isBroadcast: res.isBroadcast ?? false,
                  ipType: isRes ? "原生家宽" : res.isBroadcast ? "广播IP" : "机房商宽",
                  testedAt: new Date().toISOString(),
                };
                results[node] = health;
                completed++;
                if (onProgress) onProgress(node, health, completed, total);
              }
            } catch (err) {
              completed++;
              console.warn(`[proxyService] probe_node_health failed for ${node}:`, err);
            }
          })
        );

        try {
          await invoke("end_health_probe", { session });
        } catch {}
      }

      saveHealthCache(results);
      return results;
    } catch (e) {
      console.warn("[proxyService] probeNodesHealthBatch failed in Tauri:", e);
    }
  }

  // 纯浏览器模拟
  const concurrency = 4;
  const queue = [...unique];
  const workers = Array.from({ length: concurrency }).map(async () => {
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      const health = await probeSingleNodeHealth(node);
      results[node] = health;
      completed++;
      if (onProgress) onProgress(node, health, completed, total);
    }
  });

  await Promise.all(workers);
  saveHealthCache(results);
  return results;
}

// ==========================================================================
// 订阅源管理 (对接 Rust: list_profiles, select_profile)
// ==========================================================================
export async function fetchProfiles(): Promise<ProfileItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<any[]>("list_profiles");
      if (Array.isArray(list) && list.length > 0) {
        return list.map((p) => ({
          id: p.id,
          name: p.name,
          url: p.url,
          updatedAt: p.updatedAt,
          nodeCount: p.nodeCount,
          active: Boolean(p.isSelected),
          totalBytes: p.total,
          usedBytes: (p.upload || 0) + (p.download || 0),
        }));
      }
    } catch (e) {
      console.warn("[proxyService] list_profiles failed in Tauri:", e);
    }
  }
  return [...mockProfiles];
}

export async function switchProfile(profileId: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("select_profile", { id: profileId, bindingDecision: null });
      window.dispatchEvent(new Event("netbox-profile-changed"));
      return true;
    } catch (e) {
      console.warn("[proxyService] select_profile failed in Tauri:", e);
      throw e;
    }
  }

  mockProfiles = mockProfiles.map((p) => ({
    ...p,
    active: p.id === profileId,
  }));
  return true;
}
