// ==========================================================================
// ProcWeaver src-next 核心运行时领域契约
// 规范溯源: rust-pro (强类型 IPC 契约)
// ==========================================================================

export type EngineMode = "rule" | "global" | "direct";

export type CoreArchitecture = "auto" | "v3" | "compatible" | "standard";

export interface CoreStatusSnapshot {
  running: boolean;
  mixedPort: number;
  controllerPort?: number;
  mode: EngineMode;
  coreMode: CoreArchitecture;
  processCount: number;
  activeProfile?: string;
  uptimeSeconds?: number;
  memoryUsageBytes?: number; // 核心物理常驻内存占用
  systemProxyEnabled?: boolean; // 系统代理开启状态
}

export interface CpuInfo {
  arch: string;
  avx2Supported: boolean;
  recommendedCore: string;
}

export interface CommandError {
  code:
    | "PORT_OCCUPIED"
    | "CORE_NOT_RUNNING"
    | "CORE_LAUNCH_FAILED"
    | "PERMISSION_DENIED"
    | "NOT_IN_TAURI"
    | "UNKNOWN_ERROR";
  message: string;
}
