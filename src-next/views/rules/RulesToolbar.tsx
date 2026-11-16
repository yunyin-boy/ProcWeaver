// ==========================================================================
// ProcWeaver src-next 业务规则编织系统主控工具栏 (Rules Toolbar)
// 规范溯源: tauri-linear-raycast-ui / tauri-desktop-layout-typography / taste-skill
// 风格约束: 严禁任何 Emoji，全量采用矢量语义与物理微触感
// ==========================================================================

import React from "react";
import { RulesSubTab } from "../../types/rules";

interface RulesToolbarProps {
  currentSubTab: RulesSubTab;
  onSelectSubTab: (tab: RulesSubTab) => void;
  totalRuleCount: number;
  totalProviderCount: number;
  onRefreshAll: () => void;
  isRefreshing: boolean;
}

export const RulesToolbar: React.FC<RulesToolbarProps> = ({
  currentSubTab,
  onSelectSubTab,
  totalRuleCount,
  totalProviderCount,
  onRefreshAll,
  isRefreshing,
}) => {
  return (
    <div className="flex flex-col gap-3 p-3.5 rounded-2xl border border-[var(--glass-border-subtle)] glass-surface select-none relative z-20">
      {/* 顶栏: 规则统计概览 + 全量同步刷新 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 左侧: 规则与规则集统计徽章 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-500 font-mono">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="tabular-numeric font-bold">{totalRuleCount}</span>
            <span className="text-[10px] font-sans">条生效规则</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-xs text-[var(--text-secondary)] font-mono">
            <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7z" />
            </svg>
            <span className="tabular-numeric font-bold">{totalProviderCount}</span>
            <span className="text-[10px] font-sans">个外部规则集</span>
          </div>
        </div>

        {/* 右侧: 全量同步按钮 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            title="重新从内核拉取规则与规则集状态"
          >
            <svg
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-blue-500" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">同步</span>
          </button>
        </div>
      </div>

      {/* 底栏: 三联子 Tab 切换胶囊 (Linear 极简块状交互) */}
      <div className="flex items-center p-0.5 rounded-xl border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 overflow-x-auto">
        <button
          type="button"
          onClick={() => onSelectSubTab("active")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0 cursor-pointer ${
            currentSubTab === "active"
              ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <span>实时分流规则</span>
          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-secondary)]">
            {totalRuleCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectSubTab("providers")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0 cursor-pointer ${
            currentSubTab === "providers"
              ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span>外部规则集</span>
          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-secondary)]">
            {totalProviderCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectSubTab("simulator")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0 cursor-pointer ${
            currentSubTab === "simulator"
              ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>路由试算诊断仪</span>
        </button>
      </div>
    </div>
  );
};
