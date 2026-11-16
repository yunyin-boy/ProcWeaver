// ==========================================================================
// ProcWeaver src-next 系统托盘全局同步看门狗服务
// 规范溯源: tauri-linear-raycast-ui / rust-pro
// 职责: 大盘状态与 Windows 原生托盘 Tooltip / 悬浮菜单双向实时打通
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";

export interface TrayNodeItem {
  name: string;
  delay?: number | null;
  active: boolean;
}

export interface TrayRegionGroup {
  region: string;
  nodes: TrayNodeItem[];
}

export interface TrayMenuPayload {
  running: boolean;
  mode: string;
  sysProxyEnabled: boolean;
  sysProxyState?: string;
  tunEnabled?: boolean;
  autoRun: boolean;
  processEnabled: boolean;
  activeNode?: string | null;
  activeNodeDelay?: number | null;
  downSpeed?: number;
  upSpeed?: number;
  groups: TrayRegionGroup[];
  direction?: string;
}

let currentPayloadState: TrayMenuPayload = {
  running: false,
  mode: "rule",
  sysProxyEnabled: false,
  sysProxyState: "unknown",
  tunEnabled: false,
  autoRun: false,
  processEnabled: true,
  activeNode: null,
  activeNodeDelay: null,
  downSpeed: 0,
  upSpeed: 0,
  groups: [],
  direction: "left",
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncedJson = "";

/**
 * 向 Rust 原生托盘下发大盘完整状态（带防抖，避免高频 IPC 阻塞）
 */
export function syncTrayMenu(partial: Partial<TrayMenuPayload>): void {
  if (!isTauriEnvironment()) return;

  currentPayloadState = {
    ...currentPayloadState,
    ...partial,
    // 保障 groups 内节点选中状态与 activeNode 绝对对齐
    groups: partial.groups
      ? partial.groups
      : currentPayloadState.groups.map((g) => ({
          ...g,
          nodes: g.nodes.map((n) => ({
            ...n,
            active: Boolean(currentPayloadState.activeNode) && n.name === currentPayloadState.activeNode,
          })),
        })),
  };

  if (syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(async () => {
    syncTimer = null;
    const json = JSON.stringify(currentPayloadState);
    if (json === lastSyncedJson) return;

    try {
      await invokeCommand("update_tray_menu", { payload: currentPayloadState });
      lastSyncedJson = json;
    } catch (err) {
      console.warn("[trayService] update_tray_menu IPC 告警:", err);
    }
  }, 120);
}

let trafficTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTraffic: { downSpeed: number; upSpeed: number } | null = null;

/**
 * 遥测速率向系统托盘同步（供 Windows 任务栏 Tooltip 与悬浮窗实时显示）
 */
export function syncTrayTraffic(downSpeed: number, upSpeed: number): void {
  if (!isTauriEnvironment()) return;

  currentPayloadState.downSpeed = downSpeed;
  currentPayloadState.upSpeed = upSpeed;
  pendingTraffic = { downSpeed, upSpeed };

  if (trafficTimer) return;

  trafficTimer = setTimeout(async () => {
    trafficTimer = null;
    if (!pendingTraffic) return;
    const snap = pendingTraffic;
    pendingTraffic = null;
    try {
      await invokeCommand("update_tray_traffic", snap);
    } catch {}
  }, 1000);
}

/**
 * 主动拉取底层真实状态并一次性完整刷新托盘
 */
export async function refreshTrayWatchdog(): Promise<void> {
  if (!isTauriEnvironment()) return;
  try {
    const raw = await invokeCommand<any>("get_tray_payload");
    if (raw && typeof raw === "object") {
      syncTrayMenu({
        running: Boolean(raw.running),
        mode: raw.mode || "rule",
        sysProxyEnabled: Boolean(raw.sysProxyEnabled ?? raw.sys_proxy_enabled),
        sysProxyState: raw.sysProxyState ?? raw.sys_proxy_state ?? "unknown",
        tunEnabled: Boolean(raw.tunEnabled ?? raw.tun_enabled),
        autoRun: Boolean(raw.autoRun ?? raw.auto_run),
        processEnabled: Boolean(raw.processEnabled ?? raw.process_enabled ?? true),
        activeNode: raw.activeNode ?? raw.active_node ?? null,
        activeNodeDelay: raw.activeNodeDelay ?? raw.active_node_delay ?? null,
        groups: Array.isArray(raw.groups) ? raw.groups : currentPayloadState.groups,
      });
    }
  } catch (err) {
    console.warn("[trayService] refreshTrayWatchdog 异常:", err);
  }
}
