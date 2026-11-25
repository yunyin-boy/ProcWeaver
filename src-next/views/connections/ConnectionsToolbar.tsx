import React from "react";
import { RefreshCw, Search, Trash2, Unplug, X } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { CustomSelect } from "../../primitives/CustomSelect";
import { formatBytes, formatSpeed } from "../../services/connectionsService";
import type {
  ConnectionProtocolFilter,
  ConnectionSortField,
  ConnectionsSnapshot,
  ConnectionViewMode,
} from "../../types/connections";

const protocols = [
  { value: "all", label: "全部" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
] as const;

const sorts = {
  active: [
    { value: "downSpeed", label: "按下载速率" },
    { value: "upSpeed", label: "按上传速率" },
    { value: "download", label: "按下载量" },
    { value: "upload", label: "按上传量" },
    { value: "time", label: "按连接时长" },
  ],
  history: [
    { value: "time", label: "按断开时间" },
    { value: "download", label: "按下载量" },
    { value: "upload", label: "按上传量" },
  ],
};

interface ConnectionsToolbarProps {
  viewMode: ConnectionViewMode;
  onViewModeChange: (mode: ConnectionViewMode) => void;
  snapshot?: ConnectionsSnapshot;
  historyCount: number;
  isPreview: boolean;
  isAutoRefresh: boolean;
  onAutoRefreshChange: (checked: boolean) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  hasPendingDisconnect: boolean;
  canDisconnectAll: boolean;
  onDisconnectAll: () => void;
  onClearHistory: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  protocol: ConnectionProtocolFilter;
  onProtocolChange: (protocol: ConnectionProtocolFilter) => void;
  sortField: ConnectionSortField;
  onSortChange: (field: ConnectionSortField) => void;
}

export const ConnectionsToolbar: React.FC<ConnectionsToolbarProps> = ({
  viewMode,
  onViewModeChange,
  snapshot,
  historyCount,
  isPreview,
  isAutoRefresh,
  onAutoRefreshChange,
  isRefreshing,
  onRefresh,
  hasPendingDisconnect,
  canDisconnectAll,
  onDisconnectAll,
  onClearHistory,
  query,
  onQueryChange,
  protocol,
  onProtocolChange,
  sortField,
  onSortChange,
}) => {
  const tabs = [
    { id: "active", label: "活跃连接", count: snapshot?.connections.length },
    { id: "history", label: "历史连接", count: historyCount },
  ] as const;
  const metrics = [
    { label: "下行速率", value: formatSpeed(snapshot?.downloadSpeed) },
    { label: "上行速率", value: formatSpeed(snapshot?.uploadSpeed) },
    { label: "累计下载", value: snapshot ? formatBytes(snapshot.downloadTotal) : "—" },
    { label: "累计上传", value: snapshot ? formatBytes(snapshot.uploadTotal) : "—" },
  ];

  return (
    <section className="workbench-panel grid min-w-0 gap-4 p-4" aria-label="连接追踪工具区">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="workbench-segments workbench-connection-segments flex-wrap" role="group" aria-label="连接视图">
          {tabs.map((tab) => (
            <button type="button" key={tab.id} aria-pressed={viewMode === tab.id} onClick={() => onViewModeChange(tab.id)}>
              <span>{tab.label}</span>
              <span className="text-[11px] tabular-nums">{tab.count?.toLocaleString() ?? "—"}</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isPreview && <span className="px-1 text-xs text-[var(--text-muted)]">模拟数据</span>}
          <div className="flex items-center gap-2 rounded-lg bg-[var(--workbench-control)] px-2 py-1.5">
            <span className="whitespace-nowrap text-xs text-[var(--text-secondary)]">{isAutoRefresh ? "自动刷新" : "已暂停刷新"}</span>
            <CapsuleToggle checked={isAutoRefresh} onChange={onAutoRefreshChange} title="自动刷新连接" />
          </div>
          <Button type="button" onClick={onRefresh} loading={isRefreshing} disabled={hasPendingDisconnect}>
            {!isRefreshing && <RefreshCw size={14} aria-hidden="true" />}
            刷新
          </Button>
          {viewMode === "active" ? (
            <Button type="button" variant="danger" onClick={onDisconnectAll} disabled={!canDisconnectAll}>
              <Unplug size={14} aria-hidden="true" />断开全部
            </Button>
          ) : (
            <Button type="button" onClick={onClearHistory} disabled={!historyCount}>
              <Trash2 size={14} aria-hidden="true" />清空历史
            </Button>
          )}
        </div>
      </div>

      <dl className="workbench-stat-grid tabular-nums" aria-label="核心流量">
        {metrics.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="workbench-connection-filters">
        <div className="workbench-field flex min-w-0 items-center gap-2 px-2.5">
          <Search size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索域名、IP、进程或出口"
            aria-label="搜索连接"
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px]"
          />
          {query && (
            <button type="button" className="workbench-title-button !min-h-6 !min-w-6" aria-label="清除搜索" onClick={() => onQueryChange("")}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="workbench-segments workbench-connection-segments self-center" role="group" aria-label="筛选协议">
          {protocols.map(({ value, label }) => (
            <button type="button" key={value} aria-pressed={protocol === value} onClick={() => onProtocolChange(value)}>{label}</button>
          ))}
        </div>
        <CustomSelect value={sortField} options={sorts[viewMode]} onChange={(value) => onSortChange(value as ConnectionSortField)} />
      </div>
    </section>
  );
};
