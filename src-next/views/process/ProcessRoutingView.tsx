// ==========================================================================
// ProcWeaver src-next 进程分流主盘视图容器 (Process Routing View)
// 规范溯源: tauri-desktop-layout-typography / typography-dark-mono-optics / taste-skill
// 架构特性: 子 Tab 结构 (业务规则包 / 自定义进程 / 实时活跃进程)
// ==========================================================================

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ProcessBundleItem,
  ProcessRuleItem,
  LiveProcessItem,
  ProcessRoutingState,
  ProcessTrafficDriver,
} from "../../types/processRouting";
import {
  fetchProcessRoutingState,
  saveProcessRoutingState,
  switchProcessDriver,
  elevateAdmin,
  fetchBundles,
  createBundle,
  updateBundleInstance,
  deleteBundle,
  resetBundleToDefault,
  fetchProcessRules,
  addProcessRule,
  updateProcessRule,
  deleteProcessRule,
  fetchLiveProcesses,
  routeLiveProcess,
  validateAndParsePwPack,
  importBundleItem,
  exportBundleToPwPack,
  cleanProxyOptions,
  syncRoutingToCore,
  launchBundleApp,
} from "../../services/processRoutingService";
import { fetchProxiesData } from "../../services/proxyService";

import { ProcessToolbar, ProcessSubTab } from "./ProcessToolbar";
import { BundleCard } from "./BundleCard";
import { ProcessRuleRow } from "./ProcessRuleRow";
import { LiveProcessList } from "./LiveProcessList";
import { AddProcessRuleModal } from "./AddProcessRuleModal";
import { ProcessBundleModal, BundleFormData } from "./ProcessBundleModal";
import { OfficialBundleModal } from "./OfficialBundleModal";
import { OutletPickerModal } from "./OutletPickerModal";
import { ConfirmModal } from "../../primitives/ConfirmModal";

interface ProcessRoutingViewProps {
  onShowNotice?: (msg: string) => void;
}

export const ProcessRoutingView: React.FC<ProcessRoutingViewProps> = ({ onShowNotice }) => {
  // 1. 全局分流总控状态
  const [state, setState] = useState<ProcessRoutingState>({
    bundlesEnabled: false,
    processEnabled: false,
    driverActive: false,
    engineMode: "app_proxy",
    activeDriverName: "app_proxy",
    isAdmin: false,
    activeProcessCount: 0,
    totalBundleCount: 0,
    totalRuleCount: 0,
  });
  const [isPending, setIsPending] = useState(false);

  // 2. 子 Tab 切换状态与搜索过滤
  const [subTab, setSubTab] = useState<ProcessSubTab>("bundles");
  const [searchQuery, setSearchQuery] = useState("");

  // 3. 数据载体
  const [bundles, setBundles] = useState<ProcessBundleItem[]>([]);
  const [rules, setRules] = useState<ProcessRuleItem[]>([]);
  const [liveProcesses, setLiveProcesses] = useState<LiveProcessItem[]>([]);
  const [availableProxies, setAvailableProxies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingLive, setIsRefreshingLive] = useState(false);

  // 4. 模态弹窗开关 (统一进程分流/业务套件弹窗)
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOfficialModal, setShowOfficialModal] = useState(false);
  const [bundleToDelete, setBundleToDelete] = useState<ProcessBundleItem | null>(null);
  const [isDeletingBundle, setIsDeletingBundle] = useState(false);
  const [outletPickerBundle, setOutletPickerBundle] = useState<ProcessBundleItem | null>(null);
  const [bundleModalState, setBundleModalState] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    bundle: ProcessBundleItem | null;
  }>({
    isOpen: false,
    mode: "create",
    bundle: null,
  });

  // 装载官方预设业务规则包
  const handleInstallOfficialPreset = async (preset: ProcessBundleItem) => {
    if (bundles.some((b) => b.id === preset.id || b.name === preset.name)) {
      onShowNotice?.(`业务套件 [${preset.name}] 已在列表中`);
      return;
    }
    const updated = await createBundle({
      name: preset.name,
      description: preset.description,
      mainExe: preset.mainExe,
      exes: [...preset.exes],
      enabled: true,
      targetProxy: "",
      mode: preset.mode,
      fallback: preset.fallback,
      domains: [...preset.domains],
      policy: { ...preset.policy },
    });
    setBundles(updated);
    setState((prev) => ({ ...prev, totalBundleCount: updated.length }));
  };

  // 5. 初始化加载大盘全量数据
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [routingState, bundleList, ruleList, liveList, proxySnap] = await Promise.all([
        fetchProcessRoutingState(),
        fetchBundles(),
        fetchProcessRules(),
        fetchLiveProcesses(),
        fetchProxiesData(),
      ]);

      setState(routingState);
      setBundles(bundleList);
      setRules(ruleList);
      setLiveProcesses(liveList);

      // 提取并严格清洗所有可用出站节点和主要策略组 (剔除系统内部保留字)
      const cleaned = cleanProxyOptions(proxySnap.proxies || {});
      const proxyNames = cleaned.map((c) => c.value);
      setAvailableProxies(proxyNames);

      // 启动自愈核验：核对底层 routing-overrides.json 中的真实出口绑定，避免默认占位覆盖底层实际配置
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const view = await invoke<any>("get_routing_overrides");
        const coreBundles = view?.config?.bundles || [];
        let hasChanges = false;
        for (const cb of coreBundles) {
          const coreTarget = cb.mainTarget?.name;
          if (coreTarget && !coreTarget.startsWith("PW-") && !coreTarget.startsWith("本地方案")) {
            const b = bundleList.find((item) => item.id === cb.id);
            if (b && (!b.targetProxy || b.targetProxy === "Proxy" || b.targetProxy === "自动选择")) {
              b.targetProxy = coreTarget;
              hasChanges = true;
            }
          }
        }
        if (hasChanges) {
          await syncRoutingToCore(bundleList, ruleList);
        }
      } catch (syncErr: any) {
        console.warn("[ProcessRoutingView] initial syncRoutingToCore auto-heal warning:", syncErr);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 监听全局分流总控变更事件，保持多视图多组件实时一致
  useEffect(() => {
    const handleMasterChanged = (e: any) => {
      const enabled = Boolean(e?.detail);
      setState((prev) => ({ ...prev, processEnabled: enabled, bundlesEnabled: enabled }));
    };
    window.addEventListener("netbox-process-master-changed", handleMasterChanged);
    return () => {
      window.removeEventListener("netbox-process-master-changed", handleMasterChanged);
    };
  }, []);

  // 6. 切换进程分流全局总控
  const handleToggleMaster = async () => {
    if (isPending) return;
    setIsPending(true);

    const nextEnabled = !state.processEnabled;
    const nextState = { ...state, processEnabled: nextEnabled, bundlesEnabled: nextEnabled };

    try {
      await saveProcessRoutingState(nextState);
      setState(nextState);
      if (onShowNotice) {
        onShowNotice(nextEnabled ? "进程分流全局拦截已启用" : "进程分流全局拦截已暂停");
      }
    } catch (err: any) {
      console.error("[ProcessRoutingView] handleToggleMaster error:", err);
      if (onShowNotice) {
        onShowNotice(`切换分流总控失败: ${err?.message || err}`);
      }
    } finally {
      setIsPending(false);
    }
  };

  // 6.1 切换进程分流驱动 (选项 A: 沉浸紧凑毛玻璃下拉，不加 TUN)
  const handleSwitchDriver = async (driver: ProcessTrafficDriver) => {
    try {
      const nextState = await switchProcessDriver(driver);
      setState(nextState);
      const optName =
        driver === "windivert_v1"
          ? "WinDivert 内核强锁"
          : driver === "user_mode"
          ? "用户态 Hook 注入"
          : "纯应用层代理";
      if (onShowNotice) {
        onShowNotice(`已切换分流驱动为: ${optName}`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`切换驱动失败: ${e?.message || e}`);
      }
    }
  };

  // 6.2 调起系统 UAC 提权以挂载 WinDivert 内核驱动
  const handleElevateAdmin = async () => {
    try {
      await elevateAdmin();
      if (onShowNotice) {
        onShowNotice("正在调起系统 UAC 提权重启...");
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`提权失败: ${e?.message || e}`);
      }
    }
  };

  // 6.3 受控启动业务套件 (Hook 注入启动保障)
  const handleLaunchBundle = async (bundle: ProcessBundleItem) => {
    try {
      const res = await launchBundleApp(bundle.id);
      if (onShowNotice) {
        onShowNotice(res?.message || `已成功受控启动业务套件: ${bundle.name}`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`受控启动失败: ${e?.message || e}`);
      }
    }
  };

  // 6.4 受控启动自定进程规则 (Hook 注入 / WinDivert 透明接管)
  const handleLaunchRule = async (rule: ProcessRuleItem) => {
    try {
      const res = await launchBundleApp(rule.id);
      if (onShowNotice) {
        onShowNotice(res?.message || `已成功受控启动进程: ${rule.label}`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`受控启动失败: ${e?.message || e}`);
      }
    }
  };

  // 7. 业务规则包启停与出口插槽变更
  const handleToggleBundle = async (bundleId: string, enabled: boolean) => {
    try {
      const updated = await updateBundleInstance(bundleId, { enabled });
      setBundles(updated);
      // 智能联动：如果用户开启了业务套件且当前总控处于关闭状态，自动点亮总控状态
      if (enabled && !state.processEnabled) {
        const nextState = { ...state, processEnabled: true, bundlesEnabled: true };
        setState(nextState);
        await saveProcessRoutingState(nextState);
      }
      if (onShowNotice) {
        const b = updated.find((item) => item.id === bundleId);
        onShowNotice(
          enabled
            ? `已启用业务规则包: ${b?.name}（分流已联动激活）`
            : `已暂停业务规则包: ${b?.name}`
        );
      }
    } catch (e: any) {
      console.error("[ProcessRoutingView] handleToggleBundle error:", e);
      if (onShowNotice) {
        onShowNotice(`切换业务规则包失败: ${e?.message || e}`);
      }
    }
  };

  const handleChangeBundleProxy = async (bundleId: string, proxy: string) => {
    try {
      const updated = await updateBundleInstance(bundleId, { targetProxy: proxy });
      setBundles(updated);
      if (onShowNotice) {
        onShowNotice(`业务规则包已切换出口: ${proxy}（生效中，建议重启目标应用清理长连接）`);
      }
    } catch (err: any) {
      console.error("[ProcessRoutingView] handleChangeBundleProxy error:", err);
      if (onShowNotice) {
        onShowNotice(`绑定出口失败: ${err?.message || err}`);
      }
      loadData();
    }
  };

  const handleToggleBundleSubprocesses = async (bundleId: string, proxySubprocesses: boolean) => {
    const b = bundles.find((item) => item.id === bundleId);
    if (!b) return;
    const updated = await updateBundleInstance(bundleId, {
      policy: { ...b.policy, proxySubprocesses },
    });
    setBundles(updated);
  };

  const handleDeleteBundle = async (bundleId: string) => {
    try {
      const target = bundles.find((item) => item.id === bundleId);
      const updated = await deleteBundle(bundleId);
      setBundles(updated);
      setState((prev) => ({ ...prev, totalBundleCount: updated.length }));
      if (onShowNotice) {
        onShowNotice(`已彻底移除业务规则包: ${target?.name || bundleId}`);
      }
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`删除业务规则包失败: ${e?.message || e}`);
      }
    }
  };

  // 7.1 统一保存业务套件 (同一模态弹窗: 支持新建与编辑更新)
  const handleSaveBundleForm = async (data: BundleFormData) => {
    try {
      if (bundleModalState.mode === "create") {
        const updated = await createBundle({
          name: data.name,
          description: data.description,
          mainExe: data.mainExe,
          exes: data.exes,
          enabled: true,
          targetProxy: data.targetProxy,
          mode: data.mode,
          fallback: data.fallback,
          domains: data.domains,
          policy: data.policy,
        });
        setBundles(updated);
        setState((prev) => ({ ...prev, totalBundleCount: updated.length }));
        if (onShowNotice) {
          onShowNotice(`业务套件 [${data.name}] 已成功创建并生效`);
        }
      } else if (bundleModalState.bundle) {
        const updated = await updateBundleInstance(bundleModalState.bundle.id, {
          name: data.name,
          description: data.description,
          mainExe: data.mainExe,
          exes: data.exes,
          targetProxy: data.targetProxy,
          mode: data.mode,
          fallback: data.fallback,
          domains: data.domains,
          policy: data.policy,
        });
        setBundles(updated);
        if (onShowNotice) {
          onShowNotice(`业务套件 [${data.name}] 已更新并生效`);
        }
      }
    } catch (err: any) {
      console.error("[ProcessRoutingView] handleSaveBundleForm error:", err);
      if (onShowNotice) {
        onShowNotice(`保存失败: ${err?.message || err}`);
      }
    }
  };

  // 7.2 业务规则包安全脱敏导入与导出
  const handleImportBundleFile = async (file: File) => {
    try {
      const text = await file.text();
      const res = validateAndParsePwPack(text);
      if (!res.valid || !res.bundle) {
        onShowNotice?.(`导入失败: ${res.error || "规则包格式不合法"}`);
        return;
      }
      const updated = await importBundleItem(res.bundle);
      setBundles(updated);
      setState((prev) => ({ ...prev, totalBundleCount: updated.length }));
      onShowNotice?.(`业务套件 [${res.bundle.name}] 导入成功，已就绪`);
    } catch (err: any) {
      onShowNotice?.(`规则包读取失败: ${err?.message || err}`);
    }
  };

  const handleExportBundle = (bundle: ProcessBundleItem) => {
    exportBundleToPwPack(bundle);
    onShowNotice?.(`已导出脱敏纯净规则包: ${bundle.name}.pwpack.json`);
  };

  // 顶部工具栏右侧按钮调度 (智能情境感知)
  const handleOpenToolbarAction = () => {
    if (subTab === "bundles") {
      setBundleModalState({
        isOpen: true,
        mode: "create",
        bundle: null,
      });
    } else {
      setShowAddModal(true);
    }
  };

  // 7.2 恢复官方出厂默认预设
  const handleResetBundlePreset = async (bundleId: string) => {
    const updated = await resetBundleToDefault(bundleId);
    setBundles(updated);
    if (onShowNotice) {
      onShowNotice("已恢复为官方默认预设规则");
    }
  };

  // 8. 自定义规则管理
  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    const updated = await updateProcessRule(ruleId, { enabled });
    setRules(updated);
  };

  const handleDeleteRule = async (ruleId: string) => {
    const updated = await deleteProcessRule(ruleId);
    setRules(updated);
    if (onShowNotice) onShowNotice("已删除该条进程分流规则");
  };

  const handleAddRule = async (newRule: Omit<ProcessRuleItem, "id" | "createdAt">) => {
    const updated = await addProcessRule(newRule);
    setRules(updated);
    if (onShowNotice) onShowNotice(`已添加进程规则: ${newRule.label}`);
  };

  // 9. 实时活跃进程操作与刷新
  const handleRefreshLive = async () => {
    setIsRefreshingLive(true);
    try {
      const list = await fetchLiveProcesses();
      setLiveProcesses(list);
    } finally {
      setIsRefreshingLive(false);
    }
  };

  const handleRouteLiveProcess = async (proc: LiveProcessItem, action: "proxy" | "direct") => {
    const updated = await routeLiveProcess(proc, action);
    setRules(updated);

    // 乐观更新活跃进程状态
    setLiveProcesses((prev) =>
      prev.map((p) =>
        p.pid === proc.pid
          ? {
              ...p,
              isRouted: true,
              matchedRuleName: proc.name,
              matchedProxy: action === "proxy" ? "Proxy" : "DIRECT 直连",
            }
          : p
      )
    );

    if (onShowNotice) {
      onShowNotice(action === "proxy" ? `已将 ${proc.name} 加入代理分流` : `已将 ${proc.name} 设为国内直连`);
    }
  };

  // 10. 搜索过滤计算
  const filteredBundles = useMemo(() => {
    if (!searchQuery.trim()) return bundles;
    const q = searchQuery.toLowerCase().trim();
    return bundles.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.exes.some((exe) => exe.toLowerCase().includes(q))
    );
  }, [bundles, searchQuery]);

  const filteredRules = useMemo(() => {
    if (!searchQuery.trim()) return rules;
    const q = searchQuery.toLowerCase().trim();
    return rules.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.matchValue.toLowerCase().includes(q) ||
        (r.targetProxy && r.targetProxy.toLowerCase().includes(q))
    );
  }, [rules, searchQuery]);

  const filteredLiveProcesses = useMemo(() => {
    if (!searchQuery.trim()) return liveProcesses;
    const q = searchQuery.toLowerCase().trim();
    return liveProcesses.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.pid.toString().includes(q) ||
        (p.path && p.path.toLowerCase().includes(q))
    );
  }, [liveProcesses, searchQuery]);

  return (
    <div className="space-y-4 pb-12">
      {/* 顶部主控工具栏与子 Tab 调度器 */}
      <ProcessToolbar
        currentSubTab={subTab}
        onSelectSubTab={setSubTab}
        state={state}
        onToggleMaster={handleToggleMaster}
        onSwitchDriver={handleSwitchDriver}
        onElevateAdmin={handleElevateAdmin}
        isPending={isPending}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenAddModal={handleOpenToolbarAction}
        onImportBundle={handleImportBundleFile}
        onOpenOfficialModal={() => setShowOfficialModal(true)}
      />

      {/* 视图内容区 */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] animate-pulse">
          正在加载进程分流规则与应用强锁套件...
        </div>
      ) : (
        <div>
          {/* 子 Tab 1：业务规则包 (Business Bundles) */}
          {subTab === "bundles" && (
            <div className="space-y-3">
              <div className="px-1 text-xs text-[var(--text-muted)]">
                官方核心业务套件 (严格遵循脱敏规范，直达进程并强锁专属出口插槽)
              </div>

              {filteredBundles.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)] glass-surface rounded-2xl border border-[var(--glass-border-subtle)]">
                  未找到符合搜索条件的业务规则包
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredBundles.map((bundle) => (
                    <BundleCard
                      key={bundle.id}
                      bundle={bundle}
                      isGlobalActive={state.processEnabled && state.driverActive}
                      globalStatusHint={
                        !state.processEnabled
                          ? "进程分流全局总控已暂停，请开启顶栏总控"
                          : state.engineMode === "windivert_v1" && !state.isAdmin
                          ? "WinDivert 驱动需管理员特权，请点击顶栏进行 UAC 提权"
                          : "分流拦截尚未就绪"
                      }
                      onToggleEnabled={(enabled) => handleToggleBundle(bundle.id, enabled)}
                      onOpenOutletPicker={() => setOutletPickerBundle(bundle)}
                      onToggleSubprocesses={(enabled) =>
                        handleToggleBundleSubprocesses(bundle.id, enabled)
                      }
                      onEdit={() =>
                        setBundleModalState({
                          isOpen: true,
                          mode: "edit",
                          bundle,
                        })
                      }
                      onExport={handleExportBundle}
                      onDelete={(id) => {
                        const target = bundles.find((b) => b.id === id);
                        if (target) setBundleToDelete(target);
                      }}
                      onLaunch={handleLaunchBundle}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 子 Tab 2：自定义单进程分流 (Custom Process Rules) */}
          {subTab === "rules" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
                <span>用户自选程序进程规则列表 (共 {filteredRules.length} 条有效规则)</span>
                <span className="font-mono text-[10px]">WinDivert 纳管匹配优先级高于默认路由</span>
              </div>

              {filteredRules.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)] glass-surface rounded-2xl border border-[var(--glass-border-subtle)]">
                  暂无自选进程规则，点击右上角【添加进程规则】新建
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRules.map((rule) => (
                    <ProcessRuleRow
                      key={rule.id}
                      rule={rule}
                      onToggleEnabled={(enabled) => handleToggleRule(rule.id, enabled)}
                      onDelete={() => handleDeleteRule(rule.id)}
                      onLaunch={handleLaunchRule}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 子 Tab 3：实时活跃联网进程嗅探 (Live Network Processes) */}
          {subTab === "live" && (
            <LiveProcessList
              processes={filteredLiveProcesses}
              onRouteProcess={handleRouteLiveProcess}
              onRefresh={handleRefreshLive}
              isRefreshing={isRefreshingLive}
            />
          )}
        </div>
      )}

      {/* 添加进程规则模态浮窗 */}
      <AddProcessRuleModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddRule={handleAddRule}
        availableProxies={availableProxies}
      />

      {/* 统一进程分流/业务套件模态弹窗 (同一模态弹窗: 支持新建与编辑) */}
      <ProcessBundleModal
        isOpen={bundleModalState.isOpen}
        mode={bundleModalState.mode}
        bundle={bundleModalState.bundle}
        availableProxies={availableProxies}
        onClose={() => setBundleModalState({ isOpen: false, mode: "create", bundle: null })}
        onSave={handleSaveBundleForm}
        onResetPreset={handleResetBundlePreset}
      />

      {/* 官方业务规则包中心与 GitHub 规则仓库模态窗 */}
      <OfficialBundleModal
        isOpen={showOfficialModal}
        onClose={() => setShowOfficialModal(false)}
        existingBundles={bundles}
        onInstallPreset={handleInstallOfficialPreset}
        onShowNotice={onShowNotice}
      />

      {/* 业务规则包彻底删除微晶确认模态窗 (替代原生 window.confirm) */}
      <ConfirmModal
        isOpen={!!bundleToDelete}
        title="彻底删除业务规则包？"
        description={
          <>
            确定要彻底删除业务规则包{" "}
            <span className="font-semibold text-[var(--text-primary)]">
              [{bundleToDelete?.name}]
            </span>{" "}
            吗？删除后相关进程将不再受此强锁拦截，底层路由规则将立即同步注销。
          </>
        }
        confirmText="彻底删除"
        cancelText="取消"
        variant="danger"
        isLoading={isDeletingBundle}
        onCancel={() => setBundleToDelete(null)}
        onConfirm={async () => {
          if (!bundleToDelete) return;
          setIsDeletingBundle(true);
          try {
            await handleDeleteBundle(bundleToDelete.id);
            setBundleToDelete(null);
          } finally {
            setIsDeletingBundle(false);
          }
        }}
      />

      {/* 业务分流专属出口选择模态弹窗 (模式 B: 单击高亮选中，确认换绑后正式生效) */}
      <OutletPickerModal
        isOpen={Boolean(outletPickerBundle)}
        onClose={() => setOutletPickerBundle(null)}
        bundleName={outletPickerBundle?.name}
        currentProxy={outletPickerBundle?.targetProxy || ""}
        availableProxies={availableProxies}
        onConfirm={(newProxy) => {
          if (outletPickerBundle) {
            handleChangeBundleProxy(outletPickerBundle.id, newProxy);
          }
          setOutletPickerBundle(null);
        }}
      />
    </div>
  );
};
