import { isTauri, toggleDnsGuard, getDnsGuardInfo, type DnsGuardInfo } from "../api";
import { getPlatform } from "./platform";

let syncing = false;

/**
 * 兼容清理旧版业务自动创建的系统护航。业务解析不再启用全局护航。
 * @param hasActiveBundle 当前是否有已开启且绑定了主出口的核心业务包
 * @param isRunning Mihomo 核心是否正在运行
 */
export async function syncBundleDnsGuard(
  _hasActiveBundle: boolean,
  _isRunning: boolean
): Promise<{ changed: boolean; info: DnsGuardInfo }> {
  const currentPlatform = getPlatform();
  if (!isTauri() || currentPlatform.os !== "windows" || !currentPlatform.dnsGuard) {
    const fallback: DnsGuardInfo = { enabled: false, origin: "none", windivertMode: false };
    return { changed: false, info: fallback };
  }

  if (syncing) {
    const current = await getDnsGuardInfo().catch(() => ({ enabled: false, origin: "none" as const, windivertMode: false }));
    return { changed: false, info: current };
  }

  try {
    syncing = true;
    const current = await getDnsGuardInfo();
    if (current.enabled && current.origin === "bundle") {
      await toggleDnsGuard(false, "bundle");
      const next = await getDnsGuardInfo();
      window.dispatchEvent(new CustomEvent("procweaver-dns-guard-changed"));
      return { changed: !next.enabled, info: next };
    }

    return { changed: false, info: current };
  } catch (err) {
    console.warn("[BundleDnsGuard] 智能联动同步异常:", err);
    const fallback = await getDnsGuardInfo().catch(() => ({ enabled: false, origin: "none" as const, windivertMode: false }));
    return { changed: false, info: fallback };
  } finally {
    syncing = false;
  }
}
