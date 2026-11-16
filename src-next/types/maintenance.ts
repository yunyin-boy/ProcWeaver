// ==========================================================================
// ProcWeaver src-next 核心运维与离线数据库模型
// 映射自后端 (src-tauri/src/commands/maintenance.rs & geo.rs)
// ==========================================================================

export interface MihomoCoreDetail {
  activeCoreMode: string;
  activeCorePath?: string | null;
  coreVersionRaw: string;
  coreVersionTag: string;
  cpuArch: string;
  avx2Supported: boolean;
  recommendedCore: string;
  isRunning: boolean;
  pid?: number | null;
  mixedPort: number;
  controllerPort: number;
  startedAt?: number | null;
}

export interface GeoResource {
  id: string;
  name: string;
  fileName: string;
  url: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  updatedAtRelative: string;
  updatedAt?: string | null;
  exists: boolean;
}

export interface GeoConfig {
  autoUpdate: boolean;
  updateIntervalHours: number;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  resources: GeoResource[];
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl?: string | null;
  assetName?: string | null;
  assetSizeBytes: number;
  assetSizeFormatted: string;
  htmlUrl: string;
  repoUrl: string;
}

export interface MihomoReleaseInfo {
  latestVersion: string;
  releaseName: string;
  publishedAt: string;
  downloadUrl?: string | null;
  assetName?: string | null;
  assetSizeBytes: number;
  assetSizeFormatted: string;
  htmlUrl: string;
}
