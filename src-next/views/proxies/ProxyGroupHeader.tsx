// ==========================================================================
// ProcWeaver src-next 策略组吸顶控制头组件
// 规范溯源: ui-surface-elevation-hierarchy / taste-skill
// ==========================================================================

import React from "react";
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
  // 策略组类型微胶囊样式与文案 (明暗光学双轨分流，彻底根治亮色白底字迹看不清)
  const getTypeBadge = (type: string) => {
    switch (type.toLowerCase()) {
      case "urltest":
        return { label: "自动优选", color: "bg-blue-500/10 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 font-medium" };
      case "fallback":
        return { label: "故障转移", color: "bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 font-medium" };
      case "loadbalance":
        return { label: "负载均衡", color: "bg-purple-500/10 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 font-medium" };
      default:
        return { label: "手动选择", color: "bg-slate-200/80 dark:bg-zinc-500/15 text-slate-800 dark:text-zinc-200 border-slate-300/80 dark:border-zinc-500/30 font-medium" };
    }
  };

  const typeBadge = getTypeBadge(group.type);

  return (
    <div className="flex items-center justify-between py-2 px-1 text-xs select-none">
      {/* 左侧：折叠箭头 + 策略组名 + 类型徽章 + 活动节点预览 */}
      <div
        onClick={onToggleCollapse}
        className="flex items-center gap-2.5 cursor-pointer group min-w-0"
      >
        {/* 旋转箭头 */}
        <span
          className={`text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-transform duration-200 text-[10px] ${
            isCollapsed ? "-rotate-90" : "rotate-0"
          }`}
        >
          ▼
        </span>

        {/* 策略组名 */}
        <span className="font-semibold text-[13px] text-[var(--text-primary)] group-hover:text-blue-500 transition-colors truncate">
          {group.name}
        </span>

        {/* 组类型胶囊 */}
        <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase border shrink-0 ${typeBadge.color}`}>
          {typeBadge.label}
        </span>

        {/* 节点计数 */}
        <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
          ({nodeCount})
        </span>

        {/* 折叠时显示当前活动节点 */}
        {isCollapsed && group.now && (
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 truncate max-w-[200px]">
            当前: {group.now}
          </span>
        )}
      </div>

      {/* 右侧：一键组测健康与组测速按钮 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {onTestGroupHealth && (
          <button
            type="button"
            onClick={onTestGroupHealth}
            disabled={isTestingGroupHealth}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all ${
              isTestingGroupHealth
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 animate-pulse"
                : "glass-surface border-[var(--glass-border-subtle)] hover:border-emerald-500/40 hover:text-emerald-500 active:scale-95 text-[var(--text-secondary)]"
            }`}
            title="对该策略组下节点进行批量健康体检 (评估风控分与原生家宽)"
          >
            <svg className={`w-3 h-3 text-emerald-400 shrink-0 ${isTestingGroupHealth ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>{isTestingGroupHealth ? "体检中..." : "组测健康"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onTestGroup}
          disabled={isTestingGroup}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
            isTestingGroup
              ? "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse"
              : "glass-surface border-[var(--glass-border-subtle)] hover:border-blue-500/40 hover:text-blue-500 active:scale-95 text-[var(--text-secondary)]"
          }`}
          title="对该策略组下所有节点并发测速"
        >
          <svg className={`w-3 h-3 text-blue-400 shrink-0 ${isTestingGroup ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{isTestingGroup ? "测速中..." : "组测速"}</span>
        </button>
      </div>
    </div>
  );
};
