// ==========================================================================
// ProcWeaver src-next 落地 IP 体检服务
// 规范溯源: rust-pro (解耦架构与防空指针安全设计)
// 对接指令: check_ip_health, wait_for_exit_connection
// 增强特性: Stale-While-Revalidate 平滑缓存降级，彻底杜绝网络微抖动导致的频发超时打扰
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { ExitIpHealthInfo } from "../types/exitHealth";

interface RustIpHealthInfo {
  source: string;
  ip: string;
  asn?: number;
  asOrganization?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  fraudScore?: number;
  isResidential?: boolean;
  firstPacketMs?: number;
}

const CACHE_STORAGE_KEY = "pw_cached_exit_health_snapshot";
let memoryCache: ExitIpHealthInfo | null = null;

function loadInitialCache(): ExitIpHealthInfo | null {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (raw) {
      memoryCache = JSON.parse(raw);
      return memoryCache;
    }
  } catch {}
  return null;
}

export function getCachedExitHealth(): ExitIpHealthInfo | null {
  return loadInitialCache();
}

export async function fetchExitIpHealth(proxyPort?: number): Promise<ExitIpHealthInfo> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invokeCommand<RustIpHealthInfo>("check_ip_health", {
        proxyPort: proxyPort || undefined,
      });

      const asnDesc = raw.asOrganization
        ? `AS${raw.asn ?? ""} (${raw.asOrganization})`
        : raw.asn
        ? `AS${raw.asn}`
        : "未知 ASN";

      const info: ExitIpHealthInfo = {
        ip: raw.ip || "127.0.0.1",
        country: raw.country || "未知位置",
        city: raw.city,
        asn: asnDesc,
        fraudScore: typeof raw.fraudScore === "number" ? raw.fraudScore : 0,
        isResidential: Boolean(raw.isResidential),
        firstPacketMs: raw.firstPacketMs,
        testedAt: Date.now(),
      };

      // 写入持久化快照
      memoryCache = info;
      try {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(info));
      } catch {}

      return info;
    } catch (err) {
      console.warn("[exitHealthService] check_ip_health failed in Tauri:", err);
      // 容灾平滑降级：若存在历史缓存快照，返回历史快照保证界面不空白、不崩溃
      const fallback = loadInitialCache() || {
        ip: "待检测",
        country: "本地/直连",
        asn: "正在建立出口网络",
        fraudScore: 0,
        isResidential: false,
        testedAt: Date.now(),
      };
      return fallback;
    }
  }

  // 纯前端开发环境 Mock 数据 (逼真的专线出站体检)
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ip: "104.28.192.88",
        country: "中国香港",
        city: "九龙",
        asn: "Cloudflare AS13335 (HKBN 专线出口)",
        fraudScore: 12,
        isResidential: true,
        firstPacketMs: 2.1,
        testedAt: Date.now(),
      });
    }, 450);
  });
}
