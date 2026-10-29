import { isTauri } from "./index";
import type { StaleTcpConnectionItem } from "../components/business-bundle/StaleConnectionsModal";

export interface ResetStaleResult {
  totalScanned: number;
  totalReset: number;
  failedCount: number;
  details: string[];
}

export async function inspectBundleStaleConnections(
  bundleId: string,
  processNames: string[],
  port: number
): Promise<StaleTcpConnectionItem[]> {
  if (!isTauri() || processNames.length === 0) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<StaleTcpConnectionItem[]>("inspect_bundle_stale_connections", {
      bundleId,
      processNames,
      port,
    });
  } catch (err) {
    console.warn("inspectBundleStaleConnections 失败:", err);
    return [];
  }
}

export async function resetBundleStaleConnections(
  connections: StaleTcpConnectionItem[]
): Promise<ResetStaleResult> {
  if (!isTauri() || connections.length === 0) {
    return { totalScanned: connections.length, totalReset: 0, failedCount: 0, details: [] };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ResetStaleResult>("reset_bundle_stale_connections", { connections });
  } catch (err) {
    console.error("resetBundleStaleConnections 失败:", err);
    return {
      totalScanned: connections.length,
      totalReset: 0,
      failedCount: connections.length,
      details: [String(err)],
    };
  }
}
