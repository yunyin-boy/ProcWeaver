// ==========================================================================
// ProcWeaver src-next 核心服务契约
// 对接指令: get_core_status, start_core, stop_core, restart_core, get_cpu_info, set_mihomo_mode, get_public_routing_mode, get_mihomo_proxies
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { CoreStatusSnapshot, CpuInfo, CoreArchitecture, EngineMode } from "../types/core";
import { calcActiveRoutedProcessCount } from "./processRoutingService";

// 纯浏览器预览用保真 Mock 数据
let mockRunning = true;
let mockMode: EngineMode = "rule";
let mockStartedAt = Date.now() - 3840 * 1000;

export interface ActiveNodeInfo {
  name: string;
  type: string;
  delay?: number;
}

export async function getCoreStatus(): Promise<CoreStatusSnapshot> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invokeCommand<any>("get_core_status");
      const running = Boolean(raw?.running);
      const mixedPort = raw?.mixedPort || 7890;
      let mode: EngineMode = "rule";
      let processCount = 0;

      // 1. 优先读取公共分流模式（精准获取当前生效与持久化的 public_mode）
      try {
        const pubMode = await invokeCommand<any>("get_public_routing_mode");
        if (pubMode?.mode) {
          const m = String(pubMode.mode).toLowerCase();
          if (m === "global" || m === "direct" || m === "rule") {
            mode = m as EngineMode;
          }
        }
      } catch {
        // 2. 若公共模式命令调用异常，尝试从通用首选项读取持久化 runMode
        try {
          const general = await invokeCommand<any>("get_general_settings");
          if (general?.runMode) {
            const m = String(general.runMode).toLowerCase();
            if (m === "global" || m === "direct" || m === "rule") {
              mode = m as EngineMode;
            }
          }
        } catch {}
      }

      if (running) {
        try {
          const overrides = await invokeCommand<any>("get_routing_overrides");
          if (overrides) {
            processCount = calcActiveRoutedProcessCount(overrides);
          }
        } catch {}
      }

      const uptimeSeconds = raw?.startedAt
        ? Math.max(0, Math.floor((Date.now() - raw.startedAt) / 1000))
        : 0;

      const systemProxyEnabled = Boolean(
        raw?.systemProxyEnabled ??
        raw?.system_proxy_enabled ??
        raw?.systemProxy?.enabled ??
        raw?.system_proxy?.enabled
      );

      return {
        running,
        mixedPort,
        mode,
        coreMode: (raw?.activeCore?.includes("v3") ? "v3" : "compatible") as CoreArchitecture,
        processCount,
        activeProfile: "默认分流策略",
        uptimeSeconds,
        memoryUsageBytes: raw?.memoryUsageBytes ?? (running ? undefined : 0),
        systemProxyEnabled,
      };
    } catch (e) {
      console.warn("[coreService] getCoreStatus failed in Tauri:", e);
    }
  }

  return {
    running: mockRunning,
    mixedPort: 7890,
    mode: mockMode,
    coreMode: "v3",
    processCount: 14,
    activeProfile: "默认分流规则",
    uptimeSeconds: Math.floor((Date.now() - mockStartedAt) / 1000),
    memoryUsageBytes: 48627712, // 约 46.4 MB
    systemProxyEnabled: mockSystemProxy,
  };
}

export function formatMemoryBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-- MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export async function toggleCore(
  start: boolean,
  coreMode: CoreArchitecture = "auto"
): Promise<CoreStatusSnapshot> {
  if (isTauriEnvironment()) {
    if (start) {
      await invokeCommand<any>("start_core", {
        coreMode: coreMode === "auto" ? null : coreMode,
      });
    } else {
      await invokeCommand<any>("stop_core");
    }
    return getCoreStatus();
  }

  // 浏览器开发 Mock
  mockRunning = start;
  if (start) {
    mockStartedAt = Date.now();
  }
  return getCoreStatus();
}

export async function setEngineMode(mode: EngineMode): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<boolean>("set_mihomo_mode", { mode });
    } catch (e) {
      console.warn("[coreService] set_mihomo_mode failed:", e);
      throw e;
    }
  }
  mockMode = mode;
  return true;
}

export async function getActiveOutboundNode(): Promise<ActiveNodeInfo> {
  if (isTauriEnvironment()) {
    try {
      const data = await invokeCommand<any>("get_mihomo_proxies");
      const allProxies = data?.proxies || {};
      let activeName = "";

      // 优先从 PROXY / GLOBAL / 节点选择 策略组里读取当前激活出站
      for (const groupKey of ["PROXY", "GLOBAL", "Proxy", "节点选择"]) {
        if (allProxies[groupKey] && allProxies[groupKey].now) {
          activeName = allProxies[groupKey].now;
          break;
        }
      }

      if (!activeName) {
        // 如果没有特定名字的组，找第一个拥有 now 字段的 Selector
        for (const [_, val] of Object.entries<any>(allProxies)) {
          if (val.all && Array.isArray(val.all) && val.now) {
            activeName = val.now;
            break;
          }
        }
      }

      if (activeName && allProxies[activeName]) {
        const p = allProxies[activeName];
        const delay = p.history?.length ? p.history[p.history.length - 1].delay : undefined;
        return {
          name: activeName,
          type: p.type || "Proxy",
          delay,
        };
      }
    } catch (e) {
      console.warn("[coreService] getActiveOutboundNode failed:", e);
    }
  }

  return {
    name: "香港 01 | 极速专线 [BGP]",
    type: "Hysteria2",
    delay: 24,
  };
}

export async function getCpuInfo(): Promise<CpuInfo> {
  if (isTauriEnvironment()) {
    return invokeCommand<CpuInfo>("get_cpu_info");
  }
  return {
    arch: "x86_64",
    avx2Supported: true,
    recommendedCore: "v3",
  };
}

let mockSystemProxy = false;

export async function toggleSystemProxy(enable: boolean, port?: number): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const targetPort = port && port > 0 ? port : null;
      return await invokeCommand<boolean>("set_system_proxy", { enable, port: targetPort });
    } catch (e) {
      console.warn("[coreService] set_system_proxy failed:", e);
      throw e;
    }
  }
  mockSystemProxy = enable;
  return enable;
}

