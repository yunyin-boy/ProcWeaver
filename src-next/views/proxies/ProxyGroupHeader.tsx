import React from "react";
import { ChevronDown, ShieldCheck, Zap } from "lucide-react";
import { ProxyGroupItem } from "../../types/proxy";
import { strategyLabel } from "./PolicyMemberCard";

interface ProxyGroupHeaderProps {
  group: ProxyGroupItem;
  displayName: string;
  nodeCount: number;
  isCollapsed: boolean;
  isTestingGroup: boolean;
  isTestingGroupHealth?: boolean;
  currentLabel?: string;
  custom?: boolean;
  automaticCount?: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleCollapse: () => void;
  onTestGroup: (e: React.MouseEvent) => void;
  onTestGroupHealth?: (e: React.MouseEvent) => void;
}

export const ProxyGroupHeader: React.FC<ProxyGroupHeaderProps> = ({
  group,
  displayName,
  nodeCount,
  isCollapsed,
  isTestingGroup,
  isTestingGroupHealth = false,
  currentLabel,
  custom,
  automaticCount,
  onEdit,
  onDelete,
  onToggleCollapse,
  onTestGroup,
  onTestGroupHealth,
}) => {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-md p-1 text-left hover:text-[var(--workbench-accent)]"
        aria-expanded={!isCollapsed}
      >
        <ChevronDown size={15} className={isCollapsed ? "-rotate-90" : ""} aria-hidden="true" />
        <span className="workbench-panel-title break-all">{displayName}</span>
        {custom && <span className="workbench-tag workbench-tag-accent">自建</span>}
        {automaticCount !== undefined && <span className="workbench-tag">自动加入 {automaticCount} 个</span>}
        <span className="workbench-tag">{strategyLabel(group.type)}</span>
        <span className="tabular-nums text-xs text-[var(--text-muted)]">{nodeCount}</span>
        {currentLabel && (
          <span className="workbench-tag min-w-0 max-w-[360px]" title={currentLabel}>
            <span className="truncate">{currentLabel}</span>
          </span>
        )}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        {onEdit && <button type="button" className="workbench-action workbench-action-ghost" onClick={onEdit}>编辑组</button>}
        {onDelete && <button type="button" className="workbench-action workbench-action-ghost" onClick={onDelete}>删除组</button>}
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
