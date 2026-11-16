// ==========================================================================
// ProcWeaver src-next 业务规则包专属卡片 (Business Bundle Card)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 优化规范: Operate 紧凑桌面设计，卡片垂直高度大幅压缩 40%，集成脱敏导出能力
// 风格约束: 严格杜绝 Emoji，全量采用专业内联 SVG
// ==========================================================================

import React from "react";
import { ProcessBundleItem } from "../../types/processRouting";
import { exportBundleToPwPack } from "../../services/processRoutingService";

interface BundleCardProps {
  bundle: ProcessBundleItem;
  isGlobalActive?: boolean;
  globalStatusHint?: string;
  onToggleEnabled: (enabled: boolean) => void;
  onOpenOutletPicker: () => void;
  onToggleSubprocesses: (enabled: boolean) => void;
  onEdit: () => void;
  onExport?: (bundle: ProcessBundleItem) => void;
  onDelete?: (bundleId: string) => void;
  onLaunch?: (bundle: ProcessBundleItem) => Promise<void> | void;
}

export const BundleCard: React.FC<BundleCardProps> = ({
  bundle,
  isGlobalActive = true,
  globalStatusHint,
  onToggleEnabled,
  onOpenOutletPicker,
  onToggleSubprocesses,
  onEdit,
  onExport,
  onDelete,
  onLaunch,
}) => {
  const [isLaunching, setIsLaunching] = React.useState(false);

  const handleLaunchClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onLaunch || isLaunching) return;
    setIsLaunching(true);
    try {
      await onLaunch(bundle);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExport) {
      onExport(bundle);
    } else {
      exportBundleToPwPack(bundle);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    onDelete(bundle.id);
  };

  // 进程列表折叠控制：仅展示前 3 个，超出显示 +N
  const displayExes = bundle.exes.slice(0, 3);
  const hiddenCount = bundle.exes.length - displayExes.length;

  return (
    <div
      className={`relative group rounded-2xl p-3 transition-all duration-200 border text-left flex flex-col justify-between gap-2.5 ${
        bundle.enabled
          ? "glass-surface border-[var(--glass-border-medium)] shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
          : "glass-surface border-[var(--glass-border-subtle)] opacity-70"
      }`}
    >
      {/* 顶部 1px 物理微高光发丝线 */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />

      {/* 头部：精简微图标 + 标题与说明 + 操作按钮组 */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-primary)] shrink-0">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-[140px]" title={bundle.name}>
                {bundle.name}
              </h4>
              <span
                className={`px-1 py-0.2 rounded text-[9px] font-mono font-medium border shrink-0 ${
                  bundle.mode === "sandbox"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                    : "bg-blue-500/15 text-blue-400 border-blue-500/25"
                }`}
              >
                {bundle.mode === "sandbox" ? "沙盒" : "强锁"}
              </span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5" title={bundle.description}>
              {bundle.description || "专属进程强锁与分流套件"}
            </p>
          </div>
        </div>

        {/* 右上角操作组：受控启动 + 导出 + 编辑 + 删除 + 独立强锁 Switch 开关 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 受控启动按钮 */}
          {onLaunch && (
            <button
              type="button"
              onClick={handleLaunchClick}
              disabled={isLaunching || !bundle.enabled}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-indigo-500/30 hover:border-indigo-500/60 text-indigo-500 hover:text-indigo-400 transition-all active:scale-95 bg-indigo-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={bundle.enabled ? "受控启动应用（由轻量 Hook 注入并锁定专属出口）" : "请先开启套件开关以受控启动"}
            >
              {isLaunching ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span>启动</span>
            </button>
          )}

          {/* 纯净脱敏导出按钮 */}
          <button
            type="button"
            onClick={handleExport}
            className="p-1 rounded-lg border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-muted)] hover:text-blue-400 transition-all active:scale-95 bg-black/5 dark:bg-white/5 cursor-pointer"
            title="导出为脱敏规则包 (.pwpack.json)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>

          {/* 编辑按钮 */}
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all active:scale-95 bg-black/5 dark:bg-white/5 cursor-pointer"
            title="编辑业务规则包与进程名单"
          >
            <svg className="w-3 h-3 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span>编辑</span>
          </button>

          {/* 删除按钮 (包含官方包均可删除) */}
          {onDelete && (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="p-1 rounded-lg border border-[var(--glass-border-subtle)] hover:border-rose-500/50 text-[var(--text-muted)] hover:text-rose-500 transition-all active:scale-95 bg-black/5 dark:bg-white/5 cursor-pointer"
              title="删除此业务规则包"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}

          {/* 独立启停 Switch 滑块开关 (真正接入后端驱动，并联动全局状态) */}
          <div className="flex items-center gap-1.5 pl-1.5 border-l border-[var(--glass-border-subtle)]">
            <button
              type="button"
              onClick={() => onToggleEnabled(!bundle.enabled)}
              className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                bundle.enabled
                  ? isGlobalActive
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.35)]"
                    : "bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.25)]"
                  : "bg-black/20 dark:bg-white/10"
              }`}
              title={
                !bundle.enabled
                  ? "点击开启该套件的强锁拦截"
                  : isGlobalActive
                  ? "强锁分流正在生效中"
                  : globalStatusHint || "套件已开启，但全局总控或驱动未就绪"
              }
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out my-auto ${
                  bundle.enabled ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </button>
            <span
              className={`text-[10px] font-semibold font-mono ${
                !bundle.enabled
                  ? "text-[var(--text-muted)]"
                  : isGlobalActive
                  ? "text-emerald-400"
                  : "text-amber-400"
              }`}
              title={
                !bundle.enabled
                  ? "未开启"
                  : isGlobalActive
                  ? "强锁生效中"
                  : globalStatusHint || "等待全局分流启动"
              }
            >
              {!bundle.enabled ? "挂起" : isGlobalActive ? (bundle.mode === "sandbox" ? "已沙盒" : "已强锁") : "待命中"}
            </span>
          </div>
        </div>
      </div>

      {/* 中部：紧凑微药丸进程名单流 */}
      <div className="flex items-center justify-between gap-2 py-1 border-y border-[var(--glass-border-subtle)] text-[10px]">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[var(--text-muted)] shrink-0">进程({bundle.exes.length}):</span>
          <div className="flex items-center gap-1 truncate">
            {displayExes.map((exe) => (
              <span
                key={exe}
                className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-secondary)] truncate max-w-[90px]"
                title={exe}
              >
                {exe}
              </span>
            ))}
            {hiddenCount > 0 && (
              <span className="px-1 py-0.2 rounded font-mono text-[9px] bg-black/10 dark:bg-white/10 text-[var(--text-muted)] shrink-0">
                +{hiddenCount}
              </span>
            )}
          </div>
        </div>
        <div className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
          主: {bundle.mainExe}
        </div>
      </div>

      {/* 底部：扁平化出口插槽绑定条 + 子进程/DNS策略 */}
      <div className="flex items-center justify-between gap-2 text-[10px]">
        {/* 出口插槽绑定 (模态弹窗选择器) */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <svg className="w-3 h-3 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[var(--text-muted)] shrink-0">出口:</span>
          <button
            type="button"
            onClick={onOpenOutletPicker}
            className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer max-w-[170px] truncate shadow-2xs border ${
              !bundle.targetProxy
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
                : "text-[var(--text-primary)] hover:text-blue-500 bg-black/5 dark:bg-white/5 hover:bg-blue-500/10 border-[var(--glass-border-subtle)] hover:border-blue-500/30"
            }`}
            title="点击打开模态弹窗为业务包指定专属出口"
          >
            <span className="truncate">{bundle.targetProxy || "请选择..."}</span>
            <svg className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100 text-current shrink-0 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>
        </div>

        {/* 策略徽标与子进程开关 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-blue-400 flex items-center gap-0.5 font-mono">
            <span className="h-1 w-1 rounded-full bg-blue-400" />
            <span>
              {bundle.policy.dnsMode === "fake_ip"
                ? "Fake-IP"
                : bundle.policy.dnsMode === "system_native"
                ? "系统DNS"
                : "纯净DNS"}
            </span>
          </span>

          <label className="flex items-center gap-1 cursor-pointer text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={bundle.policy.proxySubprocesses}
              onChange={(e) => onToggleSubprocesses(e.target.checked)}
              className="rounded border-[var(--glass-border-subtle)] text-blue-500 focus:ring-0 cursor-pointer w-3 h-3"
            />
            <span>子进程</span>
          </label>
        </div>
      </div>
    </div>
  );
};
