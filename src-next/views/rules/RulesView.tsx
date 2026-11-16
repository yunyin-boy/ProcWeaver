// ==========================================================================
// ProcWeaver src-next 业务规则编织系统主盘视图容器 (Rules View)
// 规范溯源: tauri-desktop-layout-typography / typography-dark-mono-optics / taste-skill
// 风格约束: 严禁任何 Emoji，全量采用内联 SVG 与工业级高密度排版
// ==========================================================================

import React, { useState, useEffect, useCallback } from "react";
import { RuleItem, RuleProviderItem, RulesSubTab } from "../../types/rules";
import {
  fetchRules,
  fetchRuleProviders,
} from "../../services/rulesService";
import { getCoreStatus, setEngineMode } from "../../services/coreService";
import { EngineMode } from "../../types/core";
import { isTauriEnvironment } from "../../services/client";

import { RulesToolbar } from "./RulesToolbar";
import { ActiveRulesTab } from "./ActiveRulesTab";
import { RuleProvidersTab } from "./RuleProvidersTab";
import { RouteSimulatorTab } from "./RouteSimulatorTab";

interface RulesViewProps {
  onShowNotice?: (msg: string) => void;
}

export const RulesView: React.FC<RulesViewProps> = ({ onShowNotice }) => {
  const [subTab, setSubTab] = useState<RulesSubTab>("active");
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [providers, setProviders] = useState<RuleProviderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [engineMode, setEngineModeState] = useState<EngineMode>("rule");
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [rulesList, providersList, coreStatus] = await Promise.all([
        fetchRules(),
        fetchRuleProviders(),
        getCoreStatus().catch(() => null),
      ]);
      setRules(rulesList);
      setProviders(providersList);
      if (coreStatus?.mode) {
        setEngineModeState(coreStatus.mode);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadData();
  }, [loadData]);

  // 全量重新同步
  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    await loadData();
    if (onShowNotice) {
      onShowNotice("分流规则链与外部规则集已完成全量同步");
    }
  };

  // 快捷切换至智能规则分流模式 (RULE)
  const handleSwitchToRule = async () => {
    setIsSwitchingMode(true);
    try {
      await setEngineMode("rule");
      setEngineModeState("rule");
      if (onShowNotice) {
        onShowNotice("已切换为智能分流模式 (RULE)，全量分流规则与国内直连已恢复生效");
      }
      await loadData();
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`切换分流模式失败: ${e?.message || e}`);
      }
    } finally {
      setIsSwitchingMode(false);
    }
  };

  const isTauri = isTauriEnvironment();

  return (
    <div className="space-y-4 pb-12">
      {/* 顶部主控工具栏 */}
      <RulesToolbar
        currentSubTab={subTab}
        onSelectSubTab={setSubTab}
        totalRuleCount={rules.length}
        totalProviderCount={providers.length}
        onRefreshAll={handleRefreshAll}
        isRefreshing={isRefreshing}
      />

      {/* 非 RULE 模式下的挂起提示横幅 (消除用户对仅 14 条规则的困惑) */}
      {engineMode === "global" && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>
              当前处于 <strong>GLOBAL 全局代理</strong> 模式：常规分流规则与国内直连集已挂起，所有未直连流量均走全局出口。
            </span>
          </div>
          <button
            type="button"
            onClick={handleSwitchToRule}
            disabled={isSwitchingMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs active:scale-95 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {isSwitchingMode ? "正在切换..." : "切换为智能规则模式 (RULE)"}
          </button>
        </div>
      )}

      {engineMode === "direct" && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              当前处于 <strong>DIRECT 全局直连</strong> 模式：所有网络流量均直接连入互联网，不经过任何代理出站。
            </span>
          </div>
          <button
            type="button"
            onClick={handleSwitchToRule}
            disabled={isSwitchingMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-xs active:scale-95 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {isSwitchingMode ? "正在切换..." : "切换为智能规则模式 (RULE)"}
          </button>
        </div>
      )}

      {/* 核心工作区 */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] animate-pulse">
          正在从核心解析实时规则链与外部规则集...
        </div>
      ) : (
        <div>
          {subTab === "active" && (
            <ActiveRulesTab rules={rules} onShowNotice={onShowNotice} />
          )}

          {subTab === "providers" && (
            <RuleProvidersTab
              providers={providers}
              onRefreshList={loadData}
              onShowNotice={onShowNotice}
            />
          )}

          {subTab === "simulator" && (
            <RouteSimulatorTab rules={rules} />
          )}
        </div>
      )}

      {/* 底部数据源透明指示栏 (真实联动分流模式) */}
      <div className="flex items-center justify-between px-1 pt-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--glass-border-subtle)] font-mono select-none">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              engineMode === "rule"
                ? "bg-emerald-500"
                : engineMode === "global"
                ? "bg-amber-500"
                : "bg-blue-500"
            }`}
          />
          <span>
            分流模式:{" "}
            {engineMode === "rule"
              ? "RULE 智能路由 (含国内域名与 IP 直连保护)"
              : engineMode === "global"
              ? "GLOBAL 全局代理 (常规分流规则已挂起)"
              : "DIRECT 全局直连 (绕过代理)"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isTauri ? (
            <span className="text-emerald-500 font-semibold">
              ● Tauri 原生核心直连 (真实数据)
            </span>
          ) : (
            <span className="text-amber-500/80">
              ○ 浏览器纯前端开发预览 (仿真模拟模式)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
