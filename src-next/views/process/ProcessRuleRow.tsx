// ==========================================================================
// ProcWeaver src-next 自定义进程规则行组件 (Process Rule Row)
// 规范溯源: typography-dark-mono-optics / taste-skill
// ==========================================================================

import React from "react";
import { ProcessRuleItem } from "../../types/processRouting";

interface ProcessRuleRowProps {
  rule: ProcessRuleItem;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  onLaunch?: (rule: ProcessRuleItem) => Promise<void> | void;
}

export const ProcessRuleRow: React.FC<ProcessRuleRowProps> = ({
  rule,
  onToggleEnabled,
  onDelete,
  onLaunch,
}) => {
  const [isLaunching, setIsLaunching] = React.useState(false);

  const handleLaunchClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onLaunch || isLaunching) return;
    setIsLaunching(true);
    try {
      await onLaunch(rule);
    } finally {
      setIsLaunching(false);
    }
  };
  const getActionBadge = (action: string) => {
    switch (action) {
      case "proxy":
        return {
          label: "代理分流",
          color: "bg-blue-500/15 text-blue-500 border-blue-500/30",
        };
      case "direct":
        return {
          label: "国内直连",
          color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
        };
      case "reject":
        return {
          label: "网络阻断",
          color: "bg-rose-500/15 text-rose-500 border-rose-500/30",
        };
      default:
        return {
          label: "规则分流",
          color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
        };
    }
  };

  const actionInfo = getActionBadge(rule.action);

  return (
    <div
      className={`group flex items-center justify-between px-3.5 py-2.5 rounded-xl border select-none transition-all text-left text-xs ${
        rule.enabled
          ? "glass-surface border-[var(--glass-border-subtle)] hover:border-[var(--glass-border-medium)]"
          : "glass-surface border-[var(--glass-border-subtle)] opacity-50"
      }`}
    >
      {/* 左侧：激活勾选 + 规则名称 + 进程匹配值 */}
      <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
        {/* 启停勾选 */}
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          className="rounded border-[var(--glass-border-subtle)] text-blue-500 focus:ring-0 cursor-pointer"
        />

        {/* 规则名称与匹配标识 */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-[var(--text-primary)] truncate max-w-[160px] sm:max-w-[200px]">
            {rule.label}
          </span>

          {/* 匹配的目标进程名或路径 */}
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] truncate max-w-[150px] sm:max-w-[220px]">
            {rule.matchValue}
          </span>

          {/* 子进程指示 */}
          {rule.includeDescendants && (
            <span className="hidden md:inline px-1.5 py-0.2 rounded text-[9px] font-mono text-[var(--text-muted)] border border-transparent">
              含子进程
            </span>
          )}
        </div>
      </div>

      {/* 右侧：动作胶囊 + 目标出站 + 创建时间 + 删除按钮 */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* 动作徽章 */}
        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${actionInfo.color}`}>
          {actionInfo.label}
        </span>

        {/* 绑定的代理出站 */}
        {rule.action === "proxy" && rule.targetProxy && (
          <span className="text-[11px] font-medium text-[var(--text-secondary)] max-w-[120px] sm:max-w-[180px] truncate hidden sm:inline">
            → {rule.targetProxy}
          </span>
        )}

        {/* 规则添加时间 */}
        {rule.createdAt && (
          <span className="text-[10px] font-mono text-[var(--text-muted)] hidden lg:inline">
            {rule.createdAt}
          </span>
        )}

        {/* 受控启动按钮 */}
        {onLaunch && (
          <button
            type="button"
            onClick={handleLaunchClick}
            disabled={isLaunching || !rule.enabled}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-indigo-500/30 hover:border-indigo-500/60 text-indigo-500 hover:text-indigo-400 transition-all active:scale-95 bg-indigo-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={rule.enabled ? "受控启动程序（由轻量 Hook 注入或 WinDivert 自动接管）" : "请先开启规则以受控启动"}
          >
            {isLaunching ? (
              <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="w-2.5 h-2.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span>启动</span>
          </button>
        )}

        {/* 删除规则按钮 */}
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-rose-400 text-xs px-1.5 py-0.5 rounded transition-all hover:bg-rose-500/10"
          title="删除此条进程规则"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
