// ==========================================================================
// ProcWeaver src-next 通用首选项与排除名单服务
// 对接指令: get_general_settings, patch_general_settings, get_exclusions, save_exclusions, export_config_snapshot, restore_config_snapshot
// ==========================================================================

import { version as appVersion } from "../../package.json";
import type { Exclusions } from "../../src/api/mihomo";
import { invokeCommand, isTauriEnvironment } from "./client";
import { GeneralSettings, DEFAULT_GENERAL_SETTINGS } from "../types/settings";

const STORAGE_KEY = "procweaver_general_settings";

function readBrowserSettings(): GeneralSettings {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      return { ...DEFAULT_GENERAL_SETTINGS, ...JSON.parse(cached) };
    }
  } catch {}
  return { ...DEFAULT_GENERAL_SETTINGS };
}

export async function getBypassList(): Promise<string[]> {
  const config = await invokeCommand<Exclusions>("get_exclusions", undefined, () => ({
    enabled: true,
    entries: readBrowserSettings().bypassList,
  }));
  if (!Array.isArray(config?.entries) || !config.entries.every((entry) => typeof entry === "string")) {
    throw new Error("排除名单内容无效");
  }
  return config.entries;
}

export async function saveBypassList(entries: string[]): Promise<string[]> {
  const config = { enabled: true, entries };
  const saved = await invokeCommand<Exclusions>("save_exclusions", { config }, () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readBrowserSettings(), bypassList: entries }));
    return config;
  });
  return saved.entries;
}

export async function getGeneralSettings({ strict = false }: { strict?: boolean } = {}): Promise<GeneralSettings> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invokeCommand<any>("get_general_settings");
      if (strict && (!raw || typeof raw !== "object")) throw new Error("设置数据不可用");
      let bypassList: string[] = DEFAULT_GENERAL_SETTINGS.bypassList || [];
      try {
        bypassList = await getBypassList();
      } catch (e) {
        console.warn("[settingsService] get_exclusions fallback:", e);
      }

      return {
        mixedPort: raw?.mixedPort ?? DEFAULT_GENERAL_SETTINGS.mixedPort,
        controllerPort: raw?.controllerPort ?? DEFAULT_GENERAL_SETTINGS.controllerPort,
        enableControllerPort: raw?.enableControllerPort ?? DEFAULT_GENERAL_SETTINGS.enableControllerPort,
        allowLan: Boolean(raw?.allowLan),
        tunMode: Boolean(raw?.tunMode || raw?.trafficMode === "tun"),
        autoStart: Boolean(raw?.autoStart),
        unifiedDelay: raw?.unifiedDelay ?? DEFAULT_GENERAL_SETTINGS.unifiedDelay,
        tcpConcurrent: Boolean(raw?.tcpConcurrent),
        geoLowMemory: raw?.geoLowMemory ?? DEFAULT_GENERAL_SETTINGS.geoLowMemory,
        minimizeOnClose: raw?.minimizeOnClose ?? DEFAULT_GENERAL_SETTINGS.minimizeOnClose,
        closeAction: raw?.closeAction || (raw?.minimizeOnClose ? "minimize" : "ask"),
        silentStart: Boolean(raw?.silentStart),
        autoRun: raw?.autoRun ?? DEFAULT_GENERAL_SETTINGS.autoRun,
        autoStartProcessRouting: Boolean(raw?.autoStartProcessRouting),
        onlyProxyTraffic: raw?.onlyProxyTraffic ?? DEFAULT_GENERAL_SETTINGS.onlyProxyTraffic,
        trafficMode: raw?.trafficMode || (raw?.tunMode ? "tun" : "app_proxy"),
        routingPriority: raw?.routingPriority || "domain_first",
        speedTestUrl: raw?.speedTestUrl || DEFAULT_GENERAL_SETTINGS.speedTestUrl,
        speedTestConcurrency: raw?.speedTestConcurrency ?? DEFAULT_GENERAL_SETTINGS.speedTestConcurrency,
        healthProbeConcurrency: raw?.healthProbeConcurrency ?? DEFAULT_GENERAL_SETTINGS.healthProbeConcurrency,
        ipv6: Boolean(raw?.ipv6),
        findProcessMode: raw?.findProcessMode || DEFAULT_GENERAL_SETTINGS.findProcessMode,
        autoCloseConnections: raw?.autoCloseConnections ?? DEFAULT_GENERAL_SETTINGS.autoCloseConnections,
        appendSystemDns: Boolean(raw?.appendSystemDns),
        logCapture: raw?.logCapture ?? DEFAULT_GENERAL_SETTINGS.logCapture,
        tabAnimation: raw?.tabAnimation ?? DEFAULT_GENERAL_SETTINGS.tabAnimation,
        trayMenuStyle: raw?.trayMenuStyle || "modern",
        autoDnsGuardWithBundle: raw?.autoDnsGuardWithBundle ?? DEFAULT_GENERAL_SETTINGS.autoDnsGuardWithBundle,
        shimMode: raw?.shimMode || "disabled",
        runMode: raw?.runMode || "rule",
        bypassList,
      };
    } catch (e) {
      if (strict) throw e;
      console.warn("[settingsService] get_general_settings failed:", e);
    }
  }

  return readBrowserSettings();
}

export type GeneralSettingsPatch = Partial<Omit<GeneralSettings, "bypassList">>;

export async function saveGeneralSettings(patch: GeneralSettingsPatch): Promise<Omit<GeneralSettings, "bypassList">> {
  return invokeCommand("patch_general_settings", { patch }, () => {
    const updated = { ...readBrowserSettings(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  });
}

export interface LanAccessStatus {
  configured: boolean;
  running: boolean;
  effective: boolean | null;
}

export async function getLanAccessStatus(previewRunning: boolean): Promise<LanAccessStatus> {
  return invokeCommand("get_lan_access_status", undefined, () => {
    const configured = readBrowserSettings().allowLan;
    return { configured, running: previewRunning, effective: previewRunning ? configured : null };
  });
}

export interface TunStatus {
  supported: boolean;
  configured: boolean;
  running: boolean;
  effective: boolean | null;
  autoRoute: boolean | null;
  detail: string | null;
  configuredMode: GeneralSettings["trafficMode"];
  activeMode: GeneralSettings["trafficMode"] | null;
}

export function getTunStatus(previewRunning: boolean): Promise<TunStatus> {
  return invokeCommand("get_tun_status", undefined, () => {
    const { trafficMode: configuredMode } = readBrowserSettings();
    const configured = configuredMode === "tun";
    return {
      supported: true, configured, running: previewRunning,
      effective: previewRunning ? configured : null, autoRoute: true, detail: null,
      configuredMode, activeMode: previewRunning ? configuredMode : null,
    };
  });
}

export function setTunEnabled(enabled: boolean): Promise<Omit<GeneralSettings, "bypassList">> {
  return invokeCommand("set_tun_enabled", { enabled }, () => {
    const previous = readBrowserSettings() as GeneralSettings & {
      tunResumeMode?: Exclude<GeneralSettings["trafficMode"], "tun">;
    };
    if (!enabled && previous.trafficMode !== "tun") return previous;
    const resume = previous.trafficMode === "tun" ? previous.tunResumeMode : previous.trafficMode;
    const saved = {
      ...previous, tunMode: enabled,
      trafficMode: enabled ? "tun" as const : resume ?? "app_proxy",
      tunResumeMode: enabled ? resume : undefined,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return saved;
  });
}

// 导出全量配置快照
export async function exportConfigSnapshot(): Promise<string> {
  const browserState: Record<string, string> = {};
  try {
    const bundlesInstance = localStorage.getItem("netbox_business_bundles_instances_v1");
    if (bundlesInstance) {
      browserState["netbox_business_bundles_instances_v1"] = bundlesInstance;
    }
  } catch {}

  if (isTauriEnvironment()) {
    const snapshot = await invokeCommand<any>("export_config_snapshot", { browserState });
    return JSON.stringify(snapshot, null, 2);
  }

  // 浏览器仿真快照
  const mockSnapshot = {
    schemaVersion: 1,
    appVersion,
    platform: "windows",
    createdAt: Math.floor(Date.now() / 1000),
    files: {
      "config/preferences.json": JSON.stringify(await getGeneralSettings(), null, 2),
    },
    browserState,
  };
  return JSON.stringify(mockSnapshot, null, 2);
}

// 恢复全量配置快照
export async function restoreConfigSnapshot(snapshotJson: string): Promise<void> {
  const parsed = JSON.parse(snapshotJson);
  if (isTauriEnvironment()) {
    await invokeCommand("restore_config_snapshot", { snapshot: parsed });
    return;
  }
  // 浏览器仿真恢复
  if (parsed.browserState) {
    for (const [k, v] of Object.entries(parsed.browserState)) {
      try {
        localStorage.setItem(k, v as string);
      } catch {}
    }
  }
}

// 清理 WinDivert 内核驱动服务残留与解压组件
export async function cleanWindivertResidualService(): Promise<string> {
  if (isTauriEnvironment()) {
    return await invokeCommand<string>("clean_windivert_residual_service");
  }
  return "仿真环境：WinDivert 驱动服务与临时组件已清理";
}

