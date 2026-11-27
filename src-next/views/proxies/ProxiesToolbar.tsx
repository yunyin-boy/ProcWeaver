import React, { useRef, useEffect } from "react";
import { EyeOff, Plus, Search, ShieldCheck, X, Zap } from "lucide-react";
import { ProxySortMode, ProxyViewMode } from "../../types/proxy";
import { CustomSelect } from "../../primitives/CustomSelect";
import { KbdBadge } from "../../primitives/Badge";

interface ProxiesToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortMode: ProxySortMode;
  onSortModeChange: (m: ProxySortMode) => void;
  viewMode: ProxyViewMode;
  onViewModeChange: (v: ProxyViewMode) => void;
  allCollapsed: boolean;
  onToggleAllCollapsed: () => void;
  // 测速
  isTestingAll: boolean;
  onTestAll: () => void;
  // 测健康
  isTestingHealth: boolean;
  healthProgress?: { current: number; total: number };
  onTestAllHealth: () => void;
  // 节点统计与高级模态窗
  totalNodes: number;
  onNewGroup?: () => void;
  onSpeedtestSettings: () => void;
  onOpenLocalNodeModal: () => void;
  ignoredCount: number;
  onOpenIgnoredModal: () => void;
}

export const ProxiesToolbar: React.FC<ProxiesToolbarProps> = ({
  searchQuery,
  onSearchChange,
  sortMode,
  onSortModeChange,
  viewMode,
  onViewModeChange,
  allCollapsed,
  onToggleAllCollapsed,
  isTestingAll,
  onTestAll,
  isTestingHealth,
  healthProgress,
  onTestAllHealth,
  totalNodes,
  onNewGroup,
  onSpeedtestSettings,
  onOpenLocalNodeModal,
  ignoredCount,
  onOpenIgnoredModal,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (event.key !== "/" || !input || input.disabled || !input.getClientRects().length) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const healthLabel = isTestingHealth
    ? healthProgress
      ? "体检中 " + healthProgress.current + "/" + healthProgress.total
      : "全量体检中…"
    : "测健康";

  return (
    <div className="relative z-30 grid gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="workbench-field flex min-w-[min(100%,210px)] flex-1 items-center gap-2 px-2.5">
          <Search size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="搜索节点、策略组、地区或协议"
            placeholder="搜索节点、策略组、地区或协议"
            className="min-h-9 flex-1 bg-transparent text-[13px] disabled:opacity-60"
          />
          {searchQuery ? (
            <button type="button" className="workbench-title-button !min-h-6 !min-w-6" onClick={() => onSearchChange("")} aria-label="清除搜索">
              <X size={14} aria-hidden="true" />
            </button>
          ) : <KbdBadge keys={["/"]} className="shrink-0 !bg-[var(--workbench-surface)]" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onNewGroup && (
            <button type="button" onClick={onNewGroup} className="workbench-action workbench-action-primary">
              <Plus size={14} aria-hidden="true" /> 新建策略组
            </button>
          )}
          <button type="button" onClick={onOpenLocalNodeModal} className="workbench-action">
            <Plus size={14} aria-hidden="true" /> 自建节点
          </button>
          <button type="button" onClick={onOpenIgnoredModal} className="workbench-action">
            <EyeOff size={14} aria-hidden="true" /> 已隐藏
            {ignoredCount > 0 && <span className="tabular-nums">{ignoredCount}</span>}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="workbench-sort">
            <CustomSelect
              className="workbench-picker"
              value={sortMode}
              onChange={(value) => onSortModeChange(value as ProxySortMode)}
              options={[
                { value: "default", label: "默认配置顺序" },
                { value: "delay-asc", label: "按延迟由低到高" },
                { value: "fraud-asc", label: "按风控分排序 (低风险优先)" },
                { value: "multiplier-asc", label: "按倍率由低到高" },
                { value: "name-asc", label: "按名称首字母排序" },
              ]}
              size="sm"
            />
          </div>
          <div className="workbench-segments" role="group" aria-label="节点视图">
            <button type="button" aria-pressed={viewMode === "grid"} onClick={() => onViewModeChange("grid")}>网格</button>
            <button type="button" aria-pressed={viewMode === "list"} onClick={() => onViewModeChange("list")}>列表</button>
          </div>
          <button type="button" className="workbench-action workbench-action-ghost" onClick={onToggleAllCollapsed}>
            {allCollapsed ? "展开全部" : "折叠全部"}
          </button>
          <span className="whitespace-nowrap px-1 text-xs tabular-nums text-[var(--text-muted)]">{totalNodes} 个节点</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="workbench-action workbench-action-ghost" onClick={onSpeedtestSettings}>
            测速地址
          </button>
          <button type="button" className="workbench-action workbench-action-positive" disabled={isTestingHealth || totalNodes === 0} aria-busy={isTestingHealth} onClick={onTestAllHealth}>
            <ShieldCheck size={14} aria-hidden="true" /> {healthLabel}
          </button>
          <button type="button" className="workbench-action workbench-action-primary" disabled={isTestingAll || totalNodes === 0} aria-busy={isTestingAll} onClick={onTestAll}>
            <Zap size={14} aria-hidden="true" /> {isTestingAll ? "全量测速中…" : "全量测速"}
          </button>
        </div>
      </div>
    </div>
  );
};
