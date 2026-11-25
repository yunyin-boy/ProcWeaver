import React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../../primitives/Button";
import { ROUTING_MODES } from "../../primitives/RoutingModeControl";
import type { EngineMode } from "../../types/core";
import type { RulesSubTab } from "../../types/rules";

interface RulesToolbarProps {
  currentSubTab: RulesSubTab;
  onSelectSubTab: (tab: RulesSubTab) => void;
  routingMode: EngineMode;
  totalRuleCount: number;
  totalProviderCount: number;
  onRefreshAll: () => void;
  isRefreshing: boolean;
  isPreview: boolean;
}

export const RulesToolbar: React.FC<RulesToolbarProps> = ({
  currentSubTab,
  onSelectSubTab,
  routingMode,
  totalRuleCount,
  totalProviderCount,
  onRefreshAll,
  isRefreshing,
  isPreview,
}) => {
  const tabs = [
    { id: "active", label: "分流规则", count: totalRuleCount },
    { id: "providers", label: "外部规则集", count: totalProviderCount },
    { id: "simulator", label: "路由试算" },
  ] as const;
  const mode = ROUTING_MODES.find((option) => option.id === routingMode)?.label ?? routingMode;

  return (
    <section className="workbench-panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4" aria-label="规则工具区">
      <div className="workbench-segments workbench-rule-tabs max-w-full flex-wrap" role="group" aria-label="规则视图">
        {tabs.map((tab) => (
          <button type="button" key={tab.id} aria-pressed={currentSubTab === tab.id} onClick={() => onSelectSubTab(tab.id)}>
            {tab.label}
            {"count" in tab && <span className="text-[11px] tabular-nums">{tab.count.toLocaleString()}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-xs text-[var(--text-muted)]">分流模式</span>
          <strong className="text-sm">{mode}</strong>
          {isPreview && <span className="text-xs text-[var(--text-muted)]">模拟数据</span>}
        </div>
        <Button type="button" onClick={onRefreshAll} loading={isRefreshing}>
          {!isRefreshing && <RefreshCw size={14} aria-hidden="true" />}
          {isRefreshing ? "读取中…" : "刷新状态"}
        </Button>
      </div>

    </section>
  );
};
