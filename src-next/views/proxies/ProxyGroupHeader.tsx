import React from "react";
import { ChevronDown, ShieldCheck, Zap } from "lucide-react";
import { ProxyGroupItem } from "../../types/proxy";

interface ProxyGroupHeaderProps {
  group: ProxyGroupItem;
  nodeCount: number;
  isCollapsed: boolean;
  isTestingGroup: boolean;
  isTestingGroupHealth?: boolean;
  onToggleCollapse: () => void;
  onTestGroup: (e: React.MouseEvent) => void;
  onTestGroupHealth?: (e: React.MouseEvent) => void;
}

export const ProxyGroupHeader: React.FC<ProxyGroupHeaderProps> = ({
  group,
  nodeCount,
  isCollapsed,
  isTestingGroup,
  isTestingGroupHealth = false,
  onToggleCollapse,
  onTestGroup,
  onTestGroupHealth,
}) => {
  const typeLabels: Record<string, string> = {
    urltest: "自动优选",
    fallback: "故障转移",
    loadbalance: "负载均衡",
  };
  const typeLabel = typeLabels[group.type.toLowerCase()] ?? "手动选择";

  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-md p-1 text-left hover:text-[var(--workbench-accent)]"
        aria-expanded={!isCollapsed}
      >
        <ChevronDown size={15} className={isCollapsed ? "-rotate-90" : ""} aria-hidden="true" />
        <span className="workbench-panel-title break-all">{group.name}</span>
        <span className="workbench-tag">{typeLabel}</span>
        <span className="tabular-nums text-xs text-[var(--text-muted)]">{nodeCount}</span>
        {isCollapsed && group.now && (
          <span className="workbench-tag workbench-tag-accent min-w-0 max-w-[200px]">
            <span className="truncate">当前 {group.now}</span>
          </span>
        )}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        {onTestGroupHealth && (
          <button type="button" onClick={onTestGroupHealth} disabled={isTestingGroupHealth} className="workbench-action">
            <ShieldCheck size={14} aria-hidden="true" /> {isTestingGroupHealth ? "体检中…" : "组测健康"}
          </button>
        )}
        <button type="button" onClick={onTestGroup} disabled={isTestingGroup} className="workbench-action">
          <Zap size={14} aria-hidden="true" /> {isTestingGroup ? "测速中…" : "组测速"}
        </button>
      </div>
    </header>
  );
};
