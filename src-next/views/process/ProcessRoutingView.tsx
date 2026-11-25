// ==========================================================================
// ProcWeaver src-next 进程分流主盘视图容器 (Process Routing View)
// 规范溯源: tauri-desktop-layout-typography / typography-dark-mono-optics / taste-skill
// 架构特性: 子 Tab 结构 (业务规则包 / 自定义进程 / 实时活跃进程)
// ==========================================================================

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ProcessBundleItem,
  ProcessRuleItem,
  LiveProcessItem,
  ProcessRoutingState,
  ProcessTrafficDriver,
  ProcessCaptureEvidence,
  CaptureConnectionEvidence,
} from "../../types/processRouting";
import {
  fetchProcessRoutingState,
  fetchProcessRoutingEvidence,
  saveProcessRoutingState,
  switchProcessDriver,
  elevateAdmin,
  fetchBundles,
  createBundle,
  updateBundleInstance,
  deleteBundle,
  mountRepositoryPackage,
  fetchProcessRules,
  addProcessRule,
  updateProcessRule,
  deleteProcessRule,
  fetchLiveProcesses,
  routeLiveProcess,
  validateAndParsePwPack,
  importBundleItem,
  exportBundleToPwPack,
  syncRoutingToCore,
  launchBundleApp,
  fetchEntryStates,
  EntryStatusItem,
} from "../../services/processRoutingService";
import { fetchProxiesData } from "../../services/proxyService";
import { invokeCommand, isTauriEnvironment } from "../../services/client";
import { PROFILE_CHANGED_EVENT } from "../../services/profileService";
import type { RoutingTarget } from "../../../src/types/routingOverrides";
import type { RepositoryPackage } from "../../../src/types/bundleRepository";

import { ProcessToolbar, ProcessSubTab } from "./ProcessToolbar";
import { BundleCard } from "./BundleCard";
import { ProcessRuleRow } from "./ProcessRuleRow";
import { CaptureDiagnostics } from "./CaptureDiagnostics";
import { LiveProcessList } from "./LiveProcessList";
import { AddProcessRuleModal } from "./AddProcessRuleModal";
import { ProcessBundleModal, BundleFormData } from "./ProcessBundleModal";
import { GithubBundleModal } from "./GithubBundleModal";
import { OutletPickerModal } from "./OutletPickerModal";
import { Button } from "../../primitives/Button";
import { ConfirmModal } from "../../primitives/ConfirmModal";

interface ProcessRoutingViewProps {
  onShowNotice?: (msg: string) => void;
  captureWarning: string | null;
  onCaptureWarningChange: (message: string | null) => void;
}

export const ProcessRoutingView: React.FC<ProcessRoutingViewProps> = ({
  onShowNotice,
  captureWarning,
  onCaptureWarningChange,
}) => {
  // 1. 全局分流总控状态
  const [state, setState] = useState<ProcessRoutingState>({
    bundlesEnabled: false,
    processEnabled: false,
    driverActive: false,
    engineMode: "app_proxy",
    activeDriverName: "app_proxy",
    isAdmin: false,
    matchedProcessCount: 0,
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
  const [showGithubModal, setShowGithubModal] = useState(false);
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
  const [entryStatusMap, setEntryStatusMap] = useState<Record<string, EntryStatusItem>>({});
  const [unavailableOutlets, setUnavailableOutlets] = useState<string[]>([]);
  const [captureEvidence, setCaptureEvidence] = useState<ProcessCaptureEvidence>();
  const entryRefresh = useRef(0);
  const [restartPrompt, setRestartPrompt] = useState<{
    id: string;
    name: string;
    message: string;
    confirmation: string;
  } | null>(null);
  const [isRestartConfirming, setIsRestartConfirming] = useState(false);
  const proxyLoad = useRef(0);
  const refreshAvailableProxies = useCallback(async () => {
    const request = ++proxyLoad.current;
    try {
      if (isTauriEnvironment()) {
        const view = await invokeCommand<{ targets: RoutingTarget[]; unavailableRules: string[] }>("get_routing_overrides");
        if (request !== proxyLoad.current) return;
        setAvailableProxies(view.targets.map(({ name }) => name));
        setUnavailableOutlets(view.unavailableRules ?? []);
      } else {
        const snapshot = await fetchProxiesData();
        if (request === proxyLoad.current) setAvailableProxies(Object.keys(snapshot.proxies));
      }
    } catch (error) {
      if (request === proxyLoad.current) setAvailableProxies([]);
      console.warn("[ProcessRoutingView] 读取可绑定出口失败", error);
    }
  }, []);

  const refreshEntryStates = useCallback(
    async (bundleList: ProcessBundleItem[], ruleList: ProcessRuleItem[]) => {
      const refresh = ++entryRefresh.current;
      const ids = [
        ...bundleList.filter((b) => b.enabled).map((b) => b.id),
        ...ruleList.filter((r) => r.enabled).map((r) => r.id),
      ];
      if (!ids.length) {
        setEntryStatusMap({});
        return;
      }
      const items = await fetchEntryStates(ids);
      if (refresh !== entryRefresh.current) return;
      const nextMap: Record<string, EntryStatusItem> = {};
      for (const item of items) {
        nextMap[item.instanceId] = item;
      }
      setEntryStatusMap(nextMap);
    },
    []
  );

  const handleMountRepositoryPackage = async (item: RepositoryPackage) => {
    const updated = await mountRepositoryPackage(item);
    setBundles(updated);
    setState((prev) => ({ ...prev, totalBundleCount: updated.length }));
    onShowNotice?.("规则包已挂载，待绑定出口");
  };

  // 5. 初始化加载大盘全量数据
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [routingState, bundleList, ruleList, liveList] = await Promise.all([
        fetchProcessRoutingState(),
        fetchBundles(),
        fetchProcessRules(),
        fetchLiveProcesses(),
        refreshAvailableProxies(),
      ]);

      setState(routingState);
      setBundles(bundleList);
      setRules(ruleList);
      setLiveProcesses(liveList);

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
  }, [refreshAvailableProxies]);

  useEffect(() => {
    loadData();
    const handleProfileChange = () => { void refreshAvailableProxies(); };
    window.addEventListener("netbox-profile-changed", handleProfileChange);
    window.addEventListener(PROFILE_CHANGED_EVENT, handleProfileChange);
    return () => {
      ++proxyLoad.current;
      window.removeEventListener("netbox-profile-changed", handleProfileChange);
      window.removeEventListener(PROFILE_CHANGED_EVENT, handleProfileChange);
    };
  }, [loadData, refreshAvailableProxies]);

  useEffect(() => {
    if (isLoading || isPending) return;
    const watchCapture = state.engineMode === "windivert_v1";
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      if (document.visibilityState === "visible") {
        await Promise.all([
          refreshEntryStates(bundles, rules),
          watchCapture && fetchProcessRoutingEvidence().then((snapshot) => {
            if (cancelled) return;
            setCaptureEvidence(snapshot?.capture);
            if (snapshot) {
              setState((prev) => ({
                ...prev,
                matchedProcessCount: snapshot.matchedProcessCount,
                activeDriverName: snapshot.activeDriverName,
                driverActive: snapshot.activeDriverName === "windivert",
              }));
            }
          }),
        ]);
      }
      if (watchCapture && !cancelled) timer = setTimeout(refresh, 5000);
    };

    if (!watchCapture) setCaptureEvidence(undefined);
    void refresh();
    return () => {
      cancelled = true;
      ++entryRefresh.current;
      clearTimeout(timer);
    };
  }, [bundles, rules, state.engineMode, state.processEnabled, state.bundlesEnabled, isLoading, isPending, refreshEntryStates]);

  const captureByOwner = useMemo(() => {
    const evidence = new Map<string, CaptureConnectionEvidence>();
    if (state.engineMode === "windivert_v1") {
      for (const event of captureEvidence?.recentConnections ?? []) {
        if (event.ruleOwner && !evidence.has(event.ruleOwner)) evidence.set(event.ruleOwner, event);
      }
    }
    return evidence;
  }, [captureEvidence, state.engineMode]);

  const captureOwnerLabels = useMemo(() => new Map([
    ...bundles.map((bundle) => ["bundle:" + bundle.id, bundle.name] as const),
    ...rules.map((rule) => ["rule:" + rule.id, rule.label] as const),
  ]), [bundles, rules]);

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
  const handleSwitchDriver = async (
    driver: ProcessTrafficDriver,
    options?: Parameters<typeof switchProcessDriver>[1],
  ) => {
    if (isPending) return;
    setIsPending(true);
    try {
      const nextState = await switchProcessDriver(driver, options);
      setState(nextState);
      if (nextState.engineMode === "windivert_v1") onCaptureWarningChange(null);
      const optName =
        driver === "windivert_v1"
          ? "WinDivert 驱动"
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
    } finally {
      setIsPending(false);
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

  // 6.3/6.4 统一受控启动与非受控旧实例重启闭环
  const executeControlledLaunch = async (id: string, displayName: string, confirmation?: string | null) => {
    try {
      const res = await launchBundleApp(id, confirmation);
      if (res.state === "windivert_required") {
        onCaptureWarningChange(res.message);
        return;
      }
      if (res?.state === "restart_required" && res?.confirmation) {
        setRestartPrompt({
          id,
          name: displayName,
          message: res.message || `检测到 [${displayName}] 正在运行且尚未受控注入当前出口，是否关闭旧实例并重新启动？`,
          confirmation: res.confirmation,
        });
        return;
      }
      if (onShowNotice) {
        onShowNotice(res?.message || `已成功受控启动: ${displayName}`);
      }
      setTimeout(() => {
        refreshEntryStates(bundles, rules).catch(() => {});
      }, 600);
    } catch (e: any) {
      if (onShowNotice) {
        onShowNotice(`受控启动失败: ${e?.message || e}`);
      }
    }
  };

  const handleLaunchBundle = async (bundle: ProcessBundleItem) => {
    await executeControlledLaunch(bundle.id, bundle.name);
  };

  const handleLaunchRule = async (rule: ProcessRuleItem) => {
    await executeControlledLaunch(rule.id, rule.label);
  };

  // 7. 业务规则包启停与出口插槽变更
  const handleToggleBundle = async (bundleId: string, enabled: boolean) => {
    const bundle = bundles.find((item) => item.id === bundleId);
    if (enabled && bundle && !bundle.targetProxy.trim()) {
      setOutletPickerBundle(bundle);
      onShowNotice?.("请先绑定出口，再启用业务规则包。");
      return;
    }
    const enableRouting = enabled && (!state.processEnabled || !state.bundlesEnabled);
    try {
      const updated = await updateBundleInstance(bundleId, { enabled }, { enableRouting });
      setBundles(updated);
      if (enableRouting) {
        setState((prev) => ({ ...prev, processEnabled: true, bundlesEnabled: true }));
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
      onShowNotice?.(`${enabled ? "启用" : "暂停"}业务规则包失败。${e?.message || e}`);
    }
  };

  const handleChangeBundleProxy = async (bundleId: string, proxy: string) => {
    try {
      const updated = await updateBundleInstance(bundleId, { targetProxy: proxy });
      ++entryRefresh.current;
      setEntryStatusMap((prev) => {
        const next = { ...prev };
        delete next[bundleId];
        return next;
      });
      setBundles(updated);
      void refreshAvailableProxies();
      onShowNotice?.(`已保存出口 ${proxy}。已有长连接可能继续使用原出口，可在目标应用内重连。`);
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
          onShowNotice(`业务规则包「${data.name}」已保存。`);
        }
      }
    } catch (err: any) {
      console.error("[ProcessRoutingView] handleSaveBundleForm error:", err);
      throw err;
    }
  };

  // 7.2 业务规则包安全脱敏导入与导出
  const handleImportBundleFile = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch (err: any) {
      onShowNotice?.(`规则包文件读取失败。${err?.message || err}`);
      return;
    }
    const res = validateAndParsePwPack(text);
    if (!res.valid || !res.bundle) {
      onShowNotice?.(`导入失败。${res.error || "规则包格式不合法"}`);
      return;
    }
    try {
      const updated = await importBundleItem(res.bundle);
      setBundles(updated);
      setState((prev) => ({ ...prev, totalBundleCount: updated.length }));
      onShowNotice?.("规则包已导入，待绑定出口。");
    } catch (err: any) {
      onShowNotice?.(`规则包保存失败。${err?.message || err}`);
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
    <div className="workbench-view workbench-process">
      <ProcessToolbar
        currentSubTab={subTab}
        onSelectSubTab={setSubTab}
        state={state}
        bundleCount={bundles.length}
        ruleCount={rules.length}
        liveCount={liveProcesses.length}
        onToggleMaster={handleToggleMaster}
        onSwitchDriver={handleSwitchDriver}
        onElevateAdmin={handleElevateAdmin}
        isPending={isPending}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenAddModal={handleOpenToolbarAction}
        onImportBundle={handleImportBundleFile}
        onOpenGithubModal={() => setShowGithubModal(true)}
      />

      {captureWarning && (
        <section className="workbench-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <div role="alert" className="min-w-0 flex-1 space-y-1 text-xs text-[var(--text-secondary)]">
            <p className="font-semibold text-[var(--workbench-warning)]">Edge 与当前捕获方式不兼容</p>
            <p>{captureWarning}</p>
            <p>捕获方式是全局设置，切换会影响所有进程分流套件。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onCaptureWarningChange(null)}>
              关闭
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={isPending}
              onClick={() => void handleSwitchDriver("windivert_v1", { rebuildRules: false })}>
              切换为 WinDivert
            </Button>
          </div>
        </section>
      )}

      {state.engineMode === "windivert_v1" && (
        <CaptureDiagnostics capture={captureEvidence} ownerLabels={captureOwnerLabels} />
      )}

      {/* 视图内容区 */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)]" role="status">
          正在加载进程分流规则与业务套件...
        </div>
      ) : (
        <div>
          {/* 子 Tab 1：业务规则包 (Business Bundles) */}
          {subTab === "bundles" && (
            <div className="space-y-3">
              {filteredBundles.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                  {searchQuery.trim() ? "未找到符合搜索条件的业务规则包" : "暂无业务规则包"}
                </div>
              ) : (
                <section className="workbench-bundle-list" aria-label="业务规则包">
                  {filteredBundles.map((bundle) => (
                    <BundleCard
                      key={bundle.id}
                      bundle={bundle}
                      isGlobalActive={state.bundlesEnabled && state.driverActive}
                      entryStatus={entryStatusMap[bundle.id]}
                      outletUnavailable={unavailableOutlets.includes("bundle:" + bundle.id)}
                      captureEvidence={captureByOwner.get("bundle:" + bundle.id)}
                      globalStatusHint={
                        !state.bundlesEnabled
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
                </section>
              )}
            </div>
          )}

          {/* 子 Tab 2：自定义单进程分流 (Custom Process Rules) */}
          {subTab === "rules" && (
            <section className="workbench-panel workbench-rule-table grid gap-2.5 p-3.5" aria-label="自定义进程">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span>进程规则 · {filteredRules.length} 条</span>
                <span>WinDivert 纳管匹配优先级高于默认路由</span>
              </div>

              {filteredRules.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)]">
                  暂无自选进程规则，点击右上角【添加进程规则】新建
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="workbench-process-columns" aria-hidden="true">
                    <span>匹配进程</span><span>出口与策略</span><span>状态</span><span>操作</span>
                  </div>
                  {filteredRules.map((rule) => (
                    <ProcessRuleRow
                      key={rule.id}
                      rule={rule}
                      entryStatus={entryStatusMap[rule.id]}
                      captureEvidence={captureByOwner.get("rule:" + rule.id)}
                      isGlobalActive={state.processEnabled && state.driverActive}
                      onToggleEnabled={(enabled) => handleToggleRule(rule.id, enabled)}
                      onDelete={() => handleDeleteRule(rule.id)}
                      onLaunch={handleLaunchRule}
                    />
                  ))}
                </div>
              )}
            </section>
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
      />

      <GithubBundleModal
        isOpen={showGithubModal}
        onClose={() => setShowGithubModal(false)}
        existingBundles={bundles}
        onMount={handleMountRepositoryPackage}
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

      {/* 非受控运行中实例确认重启闭环模态弹窗 */}
      <ConfirmModal
        isOpen={!!restartPrompt}
        title={`重启 [${restartPrompt?.name || ""}] 以挂载受控分流？`}
        description={
          <>
            {restartPrompt?.message}
          </>
        }
        confirmText="正常关闭并受控重启"
        cancelText="保持原状"
        isLoading={isRestartConfirming}
        onCancel={() => setRestartPrompt(null)}
        onConfirm={async () => {
          if (!restartPrompt) return;
          const current = restartPrompt;
          setIsRestartConfirming(true);
          try {
            setRestartPrompt(null);
            await executeControlledLaunch(current.id, current.name, current.confirmation);
          } finally {
            setIsRestartConfirming(false);
          }
        }}
      />
    </div>
  );
};
