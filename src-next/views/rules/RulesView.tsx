import React, { useState, useEffect, useCallback, useRef } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "../../primitives/Button";
import { fetchRules, fetchRuleProviders, fetchCustomRuleWorkbench } from "../../services/rulesService";
import { isTauriEnvironment } from "../../services/client";
import { PROFILE_CHANGED_EVENT } from "../../services/profileService";
import type { EngineMode } from "../../types/core";
import type { RuleItem, RuleProviderItem, RulesSubTab, RuleWorkbenchState } from "../../types/rules";
import { RulesToolbar } from "./RulesToolbar";
import { RulesWorkbench } from "./RulesWorkbench";
import { RuleProvidersTab } from "./RuleProvidersTab";
import { RouteSimulatorTab } from "./RouteSimulatorTab";

interface RulesViewProps {
  routingMode: EngineMode;
  onSwitchToRule: () => Promise<void>;
  onShowNotice?: (msg: string) => void;
}

export const RulesView: React.FC<RulesViewProps> = ({ routingMode, onSwitchToRule, onShowNotice }) => {
  const [subTab, setSubTab] = useState<RulesSubTab>("active");
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [providers, setProviders] = useState<RuleProviderItem[]>([]);
  const [workbench, setWorkbench] = useState<RuleWorkbenchState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [loadError, setLoadError] = useState("");
  const requestId = useRef(0);

  const loadData = useCallback(async () => {
    const id = ++requestId.current;
    const [rulesResult, providersResult, workbenchResult] = await Promise.allSettled([
      fetchRules(), fetchRuleProviders(), fetchCustomRuleWorkbench(),
    ]);
    if (requestId.current !== id) return false;

    const failed: string[] = [];
    if (rulesResult.status === "fulfilled") setRules(rulesResult.value);
    else {
      setRules([]);
      failed.push("分流规则");
    }
    if (providersResult.status === "fulfilled") setProviders(providersResult.value);
    else {
      setProviders([]);
      failed.push("外部规则集");
    }
    if (workbenchResult.status === "fulfilled") setWorkbench(workbenchResult.value);
    else {
      setWorkbench(null);
      failed.push("自定义规则");
    }
    setLoadError(failed.length ? "读取" + failed.join("和") + "失败，可刷新状态重试。" : "");
    setIsLoading(false);
    return failed.length === 0;
  }, []);

  useEffect(() => { void loadData(); }, [loadData, routingMode]);

  useEffect(() => {
    const reload = () => { void loadData(); };
    window.addEventListener(PROFILE_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, reload);
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (await loadData()) onShowNotice?.("已读取最新规则与规则集");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSwitchToRule = async () => {
    setIsSwitchingMode(true);
    try {
      await onSwitchToRule();
    } finally {
      setIsSwitchingMode(false);
    }
  };

  return (
    <div className="workbench-view workbench-rules">
      <RulesToolbar
        currentSubTab={subTab}
        onSelectSubTab={setSubTab}
        routingMode={routingMode}
        totalRuleCount={rules.length}
        totalProviderCount={providers.length}
        onRefreshAll={handleRefresh}
        isRefreshing={isRefreshing}
        isPreview={!isTauriEnvironment()}
      />

      {routingMode !== "rule" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--workbench-warning-bg)] p-4 text-xs text-[var(--workbench-warning)]">
          <div className="flex min-w-0 items-center gap-2">
            <CircleAlert size={16} className="shrink-0" aria-hidden="true" />
            <p>{routingMode === "global" ? "全局模式已暂停常规分流规则。" : "直连模式下，流量直接连接目标。"}</p>
          </div>
          <Button type="button" onClick={handleSwitchToRule} loading={isSwitchingMode}>切换到规则模式</Button>
        </div>
      )}

      {loadError && (
        <p className="rounded-xl bg-[var(--workbench-warning-bg)] px-4 py-3 text-xs text-[var(--workbench-warning)]" role="status">
          {loadError}
        </p>
      )}

      {isLoading ? (
        <p className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]" role="status">
          <RefreshCw size={15} className="animate-spin" aria-hidden="true" />正在读取规则与规则集…
        </p>
      ) : (
        <>
          {subTab === "active" && (
            <RulesWorkbench rules={rules} context={workbench} mode={routingMode} onShowNotice={onShowNotice}
              onSaved={(next) => { setWorkbench(next); void loadData(); }} />
          )}
          {subTab === "providers" && <RuleProvidersTab providers={providers} onRefreshList={loadData} onShowNotice={onShowNotice} />}
          {subTab === "simulator" && <RouteSimulatorTab rules={rules} onShowNotice={onShowNotice} />}
        </>
      )}
    </div>
  );
};
