// ==========================================================================
// ProcWeaver src-next 订阅源专属分流出口记忆服务 (Profile Outlet Memory)
// 功能设计:
// 1. 切换新订阅源时: 自动归档保存当前旧订阅源绑定的进程分流出口节点;
// 2. 切换至新订阅源后: 若新订阅源无历史记录，清空所有业务包专属节点绑定 (重置为默认出站 Proxy);
// 3. 再次切回旧订阅源: 自动恢复此前为该订阅源保存的专属节点出口绑定;
// 4. 删除订阅源时: 级联物理销毁该订阅源的所有出口记忆归档，绝无脏数据残留。
// ==========================================================================

import { ProcessBundleItem } from "../types/processRouting";

const STORAGE_PROFILE_OUTLETS_KEY = "procweaver_profile_outlet_memory";

export interface ProfileOutletRecord {
  bundleOutlets: Record<string, string>; // bundleId -> 节点名称或出口插槽名
  savedAt: number;
}

export type ProfileOutletMemoryStore = Record<string, ProfileOutletRecord>;

/** 读取所有订阅源的出口记忆总表 */
export function loadOutletMemoryStore(): ProfileOutletMemoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_PROFILE_OUTLETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("[profileOutletMemoryService] 读取出口记忆库失败:", e);
  }
  return {};
}

/** 持久化保存订阅源出口记忆总表 */
export function saveOutletMemoryStore(store: ProfileOutletMemoryStore): void {
  try {
    localStorage.setItem(STORAGE_PROFILE_OUTLETS_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("[profileOutletMemoryService] 持久化出口记忆库失败:", e);
  }
}

/**
 * 1. 归档保存指定旧订阅源当前的业务包节点出口绑定
 */
export function archiveProfileOutlets(
  profileId: string,
  bundles: ProcessBundleItem[]
): void {
  if (!profileId || !Array.isArray(bundles)) return;

  const bundleOutlets: Record<string, string> = {};
  for (const b of bundles) {
    if (b.targetProxy && b.targetProxy.trim() && b.targetProxy !== "Proxy") {
      bundleOutlets[b.id] = b.targetProxy.trim();
    }
  }

  const store = loadOutletMemoryStore();
  store[profileId] = {
    bundleOutlets,
    savedAt: Date.now(),
  };
  saveOutletMemoryStore(store);
  console.log(`[profileOutletMemoryService] 已归档订阅源 [${profileId}] 的出口绑定:`, bundleOutlets);
}

/**
 * 2. 切换到新订阅源时: 自动恢复该订阅源的历史出口，若为新订阅源则清空业务包专属出口
 */
export function restoreOrClearProfileOutlets(
  targetProfileId: string,
  currentBundles: ProcessBundleItem[]
): { nextBundles: ProcessBundleItem[]; restoredCount: number } {
  if (!Array.isArray(currentBundles)) {
    return { nextBundles: [], restoredCount: 0 };
  }

  const store = loadOutletMemoryStore();
  const record = store[targetProfileId];

  // 场景 A: 存在历史记忆，自动恢复
  if (record && record.bundleOutlets && Object.keys(record.bundleOutlets).length > 0) {
    let restoredCount = 0;
    const nextBundles = currentBundles.map((b) => {
      const savedTarget = record.bundleOutlets[b.id];
      if (savedTarget) {
        restoredCount++;
        return {
          ...b,
          targetProxy: savedTarget,
        };
      }
      return {
        ...b,
        targetProxy: "Proxy",
      };
    });
    console.log(`[profileOutletMemoryService] 订阅源 [${targetProfileId}] 已自动恢复 ${restoredCount} 个业务包出口`);
    return { nextBundles, restoredCount };
  }

  // 场景 B: 无历史记忆 (新订阅源)，清空专属节点出口，重置为默认 Proxy
  const nextBundles = currentBundles.map((b) => ({
    ...b,
    targetProxy: "Proxy",
  }));
  console.log(`[profileOutletMemoryService] 订阅源 [${targetProfileId}] 无历史出口记忆，已清空专属节点绑定`);
  return { nextBundles, restoredCount: 0 };
}

/**
 * 3. 删除订阅源时: 级联物理销毁该订阅源的所有出口记忆
 */
export function removeProfileOutlets(deletedProfileId: string): void {
  if (!deletedProfileId) return;
  const store = loadOutletMemoryStore();
  if (store[deletedProfileId]) {
    delete store[deletedProfileId];
    saveOutletMemoryStore(store);
    console.log(`[profileOutletMemoryService] 已物理销毁已删除订阅源 [${deletedProfileId}] 的出口记忆归档`);
  }
}
