// ==========================================================================
// ProcWeaver src-next 核心运维与离线数据库服务
// 对接指令: get_mihomo_core_detail, get_geo_config, save_geo_config,
//           sync_geo_resource, sync_all_geo_resources
// ==========================================================================

import { version as appVersion } from "../../package.json";
import { invokeCommand, isTauriEnvironment } from "./client";
import {
  MihomoCoreDetail,
  GeoConfig,
  GeoResource,
  AppUpdateInfo,
  MihomoReleaseInfo,
} from "../types/maintenance";

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<AppUpdateInfo>("check_app_update");
    } catch (e) {
      console.warn("[maintenanceService] check_app_update failed:", e);
      throw e;
    }
  }
  // 浏览器开发预览模拟数据
  await new Promise((r) => setTimeout(r, 700));
  return {
    currentVersion: `v${appVersion}`,
    latestVersion: `v${appVersion}`,
    hasUpdate: false,
    releaseName: "",
    releaseNotes: "",
    publishedAt: "",
    assetSizeBytes: 0,
    assetSizeFormatted: "",
    htmlUrl: "https://github.com/jojhaa/ProcWeaver/releases",
    repoUrl: "https://github.com/jojhaa/ProcWeaver",
  };
}

export async function downloadAppUpdate(
  downloadUrl: string,
  fileName: string
): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<string>("download_app_update", {
        downloadUrl,
        fileName,
      });
    } catch (e) {
      console.warn("[maintenanceService] download_app_update failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));
  return `C:\\Users\\Example\\.update_cache\\${fileName}`;
}

export async function installAppUpdate(archivePath: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<boolean>("install_app_update", {
        archivePath,
      });
    } catch (e) {
      console.warn("[maintenanceService] install_app_update failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  return true;
}

export async function restartApp(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<boolean>("restart_app");
    } catch (e) {
      console.warn("[maintenanceService] restart_app failed:", e);
      throw e;
    }
  }
  return true;
}

export async function checkMihomoUpdate(): Promise<MihomoReleaseInfo> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<MihomoReleaseInfo>("check_mihomo_update");
    } catch (e) {
      console.warn("[maintenanceService] check_mihomo_update failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  return {
    latestVersion: "v1.19.2",
    releaseName: "Mihomo Meta v1.19.2 (Stable)",
    publishedAt: "2026-10-25T08:00:00Z",
    downloadUrl:
      "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.2/mihomo-windows-amd64-compatible-v1.19.2.zip",
    assetName: "mihomo-windows-amd64-compatible-v1.19.2.zip",
    assetSizeBytes: 14680064,
    assetSizeFormatted: "14.0 MB",
    htmlUrl: "https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.2",
  };
}

const DEFAULT_GEO_CONFIG: GeoConfig = {
  autoUpdate: true,
  updateIntervalHours: 168,
  lastCheckedAt: null,
  lastError: null,
  resources: [
    {
      id: "mmdb",
      name: "MMDB (全球 IP 归属库)",
      fileName: "geoip.metadb",
      url: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb",
      fileSizeBytes: 8912896,
      fileSizeFormatted: "8.50 MB",
      updatedAtRelative: "已就绪",
      updatedAt: "2026-11-01T00:00:00Z",
      exists: true,
    },
    {
      id: "asn",
      name: "ASN (自治系统网络库)",
      fileName: "GeoLite2-ASN.mmdb",
      url: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb",
      fileSizeBytes: 7340032,
      fileSizeFormatted: "7.00 MB",
      updatedAtRelative: "已就绪",
      updatedAt: "2026-11-01T00:00:00Z",
      exists: true,
    },
    {
      id: "geosite",
      name: "GeoSite (域名分流特征库)",
      fileName: "geosite.dat",
      url: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
      fileSizeBytes: 12582912,
      fileSizeFormatted: "12.00 MB",
      updatedAtRelative: "已就绪",
      updatedAt: "2026-11-01T00:00:00Z",
      exists: true,
    },
  ],
};

const DEFAULT_CORE_DETAIL: MihomoCoreDetail = {
  activeCoreMode: "standard",
  activeCorePath: "resources/binaries/mihomo.exe",
  coreVersionRaw: "Mihomo Meta v1.19.2 windows amd64 with go1.22.5",
  coreVersionTag: "v1.19.2",
  cpuArch: "x86_64",
  avx2Supported: true,
  recommendedCore: "standard",
  isRunning: true,
  pid: 14280,
  mixedPort: 7890,
  controllerPort: 9090,
  startedAt: Math.floor(Date.now() / 1000) - 3600,
};

export async function getMihomoCoreDetail({ strict = false }: { strict?: boolean } = {}): Promise<MihomoCoreDetail> {
  if (isTauriEnvironment()) {
    try {
      const data = await invokeCommand<MihomoCoreDetail>("get_mihomo_core_detail");
      if (data) return data;
      if (strict) throw new Error("核心状态不可用");
    } catch (e) {
      if (strict) throw e;
      console.warn("[maintenanceService] get_mihomo_core_detail failed:", e);
    }
  }
  return { ...DEFAULT_CORE_DETAIL };
}

export async function getGeoConfig({ strict = false }: { strict?: boolean } = {}): Promise<GeoConfig> {
  if (isTauriEnvironment()) {
    try {
      const data = await invokeCommand<GeoConfig>("get_geo_config");
      if (data) return data;
      if (strict) throw new Error("数据库列表不可用");
    } catch (e) {
      if (strict) throw e;
      console.warn("[maintenanceService] get_geo_config failed:", e);
    }
  }
  return { ...DEFAULT_GEO_CONFIG };
}

export async function saveGeoConfig(config: GeoConfig): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<boolean>("save_geo_config", { config });
    } catch (e) {
      console.warn("[maintenanceService] save_geo_config failed:", e);
      throw e;
    }
  }
  return true;
}

export async function syncGeoResource(id: string): Promise<GeoResource> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<GeoResource>("sync_geo_resource", { id });
    } catch (e) {
      console.warn(`[maintenanceService] sync_geo_resource(${id}) failed:`, e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  const res = DEFAULT_GEO_CONFIG.resources.find((r) => r.id === id);
  if (!res) throw new Error("未知 Geo 资源");
  return { ...res, updatedAtRelative: "刚刚更新" };
}

export async function syncAllGeoResources(): Promise<GeoConfig> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<GeoConfig>("sync_all_geo_resources");
    } catch (e) {
      console.warn("[maintenanceService] sync_all_geo_resources failed:", e);
      throw e;
    }
  }
  await new Promise((r) => setTimeout(r, 900));
  return {
    ...DEFAULT_GEO_CONFIG,
    lastCheckedAt: new Date().toISOString(),
    resources: DEFAULT_GEO_CONFIG.resources.map((r) => ({
      ...r,
      updatedAtRelative: "刚刚更新",
    })),
  };
}
