// ==========================================================================
// ProcWeaver src-next 业务规则包与进程分流概览服务
// 对接指令: get_business_bundles, get_routing_overrides
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { BundleSummary } from "../types/bundle";
import { calcActiveRoutedProcessCount } from "./processRoutingService";

export async function getBundleSummary(): Promise<BundleSummary> {
  if (isTauriEnvironment()) {
    try {
      let activeCount = 0;
      let totalCount = 0;
      let processCount = 0;
      let isProcessMasterOn = false;

      const overrides = await invokeCommand<any>("get_routing_overrides").catch(() => null);
      if (overrides) {
        const config = overrides.config;
        isProcessMasterOn = Boolean(config?.processEnabled || config?.bundlesEnabled);
        processCount = calcActiveRoutedProcessCount(overrides);
      }

      const bundles = await invokeCommand<any[]>("get_business_bundles").catch(() => []);
      if (Array.isArray(bundles) && bundles.length > 0) {
        totalCount = bundles.length;
        activeCount = bundles.filter((b) => b?.enabled !== false).length;
      } else if (overrides?.config?.bundles && Array.isArray(overrides.config.bundles)) {
        totalCount = overrides.config.bundles.length;
        activeCount = overrides.config.bundles.filter((b: any) => b?.enabled !== false).length;
      }

      return {
        activeCount,
        totalCount,
        processCount,
        isProcessMasterOn,
      };
    } catch (e) {
      console.warn("[bundleService] getBundleSummary failed, fallback:", e);
    }
  }

  // 纯前端开发模式 Mock
  return {
    activeCount: 6,
    totalCount: 6,
    processCount: 14,
    isProcessMasterOn: true,
  };
}
