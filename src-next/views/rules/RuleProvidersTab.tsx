import React, { useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../primitives/Button";
import {
  updateRuleProvider,
  addExternalRuleProvider,
  removeExternalRuleProvider,
  PRESET_RULE_PROVIDERS,
  type PresetProviderItem,
} from "../../services/rulesService";
import type { RuleProviderItem } from "../../types/rules";
import { AddRuleProviderModal } from "./AddRuleProviderModal";

interface RuleProvidersTabProps {
  providers: RuleProviderItem[];
  onRefreshList: () => Promise<boolean>;
  onShowNotice?: (msg: string) => void;
}

export const RuleProvidersTab: React.FC<RuleProvidersTabProps> = ({ providers, onRefreshList, onShowNotice }) => {
  const [pendingAction, setPendingAction] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const activeProviders = providers.filter((provider) => provider.loaded);
  const totalRules = activeProviders.reduce((count, provider) => count + provider.ruleCount, 0);

  const runAction = async (key: string, action: () => Promise<void>, success: string) => {
    if (pendingAction) return;
    setPendingAction(key);
    try {
      await action();
      await onRefreshList();
      onShowNotice?.(success);
    } catch (error) {
      onShowNotice?.("规则集操作失败，" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPendingAction("");
    }
  };

  const refreshAll = async () => {
    await runAction("all", async () => {
      for (const provider of activeProviders) await updateRuleProvider(provider.name);
    }, "已刷新 " + activeProviders.length + " 个规则集");
  };

  const togglePreset = (preset: PresetProviderItem, existing?: RuleProviderItem) => runAction(
    "preset:" + preset.id,
    () => existing ? removeExternalRuleProvider(existing.name) : addExternalRuleProvider({
      name: preset.name,
      url: preset.url,
      behavior: preset.behavior,
      format: preset.format,
      type: "Rule",
      vehicleType: "HTTP",
      ruleCount: preset.ruleCount,
      targetProxy: preset.target_proxy,
    }),
    (existing ? "已移除本地规则集 " : "已保存本地规则集 ") + preset.title,
  );

  const addCustomProvider = async (provider: Omit<RuleProviderItem, "ruleCount">) => {
    await addExternalRuleProvider(provider);
    await onRefreshList();
    onShowNotice?.("已保存本地规则集 " + provider.name);
  };

  return (
    <div className="grid min-w-0 gap-4">
      <section className="workbench-panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4" aria-label="规则集操作">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <strong className="text-sm tabular-nums">{providers.length} 个规则集</strong>
          <span className="text-xs tabular-nums text-[var(--text-muted)]">
            已载入 {activeProviders.length} 个 · {totalRules.toLocaleString()} 条
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={refreshAll} loading={pendingAction === "all"} disabled={Boolean(pendingAction) || !activeProviders.length}>
            {pendingAction !== "all" && <RefreshCw size={14} aria-hidden="true" />}
            {pendingAction === "all" ? "刷新中…" : "刷新全部"}
          </Button>
          <Button type="button" variant="primary" onClick={() => setIsAddModalOpen(true)} disabled={Boolean(pendingAction)}>
            <Plus size={15} aria-hidden="true" />添加规则集
          </Button>
        </div>
      </section>

      <details className="workbench-panel min-w-0 p-4">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-md [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold">预设规则集</span>
          <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            {PRESET_RULE_PROVIDERS.length} 个预设<ChevronDown size={14} aria-hidden="true" />
          </span>
        </summary>
        <div className="workbench-provider-presets mt-4">
          {PRESET_RULE_PROVIDERS.map((preset) => {
            const existing = providers.find((provider) => provider.managed && (
              provider.name.toLowerCase() === preset.name.toLowerCase() || provider.url?.trim() === preset.url.trim()
            ));
            return (
              <article key={preset.id} className="grid min-w-0 gap-2 rounded-lg bg-[var(--workbench-row-hover)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid min-w-0 gap-1">
                    <h3 className="text-[13px] font-semibold [overflow-wrap:anywhere]">{preset.title}</h3>
                    <span className="text-xs text-[var(--text-muted)]">{preset.category} · {preset.source}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={existing ? "ghost" : "secondary"}
                    loading={pendingAction === "preset:" + preset.id}
                    disabled={Boolean(pendingAction)}
                    onClick={() => void togglePreset(preset, existing)}
                  >
                    {existing ? "移除预设" : "添加预设"}
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">{preset.description}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                  <span>{preset.format.toUpperCase()}</span><span>约 {preset.ruleCount.toLocaleString()} 条</span>
                  <span>出口 {preset.target_proxy}</span>
                  {existing && <span className="workbench-tag workbench-tag-positive">已保存</span>}
                </div>
              </article>
            );
          })}
        </div>
      </details>

      <section className="grid min-w-0 gap-3" aria-label="外部规则集列表">
        {providers.length === 0 ? (
          <p className="workbench-panel p-5 text-sm text-[var(--text-muted)]">暂无规则集，可添加订阅地址或选用上方预设。</p>
        ) : providers.map((provider) => (
          <article key={provider.name} className="workbench-panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{provider.name}</h3>
                <span className={"workbench-tag " + (provider.loaded ? "workbench-tag-positive" : "")}>
                  {provider.loaded ? "已载入" : provider.loaded === false ? "已保存，未载入" : "已保存，载入状态不可用"}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>{provider.managed ? "本地配置" : "订阅规则集"}</span>
                <span className="font-mono">{provider.behavior.toUpperCase()} · {provider.format.toUpperCase()}</span>
                {provider.loaded && <span className="tabular-nums">{provider.ruleCount.toLocaleString()} 条</span>}
                {provider.updatedAt && <span>更新于 {provider.updatedAt}</span>}
              </div>
              {provider.url && <p className="truncate text-xs text-[var(--text-muted)]" title={provider.url}>{provider.url}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {provider.loaded && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void runAction("refresh:" + provider.name, () => updateRuleProvider(provider.name), "已刷新规则集 " + provider.name)}
                  loading={pendingAction === "refresh:" + provider.name}
                  disabled={Boolean(pendingAction)}
                >
                  刷新
                </Button>
              )}
              {provider.managed && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="hover:!bg-[var(--workbench-danger-bg)] hover:!text-[var(--workbench-danger)]"
                  onClick={() => void runAction("remove:" + provider.name, () => removeExternalRuleProvider(provider.name), "已移除本地规则集 " + provider.name)}
                  loading={pendingAction === "remove:" + provider.name}
                  disabled={Boolean(pendingAction)}
                >
                  移除
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>

      <AddRuleProviderModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addCustomProvider} />
    </div>
  );
};
