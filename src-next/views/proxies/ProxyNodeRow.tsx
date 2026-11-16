// ==========================================================================
// ProcWeaver src-next 高密度表格列表行组件
// 规范溯源: typography-dark-mono-optics (等宽双轨治理)
// 特性: 呈现 IPpure IP类型与评估风控分
// ==========================================================================

import React from "react";
import { ParsedNodeMeta, NodeHealthResult } from "../../types/proxy";
import { getDelayColorClass, getFraudScoreBadge } from "../../utils/nodeParser";

interface ProxyNodeRowProps {
  meta: ParsedNodeMeta;
  health?: NodeHealthResult;
  isSelected: boolean;
  isTesting?: boolean;
  onSelect: () => void;
  onTest: (e: React.MouseEvent) => void;
  onToggleIgnore?: (e: React.MouseEvent) => void;
}

export const ProxyNodeRow: React.FC<ProxyNodeRowProps> = React.memo(({
  meta,
  health,
  isSelected,
  isTesting = false,
  onSelect,
  onTest,
  onToggleIgnore,
}) => {
  const delayInfo = getDelayColorClass(meta.latestDelay);
  const fraudBadge = getFraudScoreBadge(health?.fraudScore);

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center justify-between px-3.5 py-2.5 rounded-lg border cursor-pointer select-none transition-all text-left text-xs ${
        isSelected
          ? "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.08)]"
          : "glass-surface border-[var(--glass-border-subtle)] hover:border-[var(--glass-border-medium)] hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      {/* 左侧：激活标记 + 地区标 + 节点名 */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-3">
        {/* 激活圆点 */}
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${
            isSelected
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"
              : "bg-transparent border border-zinc-500/40"
          }`}
        />

        {/* 地区 ISO */}
        <span className="w-6 h-4 rounded text-[9px] font-mono font-bold flex items-center justify-center bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] shrink-0 border border-[var(--glass-border-subtle)]">
          {meta.regionCode}
        </span>

        {/* 节点名称 */}
        <span
          className={`font-medium truncate ${
            isSelected ? "font-semibold" : "text-[var(--text-primary)]"
          }`}
          title={meta.rawName}
        >
          {meta.cleanName}
        </span>
      </div>

      {/* 右侧：IP 类型 + 评估风控分 + 协议标 + 倍率 + 延迟胶囊 + 隐藏按钮 */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* IP 类型 */}
        <span
          className={`px-1.5 py-0.2 rounded font-medium border text-[10px] truncate max-w-[65px] hidden sm:inline ${
            health?.isResidential
              ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30 font-bold"
              : health?.ipType
              ? "bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border-[var(--glass-border-subtle)]"
              : "text-[var(--text-muted)] border-transparent"
          }`}
        >
          {health?.ipType || "未测"}
        </span>

        {/* 评估风控分 */}
        <span
          className={`px-1.5 py-0.2 rounded font-mono text-[9px] border flex items-center gap-1 hidden md:flex ${fraudBadge.bgColor} ${fraudBadge.borderColor}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${fraudBadge.dotColor}`} />
          <span className={fraudBadge.textColor}>{fraudBadge.label}</span>
        </span>

        {/* 协议胶囊 */}
        <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border hidden lg:inline ${meta.protocolColor}`}>
          {meta.protocolBadge}
        </span>

        {/* 倍率 */}
        <span className="text-[10px] font-mono text-[var(--text-muted)] w-8 text-right tabular-numeric hidden xl:inline">
          {meta.multiplier}x
        </span>

        {/* 等宽延迟胶囊 */}
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-mono tabular-numeric transition-all min-w-[58px] justify-end ${
            isTesting
              ? "bg-blue-500/10 text-blue-500 animate-pulse"
              : "hover:bg-black/5 dark:hover:bg-white/10 active:scale-95"
          }`}
          title="点击测速"
        >
          {isTesting ? (
            <span className="text-[10px] text-blue-500">测速中</span>
          ) : (
            <>
              <span className={`h-1.5 w-1.5 rounded-full ${delayInfo.dotColor}`} />
              <span className={`text-[11px] ${delayInfo.textColor}`}>
                {delayInfo.label}
              </span>
            </>
          )}
        </button>

        {/* 隐藏按钮 */}
        {onToggleIgnore && (
          <button
            type="button"
            onClick={onToggleIgnore}
            className="text-zinc-400 hover:text-rose-400 text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="隐藏该节点"
          >
            隐藏
          </button>
        )}
      </div>
    </div>
  );
});

ProxyNodeRow.displayName = "ProxyNodeRow";
