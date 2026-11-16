// ==========================================================================
// ProcWeaver src-next 进程分流主控工具栏与子 Tab 调度器
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// ==========================================================================

import React, { useState, useRef, useEffect } from "react";
import {
  ProcessRoutingState,
  ProcessTrafficDriver,
  PROCESS_DRIVER_OPTIONS,
} from "../../types/processRouting";

export type ProcessSubTab = "bundles" | "rules" | "live";

interface ProcessToolbarProps {
  currentSubTab: ProcessSubTab;
  onSelectSubTab: (tab: ProcessSubTab) => void;
  state: ProcessRoutingState;
  onToggleMaster: () => void;
  onSwitchDriver: (driver: ProcessTrafficDriver) => Promise<void>;
  onElevateAdmin: () => Promise<void>;
  isPending: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAddModal: () => void;
  onImportBundle?: (file: File) => void;
  onOpenOfficialModal?: () => void;
}

export const ProcessToolbar: React.FC<ProcessToolbarProps> = ({
  currentSubTab,
  onSelectSubTab,
  state,
  onToggleMaster,
  onSwitchDriver,
  onElevateAdmin,
  isPending,
  searchQuery,
  onSearchChange,
  onOpenAddModal,
  onImportBundle,
  onOpenOfficialModal,
}) => {
  const [driverDropdownOpen, setDriverDropdownOpen] = useState(false);
  const [isSwitchingDriver, setIsSwitchingDriver] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 外部点击自动收起下拉面板
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDriverDropdownOpen(false);
      }
    };
    if (driverDropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [driverDropdownOpen]);

  // 当前驱动的配置定义
  const currentOption =
    PROCESS_DRIVER_OPTIONS.find((opt) => opt.id === state.engineMode) ||
    PROCESS_DRIVER_OPTIONS[0];

  const handleSelectDriver = async (driverId: ProcessTrafficDriver) => {
    if (driverId === state.engineMode || isSwitchingDriver) {
      setDriverDropdownOpen(false);
      return;
    }
    setIsSwitchingDriver(true);
    try {
      await onSwitchDriver(driverId);
    } finally {
      setIsSwitchingDriver(false);
      setDriverDropdownOpen(false);
    }
  };

  const handleElevate = async () => {
    try {
      await onElevateAdmin();
    } catch (e) {
      console.error("提权启动失败:", e);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3.5 rounded-2xl border border-[var(--glass-border-subtle)] glass-surface select-none relative z-20">
      {/* 顶栏：分流驱动选择下拉 + 实时接管指示 + 右侧操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 左侧：复合式分流主控胶囊 (方案 A: 开关 + 驱动选择二合一) + 实时接管进程数 */}
        <div className="flex items-center gap-2.5">
          {/* 方案 A: 复合胶囊 Split-Pill */}
          <div className="relative" ref={dropdownRef}>
            <div
              className={`inline-flex items-stretch rounded-xl border text-xs font-mono transition-all duration-200 overflow-hidden ${
                state.processEnabled
                  ? "bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                  : "bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] opacity-85"
              }`}
            >
              {/* 1. 左半区：一键秒级启停开关 */}
              <button
                type="button"
                onClick={onToggleMaster}
                disabled={isPending}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-all ${
                  state.processEnabled
                    ? "hover:bg-emerald-500/20 text-emerald-500"
                    : "hover:bg-black/10 dark:hover:bg-white/10 text-[var(--text-muted)]"
                } ${isPending ? "cursor-wait opacity-60" : "active:scale-95"}`}
                title={state.processEnabled ? "点击暂停进程分流拦截" : "点击启动进程分流拦截"}
              >
                <span
                  className={`h-2 w-2 rounded-full transition-all duration-300 ${
                    state.processEnabled
                      ? state.engineMode === "windivert_v1" && !state.isAdmin
                        ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse"
                        : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"
                      : "bg-zinc-400"
                  }`}
                />
                <span className="font-semibold text-xs whitespace-nowrap">
                  {isPending
                    ? "切换中..."
                    : state.processEnabled
                    ? "进程分流已启用"
                    : "进程分流已暂停"}
                </span>
              </button>

              {/* 2. 中间精致发丝分割线 */}
              <div
                className={`w-px my-1.5 transition-colors ${
                  state.processEnabled
                    ? "bg-emerald-500/30"
                    : "bg-[var(--glass-border-subtle)]"
                }`}
              />

              {/* 3. 右半区：驱动引擎下拉触发按钮 */}
              <button
                type="button"
                onClick={() => setDriverDropdownOpen(!driverDropdownOpen)}
                disabled={isSwitchingDriver}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-all ${
                  driverDropdownOpen
                    ? "bg-black/15 dark:bg-white/15 text-[var(--text-primary)]"
                    : "hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)]"
                }`}
                title="点击切换分流驱动引擎"
              >
                <span className="font-semibold text-[var(--text-primary)] whitespace-nowrap">
                  {currentOption.title}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline whitespace-nowrap">
                  · {currentOption.subLabel}
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] font-sans border whitespace-nowrap transition-colors ${
                    state.processEnabled
                      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/25"
                      : "bg-black/5 dark:bg-white/10 text-[var(--text-muted)] border-transparent"
                  }`}
                >
                  {state.processEnabled ? currentOption.tag : "挂起"}
                </span>
                <span
                  className={`text-[9px] text-zinc-400 transition-transform duration-200 ml-0.5 ${
                    driverDropdownOpen ? "rotate-180" : ""
                  }`}
                >
                  ▼
                </span>
              </button>
            </div>

            {/* 选项 A 沉浸下拉面板 (白瓷实底与暗曜石双轨，绝不含 TUN，纯进程分流模式) */}
            {driverDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-80 rounded-2xl p-2 bg-white dark:bg-[#0f172a] border border-slate-200/90 dark:border-white/15 shadow-2xl shadow-slate-900/15 dark:shadow-black/90 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2 py-1.5 border-b border-slate-100 dark:border-white/10 mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-800 dark:text-zinc-200">
                    选择分流拦截引擎
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-mono">
                    无虚拟网卡开销
                  </span>
                </div>

                <div className="space-y-1">
                  {PROCESS_DRIVER_OPTIONS.map((opt) => {
                    const isSelected = opt.id === state.engineMode;
                    const needsAdminWarning = opt.requiresAdmin && !state.isAdmin;

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelectDriver(opt.id)}
                        className={`w-full text-left p-2 rounded-xl transition-all flex flex-col gap-1 border ${
                          isSelected
                            ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500/40 text-emerald-950 dark:text-emerald-100 shadow-2xs"
                            : "border-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-zinc-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {opt.title}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-100 dark:bg-white/10 font-mono text-slate-600 dark:text-zinc-400 border border-slate-200/60 dark:border-transparent">
                              {opt.tag}
                            </span>
                            {needsAdminWarning && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                                需管理员
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-600 dark:text-zinc-400 leading-relaxed font-normal">
                          {opt.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* 非管理员且选定 WinDivert 时的提权指引胶囊 */}
                {!state.isAdmin && state.engineMode === "windivert_v1" && (
                  <div className="mt-2 pt-2 border-t border-[var(--glass-border-subtle)] px-2 pb-1">
                    <div className="flex items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2">
                      <div className="text-[10px] text-amber-500 leading-tight">
                        WinDivert 内核过滤需要管理员特权方可挂载
                      </div>
                      <button
                        type="button"
                        onClick={handleElevate}
                        className="px-2 py-1 rounded-lg bg-amber-500 text-black font-semibold text-[10px] hover:bg-amber-400 active:scale-95 transition-all shadow-sm shrink-0"
                      >
                        UAC 提权
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 实时接管进程数徽章 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-500 font-mono">
            <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="tabular-numeric font-bold">{state.activeProcessCount}</span>
            <span className="text-[10px] font-sans">个接管中</span>
          </div>

          {/* 核心驱动状态与提权直接引导横幅 */}
          {state.engineMode === "windivert_v1" && !state.isAdmin && (
            <button
              type="button"
              onClick={handleElevate}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 text-xs font-semibold hover:bg-amber-500/25 active:scale-95 transition-all shadow-sm cursor-pointer"
              title="WinDivert 内核过滤驱动需要管理员特权方可挂载，点击立即调起 UAC 重启提权"
            >
              <svg className="w-3.5 h-3.5 text-amber-500 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>未获特权 · 点击一键 UAC 提权</span>
            </button>
          )}
        </div>

        {/* 右侧：添加规则/新建业务套件按钮与导入按钮 */}
        <div className="flex items-center gap-2">
          {/* 隐藏的规则包文件选择器 */}
          <input
            type="file"
            ref={fileInputRef}
            accept=".json,.pwpack.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onImportBundle) {
                onImportBundle(file);
              }
              e.target.value = "";
            }}
          />

          {/* 当处于业务规则包 Tab 时提供“官方业务包”与“导入规则包” */}
          {currentSubTab === "bundles" && (
            <>
              {onOpenOfficialModal && (
                <button
                  type="button"
                  onClick={onOpenOfficialModal}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 text-blue-400 transition-all active:scale-95 cursor-pointer"
                  title="浏览并装载官方业务规则包与 GitHub 规则仓库"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span>官方业务包</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95 cursor-pointer"
                title="导入脱敏业务规则包 (.pwpack.json)"
              >
                <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>导入规则包</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95"
            title={
              currentSubTab === "bundles"
                ? "新建进程分流业务套件"
                : "添加自选进程分流规则"
            }
          >
            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>
              {currentSubTab === "bundles" ? "新建业务套件" : "添加进程规则"}
            </span>
          </button>
        </div>
      </div>

      {/* 底栏：子 Tab 切换组 + 搜索框 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-[var(--glass-border-subtle)]">
        {/* 子 Tab 切换组：业务规则包 vs 自定义进程 vs 实时活跃进程 */}
        <div className="flex items-center p-0.5 rounded-xl border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5">
          <button
            type="button"
            onClick={() => onSelectSubTab("bundles")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
              currentSubTab === "bundles"
                ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span>业务规则包</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-secondary)]">
              {state.totalBundleCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectSubTab("rules")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
              currentSubTab === "rules"
                ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>自定义进程</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-secondary)]">
              {state.totalRuleCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectSubTab("live")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
              currentSubTab === "live"
                ? "bg-white/20 dark:bg-white/15 text-[var(--text-primary)] font-semibold shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>实时活跃进程</span>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="relative w-full sm:w-64">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              currentSubTab === "bundles"
                ? "搜索业务套件 / 进程名..."
                : currentSubTab === "rules"
                ? "搜索进程规则 / 路径..."
                : "嗅探过滤网络进程..."
            }
            className="w-full pl-7 pr-3 py-1 text-xs rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-colors"
          />
        </div>
      </div>
    </div>
  );
};
