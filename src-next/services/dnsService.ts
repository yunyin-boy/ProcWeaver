// ==========================================================================
// ProcWeaver src-next DNS 智能护航与本地引擎服务
// 对接指令: get_dns_settings, save_dns_settings, get_dns_guard_info, toggle_dns_guard,
//           get_dns_listener_status, restart_core, run_network_emergency_repair
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import {
  DnsGuardInfo,
  DnsListenerStatus,
  DnsSettings,
  DEFAULT_DNS_SETTINGS,
} from "../types/dns";

const DNS_STORAGE_KEY = "procweaver_dns_settings";

export async function getDnsSettings(): Promise<DnsSettings> {
  if (isTauriEnvironment()) {
    try {
      const data = await invokeCommand<DnsSettings>("get_dns_settings");
      if (data) return data;
    } catch (e) {
      console.warn("[dnsService] get_dns_settings failed:", e);
    }
  }

  // 浏览器仿真回退
  try {
    const cached = localStorage.getItem(DNS_STORAGE_KEY);
    if (cached) {
      return { ...DEFAULT_DNS_SETTINGS, ...JSON.parse(cached) };
    }
  } catch {}
  return { ...DEFAULT_DNS_SETTINGS };
}

export async function saveDnsSettings(settings: DnsSettings): Promise<DnsSettings> {
  if (isTauriEnvironment()) {
    try {
      const saved = await invokeCommand<DnsSettings>("save_dns_settings", { settings });
      return saved;
    } catch (e) {
      console.warn("[dnsService] save_dns_settings failed:", e);
      throw e;
    }
  }

  // 浏览器仿真持久化
  try {
    localStorage.setItem(DNS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
  return settings;
}

export async function getDnsGuardInfo(): Promise<DnsGuardInfo> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invokeCommand<any>("get_dns_guard_info");
      return {
        enabled: Boolean(raw?.enabled),
        fakeIpCount: raw?.windivert_mode ? 2048 : undefined,
      };
    } catch (e) {
      console.warn("[dnsService] get_dns_guard_info failed:", e);
    }
  }
  return {
    enabled: true,
    fakeIpCount: 1420,
    hijackedDomains: 382,
  };
}

export async function getDnsListenerStatus(): Promise<DnsListenerStatus> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invokeCommand<any>("get_dns_listener_status");
      return {
        listen: raw?.listen || "127.0.0.1:53",
        running: Boolean(raw?.running),
      };
    } catch (e) {
      console.warn("[dnsService] get_dns_listener_status failed:", e);
    }
  }
  return {
    listen: "127.0.0.1:53",
    running: true,
  };
}

export async function flushDns(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invokeCommand<string>("run_network_emergency_repair");
      return;
    } catch (e) {
      console.warn("[dnsService] flushDns/emergency repair failed:", e);
      throw e;
    }
  }
  return new Promise((r) => setTimeout(r, 400));
}

export async function reloadCoreConfig(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invokeCommand("restart_core");
      return;
    } catch (e) {
      console.warn("[dnsService] reloadCoreConfig/restart_core failed:", e);
      throw e;
    }
  }
  return new Promise((r) => setTimeout(r, 400));
}
