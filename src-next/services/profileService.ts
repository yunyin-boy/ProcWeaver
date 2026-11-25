// ==========================================================================
// ProcWeaver src-next 订阅源与配置服务
// 对接后端 IPC: list_profiles, add_profile, update_profile, select_profile,
//               delete_profile, edit_profile_metadata, get_profile_content,
//               save_profile_content, import_profile_content
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { ProfileItem, AddProfileParams, ImportProfileParams } from "../types/profile";
import type { RoutingView } from "../../src/types/routingOverrides";
import {
  archiveProfileOutlets,
  restoreOrClearProfileOutlets,
  removeProfileOutlets,
} from "./profileOutletMemoryService";
import {
  fetchBundles,
  saveBundles,
  syncRoutingToCore,
} from "./processRoutingService";

const MOCK_PROFILES_KEY = "procweaver_mock_profiles_next";
export const PROFILE_CHANGED_EVENT = "procweaver-profile-changed";

export function notifyProfileChanged(): void {
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

function getMockProfiles(): ProfileItem[] {
  const raw = localStorage.getItem(MOCK_PROFILES_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // 容错解析
    }
  }
  const defaultList: ProfileItem[] = [
    {
      id: "profile-1",
      name: "香港/日本/新加坡高速专线",
      url: "https://sub.airport-vip.org/api/v1/client/subscribe?token=a8b9c1d2e3f4",
      filePath: "data/config/profiles/profile-1.yaml",
      updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      nodeCount: 48,
      isSelected: true,
      upload: 12 * 1024 * 1024 * 1024,
      download: 148 * 1024 * 1024 * 1024,
      total: 500 * 1024 * 1024 * 1024,
      expire: Math.floor((Date.now() + 1000 * 60 * 60 * 24 * 72) / 1000),
      autoUpdateInterval: 24,
      lastUpdatedAtSeconds: Math.floor(Date.now() / 1000) - 2100,
    },
    {
      id: "profile-2",
      name: "北美/欧洲低延迟游戏备用源",
      url: "https://cloud.sub-node.io/clash/config.yaml?auth=sec_991823",
      filePath: "data/config/profiles/profile-2.yaml",
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(),
      nodeCount: 32,
      isSelected: false,
      upload: 4 * 1024 * 1024 * 1024,
      download: 52 * 1024 * 1024 * 1024,
      total: 200 * 1024 * 1024 * 1024,
      expire: Math.floor((Date.now() + 1000 * 60 * 60 * 24 * 180) / 1000),
      autoUpdateInterval: 48,
      lastUpdatedAtSeconds: Math.floor(Date.now() / 1000) - 50400,
    },
    {
      id: "profile-3",
      name: "本地自建私有混合分流规则集",
      url: "",
      filePath: "data/config/profiles/local-custom.yaml",
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      nodeCount: 16,
      isSelected: false,
      autoUpdateInterval: 0,
      lastUpdatedAtSeconds: Math.floor(Date.now() / 1000) - 259200,
    },
  ];
  localStorage.setItem(MOCK_PROFILES_KEY, JSON.stringify(defaultList));
  return defaultList;
}

function saveMockProfiles(list: ProfileItem[]) {
  localStorage.setItem(MOCK_PROFILES_KEY, JSON.stringify(list));
}

/** 获取全部订阅配置列表 */
export async function getProfiles(): Promise<ProfileItem[]> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<ProfileItem[]>("list_profiles");
    } catch (e) {
      console.warn("[profileService] list_profiles failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 150));
  return getMockProfiles();
}

/** 添加远程订阅源 */
export async function addProfile(params: AddProfileParams): Promise<ProfileItem> {
  if (isTauriEnvironment()) {
    try {
      const added = await invokeCommand<ProfileItem>("add_profile", {
        name: params.name,
        url: params.url,
        autoUpdateInterval: params.autoUpdateInterval,
      });
      notifyProfileChanged();
      return added;
    } catch (e) {
      console.warn("[profileService] add_profile failed:", e);
      throw e;
    }
  }
  const source = new URL(params.url);
  if (!source.hostname) throw new Error("请填写有效的订阅链接地址");
  await new Promise((r) => setTimeout(r, 300));
  const list = getMockProfiles();
  const newItem: ProfileItem = {
    id: `profile-${Date.now()}`,
    name: params.name.trim() || source.hostname,
    url: params.url,
    filePath: `data/config/profiles/profile-${Date.now()}.yaml`,
    updatedAt: new Date().toISOString(),
    nodeCount: 24,
    isSelected: list.length === 0,
    autoUpdateInterval: params.autoUpdateInterval ?? 0,
    lastUpdatedAtSeconds: Math.floor(Date.now() / 1000),
  };
  list.unshift(newItem);
  saveMockProfiles(list);
  notifyProfileChanged();
  return newItem;
}

/** 导入本地配置文件 */
export async function importProfileContent(params: ImportProfileParams): Promise<ProfileItem> {
  if (isTauriEnvironment()) {
    try {
      const added = await invokeCommand<ProfileItem>("import_profile_content", {
        name: params.name,
        content: params.content,
      });
      notifyProfileChanged();
      return added;
    } catch (e) {
      console.warn("[profileService] import_profile_content failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  const list = getMockProfiles();
  const newItem: ProfileItem = {
    id: `local-${Date.now()}`,
    name: params.name || "本地导入配置",
    url: "",
    filePath: `data/config/profiles/local-${Date.now()}.yaml`,
    updatedAt: new Date().toISOString(),
    nodeCount: 12,
    isSelected: false,
    autoUpdateInterval: 0,
    lastUpdatedAtSeconds: Math.floor(Date.now() / 1000),
  };
  list.unshift(newItem);
  saveMockProfiles(list);
  notifyProfileChanged();
  return newItem;
}

async function refreshProfile(id: string): Promise<ProfileItem> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<ProfileItem>("update_profile", { id });
    } catch (e) {
      console.warn("[profileService] update_profile failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  const list = getMockProfiles();
  const index = list.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("订阅不存在");
  list[index].updatedAt = new Date().toISOString();
  list[index].lastUpdatedAtSeconds = Math.floor(Date.now() / 1000);
  saveMockProfiles(list);
  return list[index];
}

/** 在线拉取刷新单个订阅 */
export async function updateProfile(id: string): Promise<ProfileItem> {
  const updated = await refreshProfile(id);
  notifyProfileChanged();
  return updated;
}

export interface ProfileBatchUpdateResult {
  updatedCount: number;
  failedProfiles: Pick<ProfileItem, "id" | "name">[];
}

/** 刷新所有远程订阅并返回失败的订阅。 */
export async function updateAllProfiles(profiles: ProfileItem[]): Promise<ProfileBatchUpdateResult> {
  const targets = profiles.filter((p) => Boolean(p.url && p.url.trim()));
  const results = await Promise.allSettled(targets.map((p) => refreshProfile(p.id)));
  const failedProfiles = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    const { id, name } = targets[index];
    return [{ id, name }];
  });
  const updatedCount = targets.length - failedProfiles.length;
  if (updatedCount > 0) notifyProfileChanged();
  return { updatedCount, failedProfiles };
}

/** 激活切换当前配置方案 */
export async function selectProfile(id: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      // 1. 切换前获取当前生效订阅源，归档其进程分流出口节点
      try {
        const currentProfiles = await getProfiles();
        const activeProfile = currentProfiles.find((p) => p.isSelected);
        if (activeProfile && activeProfile.id !== id) {
          const currentBundles = await fetchBundles();
          archiveProfileOutlets(activeProfile.id, currentBundles);
        }
      } catch (archiveErr) {
        console.warn("[profileService] 归档旧订阅出口绑定警告:", archiveErr);
      }

      // 2. 调用底层无感切换至新订阅
      const success = await invokeCommand<boolean>("select_profile", {
        id,
        bindingDecision: null,
      });

      // 3. 切换完成后，根据新订阅历史记录自动恢复或清空进程分流出口
      try {
        const freshBundles = await fetchBundles();
        const { nextBundles } = restoreOrClearProfileOutlets(id, freshBundles);
        await saveBundles(nextBundles);
        await syncRoutingToCore(nextBundles);
        window.dispatchEvent(new Event("netbox-route-changed"));
        window.dispatchEvent(new Event("procweaver-route-changed"));
      } catch (restoreErr) {
        console.warn("[profileService] 恢复或清空新订阅分流出口警告:", restoreErr);
      }

      if (success) notifyProfileChanged();
      return success;
    } catch (e) {
      console.warn("[profileService] select_profile failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  const list = getMockProfiles();
  const updated = list.map((p) => ({ ...p, isSelected: p.id === id }));
  saveMockProfiles(updated);
  notifyProfileChanged();
  return true;
}

export async function getProfileBoundBundleNames(id: string): Promise<string[]> {
  if (!isTauriEnvironment()) return [];
  const { config } = await invokeCommand<RoutingView>("get_routing_overrides");
  return (config.bundles ?? [])
    .filter((bundle) => bundle.enabled
      && (bundle.mainTarget?.profileId === id || bundle.dnsTarget?.profileId === id))
    .map((bundle) => bundle.name);
}

/** 删除订阅源 */
export async function deleteProfile(id: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const success = await invokeCommand<boolean>("delete_profile", { id });
      if (success) {
        removeProfileOutlets(id);
        notifyProfileChanged();
      }
      return success;
    } catch (e) {
      console.warn("[profileService] delete_profile failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 150));
  const list = getMockProfiles();
  const updated = list.filter((p) => p.id !== id);
  saveMockProfiles(updated);
  removeProfileOutlets(id);
  notifyProfileChanged();
  return true;
}

/** 修改订阅元数据（名称、自动更新频率） */
export async function editProfileMetadata(
  id: string,
  name: string,
  autoUpdateInterval: number
): Promise<ProfileItem> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<ProfileItem>("edit_profile_metadata", {
        id,
        name,
        autoUpdateInterval,
      });
    } catch (e) {
      console.warn("[profileService] edit_profile_metadata failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 150));
  const list = getMockProfiles();
  const index = list.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("订阅不存在");
  list[index].name = name;
  list[index].autoUpdateInterval = autoUpdateInterval;
  saveMockProfiles(list);
  return list[index];
}

/** 获取订阅本地 YAML 源码 */
export async function getProfileContent(id: string): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<string>("get_profile_content", { id });
    } catch (e) {
      console.warn("[profileService] get_profile_content failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 150));
  return `# 配置文件快照 (ID: ${id})
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false

proxies:
  - name: "香港 01 | 极速专线 [BGP]"
    type: hysteria2
    server: hk01.example.com
    port: 443
  - name: "东京 02 | 4K 优化 [BGP]"
    type: vless
    server: jp02.example.com
    port: 8443
    uuid: 12345678-1234-1234-1234-123456789abc

proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - "香港 01 | 极速专线 [BGP]"
      - "东京 02 | 4K 优化 [BGP]"
      - DIRECT

rules:
  - MATCH,PROXY
`;
}

/** 保存修改后的 YAML 源码 */
export async function saveProfileContent(id: string, content: string): Promise<ProfileItem> {
  if (isTauriEnvironment()) {
    try {
      const updated = await invokeCommand<ProfileItem>("save_profile_content", {
        id,
        content,
      });
      notifyProfileChanged();
      return updated;
    } catch (e) {
      console.warn("[profileService] save_profile_content failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  const list = getMockProfiles();
  const index = list.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("订阅不存在");
  list[index].updatedAt = new Date().toISOString();
  saveMockProfiles(list);
  notifyProfileChanged();
  return list[index];
}

/** 格式化流量字节 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  if (gb < 1024) return `${gb.toFixed(2)} GB`;
  const tb = gb / 1024;
  return `${tb.toFixed(2)} TB`;
}

/** 格式化相对时间 */
export function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return "从未更新";
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return dateStr;
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "刚刚更新";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}
