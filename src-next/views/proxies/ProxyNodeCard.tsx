// ==========================================================================
// ProcWeaver src-next 现代双层毛玻璃节点微卡片
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 特性: 融合 IPpure 评估风控分与原生家宽指示、1px物理微高光、等宽防抖
// ==========================================================================

import React from "react";
import { ParsedNodeMeta, NodeHealthResult } from "../../types/proxy";
import { getDelayColorClass, getFraudScoreBadge } from "../../utils/nodeParser";

interface ProxyNodeCardProps {
  meta: ParsedNodeMeta;
  health?: NodeHealthResult;
  isSelected: boolean;
  isTesting?: boolean;
  onSelect: () => void;
  onTest: (e: React.MouseEvent) => void;
  onToggleIgnore?: (e: React.MouseEvent) => void;
}

export const ProxyNodeCard: React.FC<ProxyNodeCardProps> = React.memo(({
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
      className={`relative group rounded-xl p-3 select-none cursor-pointer transition-all duration-200 border text-left flex flex-col justify-between ${
        isSelected
          ? "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/40 shadow-[0_0_16px_rgba(16,185,129,0.12)]"
          : "glass-surface border-[var(--glass-border-subtle)] hover:border-[var(--glass-border-medium)] hover:translate-y-[-1px]"
      }`}
    >
      {/* 顶部微高光物理发丝线 */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />

      {/* 悬浮隐藏动作按钮 (右上角) */}
      {onToggleIgnore && (
        <button
          type="button"
          onClick={onToggleIgnore}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-80 hover:opacity-100 text-zinc-400 hover:text-rose-400 text-[10px] px-1 py-0.5 rounded transition-all bg-black/40 backdrop-blur-sm z-20"
          title="将此节点收起至已隐藏名单"
        >
          隐藏
        </button>
      )}

      <div>
        {/* 顶栏：地域标 + 协议胶囊 + 倍率胶囊 + 激活标记 */}
        <div className="flex items-center justify-between gap-1.5 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* 地域 ISO 代码微徽章 */}
            <span className="w-6 h-4 rounded text-[9px] font-mono font-bold flex items-center justify-center bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 shrink-0 border border-slate-200 dark:border-white/10">
              {meta.regionCode}
            </span>

            {/* 协议微徽章 */}
            <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border shrink-0 ${meta.protocolColor}`}>
              {meta.protocolBadge}
            </span>

            {/* 倍率微胶囊 */}
            {meta.multiplier !== 1.0 && (
              <span
                className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold shrink-0 ${
                  meta.multiplier < 1.0
                    ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                }`}
              >
                {meta.multiplier}x
              </span>
            )}
          </div>

          {/* 激活状态光点 */}
          {isSelected ? (
            <span className="flex items-center gap-1 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-emerald-500">活动</span>
            </span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-transparent group-hover:bg-white/20 transition-colors shrink-0" />
          )}
        </div>

        {/* 中部：节点名称 */}
        <div
          className={`text-[12px] font-medium tracking-tight truncate leading-snug py-0.5 ${
            isSelected
              ? "text-emerald-700 dark:text-emerald-300 font-semibold"
              : "text-[var(--text-primary)] group-hover:text-blue-500 transition-colors"
          }`}
          title={meta.rawName}
        >
          {meta.cleanName}
        </div>
      </div>

      {/* 核心体检元数据栏：IP 类型 + 评估风控分 */}
      <div className="flex items-center justify-between gap-1.5 py-1.5 my-1 border-t border-[var(--glass-border-subtle)] text-[10px]">
        {/* IP 类型 (原生家宽 / 机房商宽) */}
        <span
          className={`px-1.5 py-0.2 rounded font-medium border truncate max-w-[70px] ${
            health?.isResidential
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
              : health?.ipType
              ? "bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10"
              : "text-slate-500 dark:text-zinc-400 border-transparent font-medium"
          }`}
          title={health?.ip ? `落地 IP: ${health.ip}` : "未探测 IP 类型"}
        >
          {health?.ipType || "待体检"}
        </span>

        {/* 评估风控分 (彩色指示徽章) */}
        <span
          className={`px-1.5 py-0.2 rounded font-mono text-[9px] border flex items-center gap-1 ${fraudBadge.bgColor} ${fraudBadge.borderColor}`}
          title={health?.fraudScore !== undefined ? `IPpure 评估风控分: ${health.fraudScore} (越低越纯净)` : "未测风控分"}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${fraudBadge.dotColor}`} />
          <span className={fraudBadge.textColor}>{fraudBadge.label}</span>
        </span>
      </div>

      {/* 底栏：地域中文注释 + 等宽防抖延迟徽章 */}
      <div className="flex items-center justify-between pt-1.5 border-t border-[var(--glass-border-subtle)] text-[10px]">
        <span className="text-slate-600 dark:text-slate-400 font-medium truncate max-w-[85px]">
          {meta.regionName}
        </span>

        {/* 等宽延迟色阶胶囊 (点击触发单节点测速) */}
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded font-mono tabular-numeric transition-all min-w-[52px] justify-end ${
            isTesting
              ? "bg-blue-500/10 text-blue-500 animate-pulse"
              : "hover:bg-black/5 dark:hover:bg-white/10 active:scale-95"
          }`}
          title="点击单独测试该节点延迟"
        >
          {isTesting ? (
            <span className="text-[10px] text-blue-500">测速中...</span>
          ) : (
            <>
              <span className={`h-1.5 w-1.5 rounded-full ${delayInfo.dotColor}`} />
              <span className={`text-[11px] ${delayInfo.textColor}`}>
                {delayInfo.label}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});

ProxyNodeCard.displayName = "ProxyNodeCard";
