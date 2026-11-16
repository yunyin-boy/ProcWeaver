// ==========================================================================
// ProcWeaver src-next 外部规则集全功能订阅大盘与开源市场 (Rule Providers Tab - 形态 A)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill / impeccable-design
// 风格约束: 严禁任何 Emoji，全量采用矢量语义，高密度防挤压排版，单项一键差分刷新与开源市场
// ==========================================================================

import React, { useState } from "react";
import { RuleProviderItem } from "../../types/rules";
import {
  updateRuleProvider,
  addExternalRuleProvider,
  removeExternalRuleProvider,
  PRESET_RULE_PROVIDERS,
  PresetProviderItem,
} from "../../services/rulesService";
import { AddRuleProviderModal } from "./AddRuleProviderModal";

interface RuleProvidersTabProps {
  providers: RuleProviderItem[];
  onRefreshList: () => Promise<void>;
  onShowNotice?: (msg: string) => void;
}

export const RuleProvidersTab: React.FC<RuleProvidersTabProps> = ({
  providers,
  onRefreshList,
  onShowNotice,
}) => {
  const [updatingMap, setUpdatingMap] = useState<Record<string, boolean>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [mountingPresetId, setMountingPresetId] = useState<string | null>(null);

  // 单项规则集刷新
  const handleUpdateSingle = async (provider: RuleProviderItem) => {
    setUpdatingMap((prev) => ({ ...prev, [provider.name]: true }));
    try {
      await updateRuleProvider(provider.name);
      await onRefreshList();
      if (onShowNotice) {
        onShowNotice(`规则集 [${provider.name}] 已成功同步更新`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`同步失败: ${e?.message || e}`);
      }
    } finally {
      setUpdatingMap((prev) => ({ ...prev, [provider.name]: false }));
    }
  };

  // 全量规则集逐项刷新
  const handleUpdateAll = async () => {
    if (providers.length === 0) return;
    setIsRefreshingAll(true);
    try {
      for (const p of providers) {
        await updateRuleProvider(p.name);
      }
      await onRefreshList();
      if (onShowNotice) {
        onShowNotice(`全部 ${providers.length} 个规则集已完成同步比对`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`批量同步失败: ${e?.message || e}`);
      }
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // 移除已挂载规则集
  const handleRemoveProvider = async (name: string) => {
    try {
      await removeExternalRuleProvider(name);
      await onRefreshList();
      if (onShowNotice) {
        onShowNotice(`规则集 [${name}] 已从内核卸载`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`卸载失败: ${e?.message || e}`);
      }
    }
  };

  // 添加自定义规则集
  const handleAddCustomProvider = async (
    item: Omit<RuleProviderItem, "ruleCount">
  ) => {
    try {
      await addExternalRuleProvider(item);
      await onRefreshList();
      if (onShowNotice) {
        onShowNotice(`已添加规则集 [${item.name}] 并加载生效`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`添加规则集失败: ${e?.message || e}`);
      }
    }
  };

  // 开源市场一键挂载/卸载预设
  const handleTogglePreset = async (preset: PresetProviderItem) => {
    const isMounted = providers.some(
      (p) =>
        p.name.toLowerCase() === preset.name.toLowerCase() ||
        (p.url && p.url.trim() === preset.url.trim())
    );

    setMountingPresetId(preset.id);
    try {
      if (isMounted) {
        // 卸载
        const matched = providers.find(
          (p) =>
            p.name.toLowerCase() === preset.name.toLowerCase() ||
            (p.url && p.url.trim() === preset.url.trim())
        );
        if (matched) {
          await removeExternalRuleProvider(matched.name);
          await onRefreshList();
          if (onShowNotice) {
            onShowNotice(`已停用并卸载预设规则集 [${preset.title}]`);
          }
        }
      } else {
        // 挂载
        await addExternalRuleProvider({
          name: preset.name,
          url: preset.url,
          behavior: preset.behavior,
          format: preset.format,
          type: "Rule",
          vehicleType: "HTTP",
          ruleCount: preset.ruleCount,
        });
        await onRefreshList();
        if (onShowNotice) {
          onShowNotice(`已成功挂载开源规则集 [${preset.title}] 到核心路由`);
        }
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`操作失败: ${e?.message || e}`);
      }
    } finally {
      setMountingPresetId(null);
    }
  };

  // 统计已纳管总规则条目数
  const totalSubscribedRules = providers.reduce(
    (acc, cur) => acc + (cur.ruleCount || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* ============================================================== */}
      {/* 区域 1: 已生效外部规则集大盘 (Active Providers Overview)       */}
      {/* ============================================================== */}
      <section className="space-y-3">
        {/* 大盘顶栏: 标题、指标与快捷总控 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-[var(--text-primary)]">
              已生效规则集大盘
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
              {providers.length} 个活跃订阅
            </span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              纳管总量:{" "}
              <strong className="text-[var(--text-primary)] tabular-nums">
                {totalSubscribedRules.toLocaleString()}
              </strong>{" "}
              条
            </span>
          </div>

          {/* 右侧动作条: 刷新全部 + 添加自定义 (严谨防挤压) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isRefreshingAll || providers.length === 0}
              onClick={handleUpdateAll}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-xl border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-black/5 dark:bg-white/5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              title="逐个比对并更新所有规则集缓存"
            >
              <svg
                className={`w-3.5 h-3.5 ${
                  isRefreshingAll ? "animate-spin text-blue-500" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>{isRefreshingAll ? "正在全量同步..." : "刷新全部"}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-xl bg-blue-500 hover:bg-blue-600 active:scale-95 text-white transition-all shadow-md shadow-blue-500/20 cursor-pointer whitespace-nowrap"
              title="添加自定义规则集 URL 订阅"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>添加规则集</span>
            </button>
          </div>
        </div>

        {/* 规则集卡片网格 */}
        {providers.length === 0 ? (
          <div className="p-8 text-center rounded-2xl glass-surface border border-dashed border-[var(--glass-border-subtle)] space-y-2">
            <svg
              className="w-8 h-8 mx-auto text-[var(--text-muted)] opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <div className="text-xs font-medium text-[var(--text-primary)]">
              暂未挂载外部规则集
            </div>
            <p className="text-[11px] text-[var(--text-muted)] max-w-sm mx-auto">
              您可以点击上方【添加规则集】导入自建源，或从下方【开源精选规则集推荐】中一键装载主流规则库。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => {
              const isUpdating = updatingMap[p.name];
              const behavior = p?.behavior || "domain";
              const format = p?.format || "yaml";

              return (
                <div
                  key={p.name}
                  className="flex flex-col justify-between p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] hover:border-blue-500/30 transition-all gap-3 group"
                >
                  {/* 顶部: 名称 + 格式徽标 + 操作按钮组 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4
                          className="text-xs font-bold text-[var(--text-primary)] truncate"
                          title={p.name}
                        >
                          {p.name}
                        </h4>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">
                          {behavior.toUpperCase()}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-black/5 dark:bg-white/10 text-[var(--text-muted)] shrink-0">
                          {format.toUpperCase()}
                        </span>
                      </div>

                      {p.url && (
                        <div
                          className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-xs"
                          title={p.url}
                        >
                          {p.url}
                        </div>
                      )}
                    </div>

                    {/* 操作按钮组: 刷新 + 移除 */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => handleUpdateSingle(p)}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xl border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-black/5 dark:bg-white/5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        title="立即从云端同步更新该规则集"
                      >
                        <svg
                          className={`w-3 h-3 ${
                            isUpdating ? "animate-spin text-blue-500" : ""
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        <span className="text-[11px]">
                          {isUpdating ? "同步中" : "刷新"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveProvider(p.name)}
                        className="p-1 rounded-xl hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-500 transition-colors cursor-pointer"
                        title="从内核卸载该规则集"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.8}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* 底部指标: 规则条数 + 更新时间 */}
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border-subtle)] text-xs text-[var(--text-muted)]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px]">纳管条目:</span>
                      <span className="font-mono font-bold text-[var(--text-primary)] tabular-nums">
                        {(p.ruleCount || 0).toLocaleString()}
                      </span>
                      <span className="text-[10px]">条</span>
                    </div>

                    {p.updatedAt && (
                      <div className="text-[10px] font-mono text-[var(--text-muted)]">
                        更新于: {p.updatedAt}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* 区域 2: 开源精选规则集市场 (Curated Open-Source Marketplace)   */}
      {/* ============================================================== */}
      <section className="space-y-3 pt-3 border-t border-[var(--glass-border-subtle)]">
        {/* 市场顶栏 */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-xs font-bold text-[var(--text-primary)]">
              开源精选规则集推荐
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              来自 MetaCubeX 与 Loyalsoldier 高维护度社区生态，支持二进制 MRS 极速加载
            </p>
          </div>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            共 {PRESET_RULE_PROVIDERS.length} 款官方精选
          </span>
        </div>

        {/* 市场卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PRESET_RULE_PROVIDERS.map((preset) => {
            const isMounted = providers.some(
              (p) =>
                p.name.toLowerCase() === preset.name.toLowerCase() ||
                (p.url && p.url.trim() === preset.url.trim())
            );
            const isOperating = mountingPresetId === preset.id;

            return (
              <div
                key={preset.id}
                className={`flex flex-col justify-between p-3.5 rounded-2xl glass-surface border transition-all gap-2.5 ${
                  isMounted
                    ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/10"
                    : "border-[var(--glass-border-subtle)] hover:border-blue-500/30"
                }`}
              >
                {/* 顶栏: 类别 + 标题 + 状态/操作按钮 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-black/5 dark:bg-white/10 text-[var(--text-secondary)]">
                        {preset.category}
                      </span>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">
                        {preset.title}
                      </h4>
                      <span className="text-[10px] font-mono text-[var(--text-muted)]">
                        ({preset.name})
                      </span>
                    </div>

                    <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2">
                      {preset.description}
                    </p>
                  </div>

                  {/* 挂载/卸载按钮 (严禁折行断字) */}
                  <button
                    type="button"
                    disabled={isOperating}
                    onClick={() => handleTogglePreset(preset)}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap ${
                      isMounted
                        ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30"
                        : "bg-black/5 dark:bg-white/10 border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-primary)] hover:text-blue-500"
                    }`}
                    title={
                      isMounted
                        ? "已挂载生效，点击可一键从内核移除"
                        : "一键挂载到内核路由"
                    }
                  >
                    {isMounted ? (
                      <>
                        <svg
                          className="w-3 h-3 text-emerald-500 group-hover:text-rose-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <span>{isOperating ? "处理中" : "已挂载"}</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4v16m8-8H4"
                          />
                        </svg>
                        <span>{isOperating ? "挂载中" : "一键装载"}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 底栏: 预估条目 + 默认出口 + 格式 */}
                <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border-subtle)] text-[10px] text-[var(--text-muted)] font-mono">
                  <div className="flex items-center gap-2">
                    <span>
                      预估约{" "}
                      <strong className="text-[var(--text-primary)] tabular-nums">
                        {preset.ruleCount.toLocaleString()}
                      </strong>{" "}
                      条
                    </span>
                    <span>·</span>
                    <span>源: {preset.source}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/5 text-[9px]">
                      {preset.format.toUpperCase()}
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 text-[9px] font-semibold">
                      → {preset.target_proxy}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 自定义添加模态弹窗 */}
      <AddRuleProviderModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddCustomProvider}
      />
    </div>
  );
};
