// ==========================================================================
// ProcWeaver src-next 订阅源与配置领域类型定义
// ==========================================================================

export interface ProfileItem {
  id: string;
  name: string;
  url: string;
  filePath: string;
  updatedAt: string;
  nodeCount: number;
  isSelected: boolean;
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
  autoUpdateInterval?: number;
  lastUpdatedAtSeconds?: number;
}

export interface AddProfileParams {
  name: string;
  url: string;
  autoUpdateInterval?: number;
}

export interface ImportProfileParams {
  name: string;
  content: string;
}
