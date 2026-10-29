import { isTauri, toggleDnsGuard, getDnsGuardInfo, type DnsGuardInfo } from "../api";
import { getGeneralSettings } from "../api/settings";
import { getPlatform } from "./platform";

let userDismissed = false;
let syncing = false;

export function dismissBundleDnsGuard(): void {
  userDismissed = true;
}

export function resetBundleDnsGuardDismissal(): void {
  userDismissed = false;
}

export function isBundleDnsGuardDismissed(): boolean {
  return userDismissed;
}

/**
 * 业务规则包与 DNS 护航智能联动同步机制 (A+B 结合)
 * @param hasActiveBundle 当前是否有已开启且绑定了主出口的核心业务包
 * @param isRunning Mihomo 核心是否正在运行
 */
export async function syncBundleDnsGuard(
  hasActiveBundle: boolean,
  isRunning: boolean
): Promise<{ changed: boolean; info: DnsGuardInfo }> {
  const currentPlatform = getPlatform();
  if (!isTauri() || currentPlatform.os !== "windows" || !currentPlatform.dnsGuard) {
    const fallback: DnsGuardInfo = { enabled: false, origin: "none", windivertMode: false };
    return { changed: false, info: fallback };
  }

  // 保留用户显式忽略/关闭意图；业务包状态变化不擅自覆盖用户的手动关闭决定

  if (syncing) {
    const current = await getDnsGuardInfo().catch(() => ({ enabled: false, origin: "none" as const, windivertMode: false }));
    return { changed: false, info: current };
  }

  try {
    syncing = true;
    const settings = await getGeneralSettings().catch(() => null);
    if (settings && settings.autoDnsGuardWithBundle === false) {
      const current = await getDnsGuardInfo();
      return { changed: false, info: current };
    }

    const current = await getDnsGuardInfo();

    // 情况 1: 业务包处于激活状态且核心正常运行
    if (hasActiveBundle && isRunning) {
      if (!current.enabled && !userDismissed) {
        await toggleDnsGuard(true, "bundle");
        const next = await getDnsGuardInfo();
        window.dispatchEvent(new CustomEvent("procweaver-dns-guard-changed"));
        return { changed: true, info: next };
      }
    }
    // 情况 2: 业务包均已停用或未绑定出口
    else if (!hasActiveBundle) {
      // 仅当当前护航是由业务包托管开启 (origin === "bundle") 时才自动休眠；
      // 若是用户手动开启 (origin === "manual") 则严格保持开启，捍卫用户主权！
      if (current.enabled && current.origin === "bundle") {
        await toggleDnsGuard(false, "bundle");
        const next = await getDnsGuardInfo();
        window.dispatchEvent(new CustomEvent("procweaver-dns-guard-changed"));
        return { changed: true, info: next };
      }
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
