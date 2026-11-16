// ==========================================================================
// ProcWeaver src-next 业务规则包与进程分流模型
// ==========================================================================

export interface BundleSummary {
  activeCount: number;
  totalCount: number;
  processCount: number;
  isProcessMasterOn: boolean;
}
