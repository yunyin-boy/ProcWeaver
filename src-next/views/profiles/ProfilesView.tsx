// ==========================================================================
// ProcWeaver src-next 订阅源管理工作台 (Profiles & Subscriptions)
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useEffect } from "react";
import { ProfileItem } from "../../types/profile";
import {
  getProfiles,
  addProfile,
  updateProfile,
  updateAllProfiles,
  selectProfile,
  deleteProfile,
  editProfileMetadata,
  getProfileContent,
  saveProfileContent,
  importProfileContent,
  formatBytes,
  formatRelativeTime,
} from "../../services/profileService";
import { CustomSelect } from "../../primitives/CustomSelect";
import { ConfirmModal } from "../../primitives/ConfirmModal";

interface ProfilesViewProps {
  onShowNotice?: (msg: string) => void;
  onProfileSwitched?: (name: string) => void;
}

export const ProfilesView: React.FC<ProfilesViewProps> = ({
  onShowNotice,
  onProfileSwitched,
}) => {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // 删除订阅确认模态窗状态 (替代原生 window.confirm)
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);

  // 添加订阅弹窗状态
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMode, setAddMode] = useState<"url" | "file">("url");
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addInterval, setAddInterval] = useState(24);
  const [addFileContent, setAddFileContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 编辑元数据弹窗状态
  const [editingProfile, setEditingProfile] = useState<ProfileItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState(24);

  // YAML 源码查看/编辑弹窗状态
  const [viewerProfile, setViewerProfile] = useState<ProfileItem | null>(null);
  const [viewerContent, setViewerContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);

  // ESC 快捷键统一关闭弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewerProfile) {
          setViewerProfile(null);
        } else if (editingProfile) {
          setEditingProfile(null);
        } else if (isAddModalOpen) {
          setIsAddModalOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewerProfile, editingProfile, isAddModalOpen]);

  // 加载订阅列表
  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const data = await getProfiles();
      setProfiles(data);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`加载订阅列表失败: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  // 切换激活订阅方案
  const handleSelect = async (p: ProfileItem) => {
    if (p.isSelected || switchingId) return;
    setSwitchingId(p.id);
    try {
      await selectProfile(p.id);
      setProfiles((prev) =>
        prev.map((item) => ({ ...item, isSelected: item.id === p.id }))
      );
      if (onProfileSwitched) onProfileSwitched(p.name);
      if (onShowNotice) onShowNotice(`已切换并应用配置方案: ${p.name}`);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`切换订阅失败: ${e?.message || e}`);
    } finally {
      setSwitchingId(null);
    }
  };

  // 单项刷新订阅
  const handleUpdateOne = async (id: string, name: string) => {
    setRefreshingId(id);
    try {
      const updated = await updateProfile(id);
      setProfiles((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      );
      if (onShowNotice) onShowNotice(`订阅【${name}】已同步最新节点与规则`);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`同步失败: ${e?.message || e}`);
    } finally {
      setRefreshingId(null);
    }
  };

  // 全量更新所有订阅
  const handleUpdateAll = async () => {
    setIsRefreshingAll(true);
    try {
      await updateAllProfiles(profiles);
      await loadProfiles();
      if (onShowNotice) onShowNotice("全部云端订阅源同步完成");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`全量更新失败: ${e?.message || e}`);
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // 删除订阅 - 触发微晶确认弹窗
  const handleDelete = (id: string, name: string, isSelected: boolean) => {
    if (isSelected) {
      if (onShowNotice) {
        onShowNotice(`订阅 [${name}] 当前正在生效中，若要删除请先将另一方案设为生效`);
      }
      return;
    }
    setProfileToDelete({ id, name });
  };

  // 确认执行物理删除订阅
  const handleConfirmDelete = async () => {
    if (!profileToDelete) return;
    const { id, name } = profileToDelete;
    setIsDeletingProfile(true);
    try {
      await deleteProfile(id);
      setProfiles((prev) => prev.filter((item) => item.id !== id));
      if (onShowNotice) onShowNotice(`已移除订阅配置: ${name}`);
      setProfileToDelete(null);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`删除失败: ${e?.message || e}`);
    } finally {
      setIsDeletingProfile(false);
    }
  };

  // 提交添加订阅
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (addMode === "url") {
        if (!addUrl.trim()) {
          if (onShowNotice) onShowNotice("请填写有效的订阅链接地址");
          return;
        }
        await addProfile({
          name: addName.trim() || "机场高速订阅源",
          url: addUrl.trim(),
          autoUpdateInterval: addInterval,
        });
        if (onShowNotice) onShowNotice("订阅源已成功添加并自动拉取");
      } else {
        if (!addFileContent.trim()) {
          if (onShowNotice) onShowNotice("请粘贴或导入有效的 YAML 格式配置文本");
          return;
        }
        await importProfileContent({
          name: addName.trim() || "本地导入分流配置",
          content: addFileContent,
        });
        if (onShowNotice) onShowNotice("本地配置文件已成功导入");
      }
      setIsAddModalOpen(false);
      setAddName("");
      setAddUrl("");
      setAddFileContent("");
      await loadProfiles();
    } catch (err: any) {
      if (onShowNotice) onShowNotice(`添加失败: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开元数据编辑弹窗
  const handleOpenEdit = (p: ProfileItem) => {
    setEditingProfile(p);
    setEditName(p.name);
    setEditInterval(p.autoUpdateInterval || 24);
  };

  // 保存元数据修改
  const handleSaveEdit = async () => {
    if (!editingProfile) return;
    try {
      const updated = await editProfileMetadata(
        editingProfile.id,
        editName.trim() || editingProfile.name,
        editInterval
      );
      setProfiles((prev) =>
        prev.map((item) => (item.id === editingProfile.id ? updated : item))
      );
      setEditingProfile(null);
      if (onShowNotice) onShowNotice("订阅参数已成功更新");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`修改失败: ${e?.message || e}`);
    }
  };

  // 打开源码查看器
  const handleOpenViewer = async (p: ProfileItem) => {
    setViewerProfile(p);
    setIsLoadingContent(true);
    try {
      const content = await getProfileContent(p.id);
      setViewerContent(content);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`读取配置文本失败: ${e?.message || e}`);
      setViewerProfile(null);
    } finally {
      setIsLoadingContent(false);
    }
  };

  // 保存源码修改
  const handleSaveViewerContent = async () => {
    if (!viewerProfile) return;
    setIsSavingContent(true);
    try {
      await saveProfileContent(viewerProfile.id, viewerContent);
      if (onShowNotice) onShowNotice("配置文本已成功保存至本地持久化");
      setViewerProfile(null);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`保存配置失败: ${e?.message || e}`);
    } finally {
      setIsSavingContent(false);
    }
  };

  // 当前激活方案
  const activeProfile = profiles.find((p) => p.isSelected);

  return (
    <div className="space-y-3 pb-12 animate-in fade-in duration-150">
      {/* ============================================================== */}
      {/* 极简一体化紧凑顶栏 (Compact Header Bar: 高度 38px，极度克制) */}
      {/* ============================================================== */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl glass-surface border border-[var(--glass-border-subtle)] shadow-xs">
        {/* 左侧: 图标 + 标题 + 统计徽标 + 运行中方案指示 */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
            </svg>
          </div>
          <span className="font-semibold text-xs text-[var(--text-primary)] shrink-0">
            订阅源管理
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-sunken)] text-[var(--text-muted)] shrink-0">
            {profiles.length} 个方案
          </span>
          {activeProfile && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20 shrink-0 truncate max-w-[180px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="truncate">{activeProfile.name}</span>
            </span>
          )}
        </div>

        {/* 右侧: 全部更新 + 添加订阅 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleUpdateAll}
            disabled={isRefreshingAll || isLoading}
            className="px-2.5 py-1 rounded-lg bg-[var(--surface-card)] hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border-subtle)] text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 shrink-0 shadow-2xs active:scale-[0.98] disabled:opacity-50"
          >
            <svg
              className={`w-3 h-3 ${isRefreshingAll ? "animate-spin text-indigo-500" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshingAll ? "更新中..." : "全部更新"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 shrink-0 shadow-xs active:scale-[0.98]"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>添加订阅</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 订阅卡片网格列表 (双列紧凑流式磁贴: 高度 85px，极度克制) */}
      {/* ============================================================== */}
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-2">
          <svg className="w-5 h-5 animate-spin text-purple-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <div className="text-[11px] text-[var(--text-muted)] font-mono">载入配置清单...</div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="p-8 rounded-xl glass-surface border border-dashed border-[var(--glass-border)] text-center space-y-2">
          <div className="text-xs font-semibold text-[var(--text-primary)]">尚未导入任何订阅方案</div>
          <p className="text-[11px] text-[var(--text-muted)]">
            点击右上角“添加订阅”粘贴机场 HTTPS 链接或载入本地 YAML 配置。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {profiles.map((p) => {
            const isRefreshing = refreshingId === p.id;
            const isSwitching = switchingId === p.id;
            const isRemote = Boolean(p.url && p.url.trim());

            // 流量百分比计算
            const usedBytes = (p.upload || 0) + (p.download || 0);
            const totalBytes = p.total || 0;
            const hasTraffic = totalBytes > 0;
            const usagePercent = hasTraffic
              ? Math.min(100, Math.round((usedBytes / totalBytes) * 100))
              : 0;

            return (
              <div
                key={p.id}
                className={`p-3.5 rounded-xl glass-surface border transition-all duration-150 relative overflow-hidden flex flex-col justify-between space-y-2 ${
                  p.isSelected
                    ? "border-emerald-500/40 bg-emerald-500/[0.04] shadow-xs ring-1 ring-emerald-500/20"
                    : "border-[var(--glass-border-subtle)] hover:border-slate-500/40"
                }`}
              >
                {/* 顶部发丝内高光 */}
                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />

                {/* 1. 顶行: 状态指示点 + 方案名 + 类型徽章 + 激活状态 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        p.isSelected
                          ? "bg-emerald-500 shadow-xs shadow-emerald-500/50"
                          : "bg-slate-300 dark:bg-zinc-600"
                      }`}
                    />
                    <span className="font-semibold text-xs text-[var(--text-primary)] truncate" title={p.name}>
                      {p.name}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-sunken)] text-[var(--text-muted)] shrink-0">
                      {isRemote ? "云端" : "本地"}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0 hidden sm:inline">
                      {p.nodeCount} 节点
                    </span>
                  </div>

                  <div className="shrink-0">
                    {p.isSelected ? (
                      <span className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300 font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/25 flex items-center gap-1 shadow-2xs">
                        <svg className="w-3 h-3 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>生效中</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSelect(p)}
                        disabled={isSwitching}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[var(--surface-card)] hover:bg-indigo-600 hover:text-white text-[var(--text-primary)] border border-[var(--glass-border)] transition cursor-pointer shadow-2xs active:scale-[0.98] disabled:opacity-50"
                      >
                        {isSwitching ? "切换中..." : "应用"}
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. 中间行: 流量微型发丝进度条与到期信息 */}
                {hasTraffic ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                      <span className="text-[var(--text-secondary)]">
                        {formatBytes(usedBytes)} / {formatBytes(totalBytes)} ({usagePercent}%)
                      </span>
                      {p.expire && (
                        <span>到期: {new Date(p.expire * 1000).toLocaleDateString()}</span>
                      )}
                    </div>
                    <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          usagePercent > 90
                            ? "bg-rose-500"
                            : usagePercent > 75
                            ? "bg-amber-500"
                            : "bg-indigo-500"
                        }`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] font-mono text-[var(--text-muted)] truncate" title={p.url || p.filePath}>
                    {p.url || p.filePath}
                  </div>
                )}

                {/* 3. 底部行: 更新时间戳 + 微型图标快捷组 */}
                <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] pt-1 border-t border-[var(--glass-border-subtle)]/50">
                  <span>{formatRelativeTime(p.updatedAt)}</span>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isRemote && (
                      <button
                        type="button"
                        onClick={() => handleUpdateOne(p.id, p.name)}
                        disabled={isRefreshing}
                        className="hover:text-[var(--text-primary)] transition p-0.5 cursor-pointer text-[10px] flex items-center gap-0.5"
                        title="立即拉取更新"
                      >
                        <svg className={`w-3 h-3 ${isRefreshing ? "animate-spin text-indigo-500" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>更新</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenViewer(p)}
                      className="hover:text-[var(--text-primary)] transition p-0.5 cursor-pointer text-[10px] flex items-center gap-0.5"
                      title="查看本地配置源码"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                      <span>源码</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(p)}
                      className="hover:text-[var(--text-primary)] transition p-0.5 cursor-pointer text-[10px]"
                      title="修改别名与周期"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>

                    {/* 删除配置方案按钮 (常驻显式，生效方案带安全拦截提示) */}
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id, p.name, p.isSelected)}
                      className="hover:text-rose-500 hover:bg-rose-500/10 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] transition cursor-pointer flex items-center gap-0.5 border border-transparent hover:border-rose-500/20"
                      title={p.isSelected ? "当前生效中（若要删除请先应用另一方案）" : "删除此订阅方案"}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>删除</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================== */}
      {/* 弹窗 1: 添加订阅源模态框 */}
      {/* ============================================================== */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => e.target === e.currentTarget && setIsAddModalOpen(false)}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 p-6 shadow-2xl space-y-5 relative">
            <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-3">
              <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <span>添加订阅或配置方案</span>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 模式切换胶囊 */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100/90 dark:bg-black/40 border border-slate-200/80 dark:border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setAddMode("url")}
                className={`py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                  addMode === "url"
                    ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs border border-slate-200/60 dark:border-transparent"
                    : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                远程 URL 订阅
              </button>
              <button
                type="button"
                onClick={() => setAddMode("file")}
                className={`py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                  addMode === "file"
                    ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs border border-slate-200/60 dark:border-transparent"
                    : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                本地 YAML 导入
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  方案别名 (可选)
                </label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="留空自动识别机场或配置文件名"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-[var(--text-primary)] focus:bg-white dark:focus:bg-white/10 focus:outline-hidden focus:border-indigo-500 transition-colors"
                />
              </div>

              {addMode === "url" ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      订阅链接 (HTTPS / Clash 协议地址)
                    </label>
                    <input
                      type="url"
                      required
                      value={addUrl}
                      onChange={(e) => setAddUrl(e.target.value)}
                      placeholder="https://your-airport-domain.com/api/v1/client/subscribe?token=..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-[var(--text-primary)] font-mono focus:bg-white dark:focus:bg-white/10 focus:outline-hidden focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      自动更新周期 (小时)
                    </label>
                    <CustomSelect
                      value={String(addInterval)}
                      onChange={(val) => setAddInterval(parseInt(val, 10))}
                      options={[
                        { value: "6", label: "每 6 小时自动同步" },
                        { value: "12", label: "每 12 小时自动同步" },
                        { value: "24", label: "每 24 小时自动同步 (推荐)" },
                        { value: "48", label: "每 48 小时自动同步" },
                        { value: "0", label: "仅手动同步 (关闭自动拉取)" },
                      ]}
                      size="md"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    配置内容 (YAML 格式)
                  </label>
                  <textarea
                    rows={8}
                    required
                    value={addFileContent}
                    onChange={(e) => setAddFileContent(e.target.value)}
                    placeholder="粘贴 proxies: / proxy-groups: / rules: 等标准配置..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-[var(--text-primary)] font-mono leading-relaxed focus:bg-white dark:focus:bg-white/10 focus:outline-hidden focus:border-indigo-500 transition-colors"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border-subtle)]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-[var(--text-secondary)] transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer shadow-sm active:scale-[0.98] disabled:opacity-50"
                >
                  {isSubmitting ? "正在解析导入..." : "确认并导入"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 弹窗 2: 编辑订阅元数据模态框 */}
      {/* ============================================================== */}
      {editingProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => e.target === e.currentTarget && setEditingProfile(null)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 p-6 shadow-2xl space-y-4">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              修改配置方案属性
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  方案名称
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-[var(--text-primary)] focus:bg-white dark:focus:bg-white/10 focus:outline-hidden focus:border-indigo-500 transition-colors"
                />
              </div>

              {Boolean(editingProfile.url) && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    自动定时拉取周期 (小时)
                  </label>
                  <CustomSelect
                    value={String(editInterval)}
                    onChange={(val) => setEditInterval(parseInt(val, 10))}
                    options={[
                      { value: "6", label: "每 6 小时" },
                      { value: "12", label: "每 12 小时" },
                      { value: "24", label: "每 24 小时" },
                      { value: "48", label: "每 48 小时" },
                      { value: "0", label: "手动刷新" },
                    ]}
                    size="md"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--glass-border-subtle)]">
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className="px-4 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-[var(--text-secondary)] transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer shadow-sm active:scale-[0.98]"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 弹窗 3: YAML 源码查看/编辑模态框 */}
      {/* ============================================================== */}
      {viewerProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => e.target === e.currentTarget && setViewerProfile(null)}
        >
          <div className="w-full max-w-3xl h-[80vh] rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 p-5 shadow-2xl flex flex-col justify-between space-y-3 relative">
            <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-2.5">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <span>配置源码：{viewerProfile.name}</span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                  文件路径: {viewerProfile.filePath}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setViewerProfile(null)}
                className="p-1.5 rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 min-h-0 relative">
              {isLoadingContent ? (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-5 h-5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                </div>
              ) : (
                <textarea
                  value={viewerContent}
                  onChange={(e) => setViewerContent(e.target.value)}
                  className="w-full h-full p-4 rounded-xl bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)] text-xs text-[var(--text-primary)] font-mono leading-relaxed focus:outline-hidden focus:border-indigo-500 resize-none overflow-y-auto"
                />
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border-subtle)] text-xs">
              <span className="text-[11px] text-[var(--text-muted)]">
                提示: 修改保存后将覆盖本地缓存，切换至本方案时将以此配置运行
              </span>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewerProfile(null)}
                  className="px-3 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-xs font-semibold text-[var(--text-secondary)] transition cursor-pointer"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={handleSaveViewerContent}
                  disabled={isSavingContent}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer shadow-sm active:scale-[0.98] disabled:opacity-50"
                >
                  {isSavingContent ? "正在保存..." : "保存源码"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 订阅配置彻底删除微晶确认模态窗 (替代原生 window.confirm) */}
      <ConfirmModal
        isOpen={!!profileToDelete}
        title="彻底删除订阅配置？"
        description={`确定要彻底删除订阅配置 [${profileToDelete?.name || ""}] 吗？删除后本地缓存文件将被清理，此操作不可撤销。`}
        confirmText="彻底删除"
        cancelText="保留配置"
        variant="danger"
        isLoading={isDeletingProfile}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isDeletingProfile) setProfileToDelete(null);
        }}
      />
    </div>
  );
};
