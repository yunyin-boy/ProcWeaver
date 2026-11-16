// ==========================================================================
// ProcWeaver src-next 实时网络活跃进程嗅探列表 (Live Process List)
// 规范溯源: typography-dark-mono-optics / taste-skill
// ==========================================================================

import React from "react";
import { LiveProcessItem } from "../../types/processRouting";

interface LiveProcessListProps {
  processes: LiveProcessItem[];
  onRouteProcess: (proc: LiveProcessItem, action: "proxy" | "direct") => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const LiveProcessList: React.FC<LiveProcessListProps> = ({
  processes,
  onRouteProcess,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div className="space-y-3">
      {/* 顶部嗅探说明与手动刷新 */}
      <div className="flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>正在实时捕获系统产生网络连接的应用程序进程 (共 {processes.length} 个活跃进程)</span>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-400 font-medium px-2 py-0.5 rounded hover:bg-blue-500/10 transition-colors"
        >
          <svg
            className={`w-3 h-3 ${isRefreshing ? "animate-spin text-blue-400" : "text-blue-500"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>{isRefreshing ? "嗅探中..." : "刷新活跃列表"}</span>
        </button>
      </div>

      {/* 列表主体 */}
      {processes.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)] glass-surface rounded-2xl border border-[var(--glass-border-subtle)]">
          当前未检测到活跃的网络连接进程
        </div>
      ) : (
        <div className="space-y-1.5">
          {processes.map((proc) => (
            <div
              key={proc.pid}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-[var(--glass-border-subtle)] glass-surface select-none hover:border-[var(--glass-border-medium)] transition-all text-xs"
            >
              {/* 左侧：PID + 进程名 + 路径提示 */}
              <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                {/* 进程 PID */}
                <span className="w-12 text-left font-mono tabular-numeric text-[10px] text-[var(--text-muted)] shrink-0">
                  #{proc.pid}
                </span>

                {/* 进程名 */}
                <span className="font-semibold text-[var(--text-primary)] truncate max-w-[140px] sm:max-w-[200px]" title={proc.path}>
                  {proc.name}
                </span>

                {/* 连接数与状态 */}
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] shrink-0">
                  {proc.connectionCount} 个连接
                </span>

                {/* 路径提示 */}
                {proc.path && (
                  <span className="text-[10px] text-[var(--text-muted)] truncate hidden xl:inline max-w-xs" title={proc.path}>
                    {proc.path}
                  </span>
                )}
              </div>

              {/* 右侧：接管状态或一键分流按钮 */}
              <div className="flex items-center gap-2 shrink-0">
                {proc.isRouted ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>已接管: {proc.matchedRuleName || "自定义分流"}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {/* 一键分流代理 */}
                    <button
                      type="button"
                      onClick={() => onRouteProcess(proc, "proxy")}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-500/15 hover:bg-blue-500/25 text-blue-500 border border-blue-500/30 transition-all active:scale-95"
                    >
                      分流此应用
                    </button>

                    {/* 一键直连 */}
                    <button
                      type="button"
                      onClick={() => onRouteProcess(proc, "direct")}
                      className="px-2 py-1 rounded-lg text-[11px] font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--glass-border-subtle)] transition-all"
                    >
                      直连排除
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
