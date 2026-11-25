// ==========================================================================
// ProcWeaver src-next 运行中进程树选择器模态弹窗 (RunningProcessPickerModal)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 风格约束: 严禁任何 Emoji，全量采用矢量语义与智能折叠
// ==========================================================================

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ConsolidatedProcess,
  fetchRunningProcesses,
} from "../../services/processDiscoveryService";

interface RunningProcessPickerModalProps {
  isOpen: boolean;
  existingExes: string[];
  onClose: () => void;
  onSelect: (process: ConsolidatedProcess) => void;
}

export const RunningProcessPickerModal: React.FC<RunningProcessPickerModalProps> = ({
  isOpen,
  existingExes,
  onClose,
  onSelect,
}) => {
  const [processes, setProcesses] = useState<ConsolidatedProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [hideSystem, setHideSystem] = useState(true);

  const loadProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchRunningProcesses(hideSystem);
      setProcesses(list);
    } finally {
      setLoading(false);
    }
  }, [hideSystem]);

  useEffect(() => {
    if (isOpen) {
      loadProcesses();
      setSearch("");
    }
  }, [isOpen, loadProcesses]);

  // 毫秒级搜索过滤
  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return processes;
    return processes.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.friendlyName && p.friendlyName.toLowerCase().includes(q)) ||
        (p.path && p.path.toLowerCase().includes(q))
    );
  }, [processes, search]);

  if (!isOpen) return null;

  // 根据分类渲染专属细线矢量图标 (严禁 Emoji)
  const renderCategoryIcon = (category: ConsolidatedProcess["category"]) => {
    switch (category) {
      case "browser":
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        );
      case "dev":
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        );
      case "im":
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
      case "game":
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
        );
      case "media":
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        );
      default:
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        );
    }
  };

  return (
    <div
      className="workbench-dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="workbench-dialog relative flex max-h-[82vh] w-full max-w-lg flex-col gap-3 overflow-hidden p-4 text-left sm:p-5" role="dialog" aria-modal="true" aria-label="选择运行进程">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border-subtle)] pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  从运行中进程选择
                </h3>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  进程树已自动合并
                </span>
              </div>
              <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">
                已自动折叠同名与衍生多实例，选中主程序即自动开启子进程递归接管
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadProcesses}
              disabled={loading}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="重新扫描系统进程"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-500" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 搜索工具栏与系统进程过滤 */}
        <div className="space-y-2">
          <div className="relative w-full">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索应用名称、进程名 (如 chrome / cursor / 微信)..."
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:bg-white dark:focus:bg-white/10 focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] px-0.5 select-none">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors">
              <input
                type="checkbox"
                checked={hideSystem}
                onChange={(e) => setHideSystem(e.target.checked)}
                className="rounded border-[var(--glass-border-subtle)] text-blue-500 focus:ring-0 cursor-pointer"
              />
              <span>隐藏 Windows 底层系统服务 (svchost / dwm 等)</span>
            </label>

            <span className="font-mono text-[10px]">
              就绪主程序: <span className="text-[var(--text-primary)] font-semibold">{filteredList.length}</span> 项
            </span>
          </div>
        </div>

        {/* 聚合进程列表容器 */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-[220px] max-h-[360px]">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)] space-y-1.5">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p>正在读取并合并 Windows 进程树与派生实例...</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              未找到匹配的运行中应用程序
            </div>
          ) : (
            filteredList.map((proc) => {
              const isAlreadyAdded = existingExes.some(
                (exe) => exe.toLowerCase() === proc.name.toLowerCase()
              );

              return (
                <div
                  key={proc.name}
                  className="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-slate-50/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 hover:border-blue-500/30 hover:bg-slate-100/80 dark:hover:bg-white/10 transition-all text-xs"
                >
                  {/* 左侧：图标 + 名称 + 路径 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="p-1.5 rounded-lg bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-slate-300 shrink-0">
                      {renderCategoryIcon(proc.category)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white truncate">
                          {proc.friendlyName || proc.name}
                        </span>
                        {proc.friendlyName && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            ({proc.name})
                          </span>
                        )}
                        {/* 派生子进程徽标 */}
                        {proc.subProcessCount > 0 ? (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0 font-medium">
                            +{proc.subProcessCount} 子进程 (自动递归接管)
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-400 shrink-0">
                            单进程
                          </span>
                        )}
                      </div>

                      {/* 真实路径 */}
                      {proc.path && (
                        <div
                          className="text-[10px] text-slate-600 dark:text-slate-400 font-mono truncate max-w-xs mt-0.5 font-medium"
                          title={proc.path}
                        >
                          {proc.path}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 右侧：选入按钮 */}
                  <button
                    type="button"
                    disabled={isAlreadyAdded}
                    onClick={() => onSelect(proc)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 ${
                      isAlreadyAdded
                        ? "bg-slate-200/70 dark:bg-white/5 text-slate-500 dark:text-slate-400 cursor-not-allowed border border-slate-200 dark:border-white/10"
                        : "bg-blue-600 hover:bg-blue-500 text-white shadow-xs active:scale-95 cursor-pointer"
                    }`}
                  >
                    {isAlreadyAdded ? "已在套件中" : "+ 选入套件"}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* 底部信息提示与关闭 */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border-subtle)] text-[10px] text-slate-600 dark:text-slate-400 font-medium">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>选入主程序后，套件将强锁该程序并在底层自动接管派生的所有子进程</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200 transition-all font-semibold cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
