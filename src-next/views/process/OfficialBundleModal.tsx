// ==========================================================================
// ProcWeaver src-next 官方业务规则包中心与仓库管理模态窗 (OfficialBundleModal)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / AGENTS.md
// 官方仓库支持:
//   1. https://github.com/jojhaa/ProcWeaver-Rules (主规则仓库)
//   2. https://github.com/yunyin-boyWeaver-Rules (备用/镜像规则仓库)
// ==========================================================================

import React, { useState } from "react";
import { ProcessBundleItem } from "../../types/processRouting";
import { OFFICIAL_PRESET_BUNDLES } from "../../services/processRoutingService";

interface OfficialBundleModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingBundles: ProcessBundleItem[];
  onInstallPreset: (preset: ProcessBundleItem) => Promise<void>;
  onShowNotice?: (msg: string) => void;
}

export const OFFICIAL_REPOSITORIES = [
  {
    id: "repo-main",
    name: "ProcWeaver-Rules 官方主规则仓库",
    url: "https://github.com/jojhaa/ProcWeaver-Rules",
    description: "官方持续维护的核心 AI 开发套件、合规脱敏规则与进程出口分配定义",
    isPrimary: true,
  },
  {
    id: "repo-mirror",
    name: "yunyin-boyWeaver-Rules 镜像规则仓库",
    url: "https://github.com/yunyin-boyWeaver-Rules",
    description: "社区/备用发布源，提供节点出口分流拓扑与高并发进程规则同步",
    isPrimary: false,
  },
];

export const OfficialBundleModal: React.FC<OfficialBundleModalProps> = ({
  isOpen,
  onClose,
  existingBundles,
  onInstallPreset,
  onShowNotice,
}) => {
  const [activeTab, setActiveTab] = useState<"presets" | "repos">("presets");
  const [installingId, setInstallingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleInstall = async (preset: ProcessBundleItem) => {
    setInstallingId(preset.id);
    try {
      await onInstallPreset(preset);
      if (onShowNotice) {
        onShowNotice(`已成功添加官方规则包: ${preset.name}`);
      }
    } finally {
      setInstallingId(null);
    }
  };

  const openExternalUrl = (url: string) => {
    window.open(url, "_blank");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-[540px] rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 shadow-2xl p-5 text-left flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
        {/* 顶部标题栏 + 选项卡 + 关闭按钮 */}
        <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                官方业务规则包中心
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                精选开箱即用官方进程强锁套件与 GitHub 规则仓库
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title="关闭"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内部顶栏 Tab 切换: 官方预设套件池 vs 官方规则仓库 */}
        <div className="flex items-center gap-2 border-b border-[var(--glass-border-subtle)] pb-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("presets")}
            className={`pb-1 px-1 font-semibold transition-colors cursor-pointer border-b-2 ${
              activeTab === "presets"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            官方精选套件 ({OFFICIAL_PRESET_BUNDLES.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("repos")}
            className={`pb-1 px-1 font-semibold transition-colors cursor-pointer border-b-2 ${
              activeTab === "repos"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            GitHub 官方仓库 ({OFFICIAL_REPOSITORIES.length})
          </button>
        </div>

        {/* Tab 1: 官方精选套件列表 */}
        {activeTab === "presets" && (
          <div className="space-y-3">
            {OFFICIAL_PRESET_BUNDLES.map((preset) => {
              const isInstalled = existingBundles.some((b) => b.id === preset.id || b.name === preset.name);
              const isInstalling = installingId === preset.id;

              return (
                <div
                  key={preset.id}
                  className="p-3 rounded-xl border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/[0.03] flex items-start justify-between gap-3 hover:border-blue-500/30 transition-all"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-[var(--text-primary)]">
                        {preset.name}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/20">
                        官方核心
                      </span>
                    </div>

                    <p className="text-[11px] text-[var(--text-muted)] line-clamp-2">
                      {preset.description}
                    </p>

                    {/* 包含进程名单微胶囊 */}
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <span className="text-[9px] text-[var(--text-muted)]">纳管:</span>
                      {preset.exes.map((exe) => (
                        <span
                          key={exe}
                          className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-black/10 dark:bg-white/10 text-[var(--text-secondary)]"
                        >
                          {exe}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="shrink-0 pt-1">
                    {isInstalled ? (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>已装载</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleInstall(preset)}
                        disabled={isInstalling}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all active:scale-95 shadow-sm cursor-pointer disabled:opacity-50"
                      >
                        {isInstalling ? "添加中..." : "一键装载"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 2: 官方规则仓库列表 */}
        {activeTab === "repos" && (
          <div className="space-y-3">
            <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              ProcWeaver 业务规则包通过开源仓库发布。规则包仅携带进程强锁规则定义与专属插槽，绝不携带本机节点凭据。
            </div>

            {OFFICIAL_REPOSITORIES.map((repo) => (
              <div
                key={repo.id}
                className="p-3.5 rounded-xl border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/[0.03] space-y-2 hover:border-blue-500/30 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[var(--text-primary)]">
                      {repo.name}
                    </span>
                    {repo.isPrimary && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                        主源
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => openExternalUrl(repo.url)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 border border-blue-500/20 transition-all cursor-pointer"
                    title="在浏览器中访问 GitHub 规则仓库"
                  >
                    <span>访问仓库</span>
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </button>
                </div>

                <p className="text-[11px] text-[var(--text-muted)]">
                  {repo.description}
                </p>

                <div className="pt-1 text-[10px] font-mono text-[var(--text-muted)] truncate select-all">
                  {repo.url}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 底部关闭按钮 */}
        <div className="pt-2 border-t border-[var(--glass-border-subtle)] flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-xl border border-[var(--glass-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)] transition-all cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
