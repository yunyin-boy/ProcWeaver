// ==========================================================================
// ProcWeaver src-next 订阅源管理工作台 (Profiles & Subscriptions)
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useEffect, useId } from "react";
import { FileCode, Globe, Plus, RefreshCw } from "lucide-react";
import { ProfileItem } from "../../types/profile";
import {
  getProfiles,
  addProfile,
  updateProfile,
  updateAllProfiles,
  type ProfileBatchUpdateResult,
  selectProfile,
  deleteProfile,
  getProfileBoundBundleNames,
  editProfileMetadata,
  getProfileContent,
  saveProfileContent,
  importProfileContent,
  formatBytes,
  formatRelativeTime,
} from "../../services/profileService";
import { CustomSelect } from "../../primitives/CustomSelect";
import { ConfirmModal } from "../../primitives/ConfirmModal";
import { Button } from "../../primitives/Button";
import { Modal } from "../../primitives/Modal";

const updateIntervals = [
  { value: "6", label: "每 6 小时" },
  { value: "12", label: "每 12 小时" },
  { value: "24", label: "每 24 小时" },
  { value: "48", label: "每 48 小时" },
  { value: "0", label: "手动更新" },
];

interface ProfilesViewProps {
  onShowNotice?: (msg: string) => void;
  onProfileSwitched?: (name: string) => void;
}

export const ProfilesView: React.FC<ProfilesViewProps> = ({
  onShowNotice,
  onProfileSwitched,
}) => {
  const formId = useId();
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [batchFailure, setBatchFailure] = useState<ProfileBatchUpdateResult | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // 删除订阅确认模态窗状态 (替代原生 window.confirm)
  const [profileToDelete, setProfileToDelete] = useState<{
    id: string;
    name: string;
    switchToDefault: boolean;
    affectedBundles?: string[];
  } | null>(null);
  const [isPreparingDelete, setIsPreparingDelete] = useState(false);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);

  // 添加订阅弹窗状态
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMode, setAddMode] = useState<"url" | "file">("url");
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addInterval, setAddInterval] = useState(0);
  const [addFileContent, setAddFileContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 编辑元数据弹窗状态
  const [editingProfile, setEditingProfile] = useState<ProfileItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState(0);

  // YAML 源码查看/编辑弹窗状态
  const [viewerProfile, setViewerProfile] = useState<ProfileItem | null>(null);
  const [viewerContent, setViewerContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);

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
      if (!(await selectProfile(p.id))) throw new Error("方案切换未完成");
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
    setBatchFailure(null);
    try {
      const result = await updateAllProfiles(profiles);
      await loadProfiles();
      if (result.failedProfiles.length > 0) {
        setBatchFailure(result);
      } else {
        onShowNotice?.(result.updatedCount > 0 ? "全部云端订阅源同步完成" : "暂无可更新的云端订阅");
      }
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`全量更新失败: ${e?.message || e}`);
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // 删除订阅 - 触发微晶确认弹窗
  const handleDelete = async (id: string, name: string, isSelected: boolean) => {
    if (isSelected && profiles.length !== 1) {
      if (onShowNotice) {
        onShowNotice(`订阅 [${name}] 当前正在生效中，若要删除请先将另一方案设为生效`);
      }
      return;
    }
    if (!isSelected) {
      setProfileToDelete({ id, name, switchToDefault: false });
      return;
    }
    setIsPreparingDelete(true);
    try {
      const affectedBundles = await getProfileBoundBundleNames(id).catch(() => undefined);
      setProfileToDelete({ id, name, switchToDefault: true, affectedBundles });
    } finally {
      setIsPreparingDelete(false);
    }
  };

  // 确认执行物理删除订阅
  const handleConfirmDelete = async () => {
    if (!profileToDelete) return;
    const { id, name, switchToDefault } = profileToDelete;
    setIsDeletingProfile(true);
    try {
      if (!(await deleteProfile(id))) throw new Error("订阅删除未完成");
      setProfiles((prev) => prev.filter((item) => item.id !== id));
      if (switchToDefault) onProfileSwitched?.("默认分流策略");
      onShowNotice?.(switchToDefault ? `已删除「${name}」，已切换到本地默认配置` : `已移除订阅配置: ${name}`);
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
          name: addName.trim(),
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
    setEditInterval(p.autoUpdateInterval ?? 0);
  };

  // 保存元数据修改
  const handleSaveEdit = async () => {
    if (!editingProfile || isSubmitting) return;
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
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
      const updated = await saveProfileContent(viewerProfile.id, viewerContent);
      setProfiles((prev) =>
        prev.map((item) => (item.id === viewerProfile.id ? updated : item))
      );
      if (onShowNotice) onShowNotice("配置文本已成功保存至本地持久化");
      setViewerProfile(null);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`保存配置失败: ${e?.message || e}`);
    } finally {
      setIsSavingContent(false);
    }
  };

  const activeProfile = profiles.find((profile) => profile.isSelected);
  const hasRemoteProfiles = profiles.some((profile) => Boolean(profile.url?.trim()));
  const isUpdating = isRefreshingAll || refreshingId !== null;

  return (
    <div className="workbench-view workbench-profiles">
      <section className="workbench-panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4" aria-label="订阅源操作">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-xs text-[var(--text-muted)]">当前方案</span>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <strong className="min-w-0 [overflow-wrap:anywhere] text-sm">
              {isLoading && profiles.length === 0 ? "正在读取…" : activeProfile?.name || "尚未应用方案"}
            </strong>
            <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{profiles.length} 个方案</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleUpdateAll}
            loading={isRefreshingAll}
            disabled={isLoading || !hasRemoteProfiles || refreshingId !== null || switchingId !== null}
          >
            {!isRefreshingAll && <RefreshCw size={14} aria-hidden="true" />}
            {isRefreshingAll ? "更新中…" : "全部更新"}
          </Button>
          <Button type="button" variant="primary" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={15} aria-hidden="true" />添加订阅
          </Button>
        </div>
      </section>

      {batchFailure && (
        <div role="status" className="grid gap-2 rounded-xl bg-[var(--workbench-warning-bg)] p-4 text-xs text-[var(--workbench-warning)]">
          <p className="font-semibold">
            批量更新成功 {batchFailure.updatedCount} 项，失败 {batchFailure.failedProfiles.length} 项
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {batchFailure.failedProfiles.map(({ id, name }) => (
              <li key={id} className="[overflow-wrap:anywhere]">{name}</li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]">
          <RefreshCw size={15} className="animate-spin" aria-hidden="true" />正在读取订阅方案…
        </p>
      ) : profiles.length === 0 ? (
        <section className="workbench-panel flex items-start gap-3 p-5" aria-label="订阅源状态">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--workbench-selected)] text-[var(--workbench-accent)]">
            <Globe size={19} aria-hidden="true" />
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className="workbench-panel-title">暂无订阅方案</h2>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">通过「添加订阅」输入订阅链接，或粘贴本地 YAML 配置。</p>
          </div>
        </section>
      ) : (
        <section className="grid min-w-0 gap-4" aria-label="订阅方案列表">
          {profiles.map((profile) => {
            const isRemote = Boolean(profile.url?.trim());
            const isRefreshing = refreshingId === profile.id;
            const isSwitching = switchingId === profile.id;
            const usedBytes = (profile.upload || 0) + (profile.download || 0);
            const totalBytes = profile.total || 0;
            const usagePercent = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;
            const usageTone = usagePercent > 90 ? "var(--workbench-danger)" : usagePercent > 75 ? "var(--workbench-warning)" : "var(--workbench-accent-solid)";
            const updatedLabel = formatRelativeTime(profile.updatedAt);
            const ProfileIcon = isRemote ? Globe : FileCode;

            return (
              <article key={profile.id} className="workbench-panel workbench-profile-row">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--workbench-control)] text-[var(--workbench-accent)]">
                    <ProfileIcon size={17} aria-hidden="true" />
                  </span>
                  <div className="grid min-w-0 gap-1.5">
                    <h2 className="workbench-panel-title [overflow-wrap:anywhere]">{profile.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>{isRemote ? "远程订阅" : "本地配置"}</span>
                      <span className="tabular-nums">{profile.nodeCount} 个节点</span>
                      {profile.isSelected && <span className="workbench-tag workbench-tag-positive">生效中</span>}
                    </div>
                  </div>
                </div>

                <div className="grid min-w-0 gap-2 text-xs">
                  {totalBytes > 0 ? (
                    <div className="grid gap-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                        <span className="text-[var(--text-muted)]">流量用量</span>
                        <strong className="tabular-nums">{formatBytes(usedBytes)} / {formatBytes(totalBytes)}</strong>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-[var(--workbench-control)]"
                        role="progressbar"
                        aria-label="流量使用比例"
                        aria-valuenow={usagePercent}
                        aria-valuetext={usagePercent + "%"}
                      >
                        <div className="h-full rounded-full" style={{ width: usagePercent + "%", backgroundColor: usageTone }} />
                      </div>
                    </div>
                  ) : isRemote && (
                    <span className="text-[var(--text-muted)]">{usedBytes > 0 ? "已用 " + formatBytes(usedBytes) : "订阅未提供流量额度"}</span>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-muted)]">
                    <span title={profile.updatedAt}>{updatedLabel.endsWith("更新") ? updatedLabel : "更新于 " + updatedLabel}</span>
                    {profile.expire ? <span>到期 {new Date(profile.expire * 1000).toLocaleDateString()}</span> : null}
                    {isRemote && (
                      <span>{profile.autoUpdateInterval ? "每 " + profile.autoUpdateInterval + " 小时更新" : "手动更新"}</span>
                    )}
                  </div>
                </div>

                <div className="workbench-profile-actions">
                  {!profile.isSelected && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleSelect(profile)}
                      loading={isSwitching}
                      disabled={switchingId !== null || isUpdating}
                    >
                      {isSwitching ? "应用中…" : "应用方案"}
                    </Button>
                  )}
                  <div className="flex flex-wrap items-center gap-0.5">
                    {isRemote && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleUpdateOne(profile.id, profile.name)} loading={isRefreshing} disabled={isUpdating || switchingId !== null}>
                        {isRefreshing ? "更新中…" : "更新"}
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenViewer(profile)}>配置源码</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenEdit(profile)}>编辑</Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(profile.id, profile.name, profile.isSelected)}
                      disabled={isPreparingDelete || switchingId !== null || isUpdating}
                      className="hover:!bg-[var(--workbench-danger-bg)] hover:!text-[var(--workbench-danger)]"
                      title={profile.isSelected && profiles.length > 1 ? "请先应用另一方案" : "删除订阅方案"}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <Modal isOpen={isAddModalOpen} title="添加订阅或配置方案" onClose={() => { if (!isSubmitting) setIsAddModalOpen(false); }}>
        <form onSubmit={handleAddSubmit} className="grid min-w-0 gap-4">
          <div className="workbench-segments" role="group" aria-label="订阅添加方式">
            <button type="button" aria-pressed={addMode === "url"} onClick={() => setAddMode("url")} className="flex-1" disabled={isSubmitting}>订阅链接</button>
            <button type="button" aria-pressed={addMode === "file"} onClick={() => setAddMode("file")} className="flex-1" disabled={isSubmitting}>本地 YAML</button>
          </div>
          <label className="grid gap-1.5 text-[13px] font-semibold" htmlFor={formId + "-add-name"}>
            方案名称
            <input id={formId + "-add-name"} className="min-h-9 w-full px-3 font-normal" value={addName} onChange={(event) => setAddName(event.target.value)} placeholder={addMode === "url" ? "选填，留空自动获取名称" : "可选，留空使用默认名称"} disabled={isSubmitting} />
          </label>
          {addMode === "url" ? (
            <>
              <label className="grid gap-1.5 text-[13px] font-semibold" htmlFor={formId + "-url"}>
                订阅链接
                <input id={formId + "-url"} type="url" required className="min-h-9 w-full px-3 font-mono text-xs font-normal" value={addUrl} onChange={(event) => setAddUrl(event.target.value)} placeholder="https://example.com/subscription" disabled={isSubmitting} />
              </label>
              <div className="grid gap-1.5">
                <span className="text-[13px] font-semibold">自动更新周期</span>
                <CustomSelect value={String(addInterval)} onChange={(value) => setAddInterval(Number(value))} options={updateIntervals} disabled={isSubmitting} />
              </div>
            </>
          ) : (
            <label className="grid gap-1.5 text-[13px] font-semibold" htmlFor={formId + "-yaml"}>
              YAML 配置
              <textarea id={formId + "-yaml"} rows={8} required className="w-full resize-y px-3 py-2 font-mono text-xs font-normal leading-relaxed" value={addFileContent} onChange={(event) => setAddFileContent(event.target.value)} placeholder="在此粘贴 YAML 配置内容" disabled={isSubmitting} />
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsAddModalOpen(false)} disabled={isSubmitting}>取消</Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>{addMode === "url" ? "添加订阅" : "导入配置"}</Button>
          </div>
        </form>
      </Modal>

      {editingProfile && (
        <Modal isOpen title="编辑订阅方案" onClose={() => { if (!isSubmitting) setEditingProfile(null); }}>
          <form onSubmit={(event) => { event.preventDefault(); void handleSaveEdit(); }} className="grid min-w-0 gap-4">
            <label className="grid gap-1.5 text-[13px] font-semibold" htmlFor={formId + "-edit-name"}>
              方案名称
              <input id={formId + "-edit-name"} className="min-h-9 w-full px-3 font-normal" value={editName} onChange={(event) => setEditName(event.target.value)} disabled={isSubmitting} />
            </label>
            {editingProfile.url?.trim() && (
              <>
                <label className="grid gap-1.5 text-[13px] font-semibold" htmlFor={formId + "-edit-url"}>
                  订阅地址
                  <input id={formId + "-edit-url"} className="min-h-9 w-full px-3 font-mono text-xs font-normal" value={editingProfile.url} readOnly />
                </label>
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-semibold">自动更新周期</span>
                  <CustomSelect value={String(editInterval)} onChange={(value) => setEditInterval(Number(value))} options={updateIntervals} disabled={isSubmitting} />
                </div>
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditingProfile(null)} disabled={isSubmitting}>取消</Button>
              <Button type="submit" variant="primary" loading={isSubmitting}>保存修改</Button>
            </div>
          </form>
        </Modal>
      )}

      {viewerProfile && (
        <Modal isOpen wide title={"配置源码 · " + viewerProfile.name} subtitle={viewerProfile.filePath} onClose={() => { if (!isSavingContent) setViewerProfile(null); }}>
          <div className="grid min-w-0 gap-3">
            {isLoadingContent ? (
              <p role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-[var(--text-muted)]">
                <RefreshCw size={15} className="animate-spin" aria-hidden="true" />正在读取配置…
              </p>
            ) : (
              <textarea
                aria-label="YAML 配置源码"
                value={viewerContent}
                onChange={(event) => setViewerContent(event.target.value)}
                className="h-[min(50dvh,28rem)] w-full resize-none px-3 py-2 font-mono text-xs leading-relaxed"
                spellCheck={false}
                disabled={isSavingContent}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">保存将覆盖本地配置，切换到该方案时生效。</p>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={() => setViewerProfile(null)} disabled={isSavingContent}>关闭</Button>
                <Button type="button" variant="primary" onClick={handleSaveViewerContent} loading={isSavingContent} disabled={isLoadingContent}>保存源码</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 订阅配置彻底删除微晶确认模态窗 (替代原生 window.confirm) */}
      <ConfirmModal
        isOpen={!!profileToDelete}
        title="彻底删除订阅配置？"
        description={profileToDelete?.switchToDefault ? (
          <div className="space-y-2">
            <p>删除「{profileToDelete.name}」后将切换到本地默认配置。本地缓存文件会被清理，此操作不可撤销。</p>
            {!profileToDelete.affectedBundles ? (
              <p>依赖此订阅的业务包需要重新绑定出口。</p>
            ) : profileToDelete.affectedBundles.length > 0 ? (
              <div>
                <p>以下业务包需要重新绑定出口</p>
                <ul className="max-h-28 overflow-y-auto list-disc pl-5">
                  {profileToDelete.affectedBundles.map((name, index) => <li key={index}>{name}</li>)}
                </ul>
                <p>严格模式会继续阻止受影响的连接。</p>
              </div>
            ) : null}
          </div>
        ) : `确定要彻底删除订阅配置 [${profileToDelete?.name || ""}] 吗？删除后本地缓存文件将被清理，此操作不可撤销。`}
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
