// ==========================================================================
// ProcWeaver src-next 节点大盘全局操作与过滤工具栏
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// ==========================================================================

import React, { useRef, useEffect } from "react";
import { ProxySortMode, ProxyViewMode } from "../../types/proxy";
import { CustomSelect } from "../../primitives/CustomSelect";

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
  onOpenLocalNodeModal,
  ignoredCount,
  onOpenIgnoredModal,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 快捷键支持：按键盘 '/' 快速聚焦搜索框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="relative z-50 flex flex-col gap-2.5 p-3 rounded-2xl border border-[var(--glass-border-subtle)] glass-surface select-none">
      {/* 上层主栏：快速检索框 + 扩展入口群 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* 左侧：搜索框 */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px] max-w-xl">
          {/* 搜索框 (支持拼音/英文/按键提示) */}
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none flex items-center">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              disabled={totalNodes === 0}
              placeholder={
                totalNodes > 0
                  ? `搜索节点 / 地区 / 协议 (共 ${totalNodes} 个)...`
                  : "尚未添加订阅源与代理节点..."
              }
              className="w-full pl-8 pr-12 py-1.5 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {/* 按键提示 */}
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-muted)] border border-[var(--glass-border-subtle)]">
                  /
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 右侧扩展功能入口组：自建节点、已隐藏名单 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 本地自建节点管理 */}
          <button
            type="button"
            onClick={onOpenLocalNodeModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
            title="管理本地自建 VPS 节点"
          >
            <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">自建节点</span>
          </button>

          {/* 已隐藏节点入口 */}
          <button
            type="button"
            onClick={onOpenIgnoredModal}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-xl border transition-all ${
              ignoredCount > 0
                ? "bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20"
                : "bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            title="查看或恢复已隐藏的节点"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
            </svg>
            <span>已隐藏</span>
            {ignoredCount > 0 && (
              <span className="px-1 rounded-full text-[9px] font-mono font-bold bg-amber-500/20 text-amber-400">
                {ignoredCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 下层操作栏：排序偏好 + 视图切换 + 折叠全部 + 一键测健康 + 全量测速 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--glass-border-subtle)]">
        {/* 左侧：排序方式与视图切换 */}
        <div className="flex items-center gap-2">
          {/* 排序方式选择 */}
          <div className="w-52 relative z-40">
            <CustomSelect
              value={sortMode}
              onChange={(val) => onSortModeChange(val as ProxySortMode)}
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

          {/* 视图双模切换：网格 vs 列表 */}
          <div className="flex items-center rounded-lg border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                viewMode === "grid"
                  ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              title="网格视图"
            >
              网格
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                viewMode === "list"
                  ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              title="列表视图"
            >
              列表
            </button>
          </div>

          {/* 全部折叠 / 展开 */}
          <button
            type="button"
            onClick={onToggleAllCollapsed}
            className="px-2 py-1 text-xs rounded-lg border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--glass-border-medium)] transition-all"
          >
            {allCollapsed ? "展开全部" : "折叠全部"}
          </button>
        </div>

        {/* 右侧核心动作区：一键测健康 + 全量测速 */}
        <div className="flex items-center gap-2">
          {/* 一键测健康 (IPpure 接口，测订阅源所有节点) */}
          <button
            type="button"
            onClick={onTestAllHealth}
            disabled={isTestingHealth || totalNodes === 0}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
              totalNodes === 0
                ? "opacity-40 cursor-not-allowed bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] text-[var(--text-muted)]"
                : isTestingHealth
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 animate-pulse"
                : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 dark:text-emerald-400 border-emerald-500/30 active:scale-95"
            }`}
            title={
              totalNodes === 0
                ? "暂无可用节点可供体检"
                : "对当前订阅源的所有出站节点进行 IPpure 深度体检 (探测原生家宽与评估风控分)"
            }
          >
            <svg className={`w-3.5 h-3.5 ${isTestingHealth ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>
              {isTestingHealth
                ? healthProgress
                  ? `体检中 (${healthProgress.current}/${healthProgress.total})`
                  : "全量体检中..."
                : "测健康"}
            </span>
          </button>

          {/* 全量并发测速 */}
          <button
            type="button"
            onClick={onTestAll}
            disabled={isTestingAll || totalNodes === 0}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
              totalNodes === 0
                ? "opacity-40 cursor-not-allowed bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] text-[var(--text-muted)]"
                : isTestingAll
                ? "bg-blue-500/20 text-blue-400 border-blue-500/40 animate-pulse"
                : "bg-blue-500/15 hover:bg-blue-500/25 text-blue-500 dark:text-blue-400 border-blue-500/30 active:scale-95"
            }`}
            title={totalNodes === 0 ? "暂无可用节点可供测速" : "对全量出站节点并发测速"}
          >
            <svg className={`w-3.5 h-3.5 ${isTestingAll ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{isTestingAll ? "全量测速中..." : "全量测速"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
