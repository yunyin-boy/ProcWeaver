// ==========================================================================
// ProcWeaver src-next 实时遥测与数据流模型
// 规范溯源: rust-pro (Tokio Stream) / typography-dark-mono-optics
// ==========================================================================

export interface BandwidthSnapshot {
  uploadRateBytes: number;
  downloadRateBytes: number;
  uploadTotalBytes: number;
  downloadTotalBytes: number;
}

export interface LatencyRecord {
  proxyName: string;
  delayMs: number;
  testedAt: number;
}
