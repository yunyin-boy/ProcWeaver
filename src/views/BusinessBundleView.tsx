import React, { useState, useEffect, useCallback } from "react";
import {
  BundleLocalInstance,
  BundleWatcherMode,
  BusinessBundleDefinition,
  BundleProcessBindings,
} from "../types/businessBundle";
import {
  getBundleInstances,
  installPresetBundle,
  updateBundleInstance,
  deleteBundleInstance,
} from "../services/bundleStorage";
import { bundleController, useBusinessBundles } from "../hooks/useBusinessBundles";
import { getBundleStatus } from "../utils/bundleController";
import { bundleTools } from "../services/bundleTools";
import { useBundleEntries } from "../hooks/useBundleTools";
import { BundleRow } from "../components/business-bundle/BundleRow";
import { TrafficModeSelector } from "../components/TrafficModeSelector";
import { TrafficModeGuideModal } from "../components/TrafficModeGuideModal";
import { SelectExitModal } from "../components/business-bundle/SelectExitModal";
import { BundleDetailModal } from "../components/business-bundle/BundleDetailModal";
import { ImportBundleModal } from "../components/business-bundle/ImportBundleModal";
import { ExportBundleModal } from "../components/business-bundle/ExportBundleModal";
import { EditBundleModal } from "../components/business-bundle/EditBundleModal";
import { BundlePolicyModal } from "../components/business-bundle/BundlePolicyModal";
import { StaleConnectionsModal, type StaleTcpConnectionItem } from "../components/business-bundle/StaleConnectionsModal";
import { inspectBundleStaleConnections, resetBundleStaleConnections } from "../api/bundleStaleConnections";
import { BundleStudio } from "../components/business-bundle/BundleStudio";
import { RepositoryCenter } from "../components/business-bundle/RepositoryCenter";
import { useBundleRepositories } from "../hooks/useBundleRepositories";
import { repositoryPage } from "../services/bundleRepositories";
import type { RepositoryPackage } from "../types/bundleRepository";
import { type BundlePolicy, defaultBundlePolicy } from "../types/businessBundle";
import { usePlatform } from "../context/PlatformContext";
import { getGeneralSettings } from "../api/settings";
import { bundleExes, processKey, bundleProcesses } from "../utils/bundlePlatform";
import { toggleDnsGuard, getDnsGuardInfo, isTauri } from "../api";
import {
  Wrench,
  Download,
  Sparkles,
  HelpCircle,
} from "lucide-react";

interface Props {
  mode: string | null;
  processOnly?: boolean;
}

export const BusinessBundleView: React.FC<Props> = ({ mode: _mode, processOnly = false }) => {
  const platform = usePlatform();
  const os = platform.os === "android" ? "android" : platform.os === "macos" ? "macos" : "windows";
  const bundleState = useBusinessBundles();
  const entryStates = useBundleEntries();
  const { instances } = bundleState;
  const [search, setSearch] = useState("");
  const availableProxies = (bundleState.view?.targets || []).map(target => target.name);
  const [activeTab, setActiveTab] = useState<"installed" | "presets" | "studio">("installed");
  const repositories = useBundleRepositories(activeTab === "presets");
  const repoCount = repositories.state.repositories.filter(r => r.enabled).reduce((sum, r) => sum + (repositories.state.statuses[r.id]?.packages.length || 0), 0);
  const loadingRepo = repositories.state.repositories.some(r => r.enabled && repositories.state.statuses[r.id]?.loading);

  // 弹窗状态
  const [selectExitTarget, setSelectExitTarget] = useState<BundleLocalInstance | null>(null);
  const openExit = (instance: BundleLocalInstance) => {
    if (processOnly) {
      showToast("独立进程版请前往顶部【外部代理】页面管理和分配代理出口");
      return;
    }
    setSelectExitTarget(instance);
  };
  const [detailTarget, setDetailTarget] = useState<BundleLocalInstance | null>(null);
  const [exportTarget, setExportTarget] = useState<BundleLocalInstance | null>(null);
  const [editingTarget, setEditingTarget] = useState<BundleLocalInstance | null>(null);
  const [policyTarget, setPolicyTarget] = useState<BundleLocalInstance | null>(null);
  const [stalePromptTarget, setStalePromptTarget] = useState<{
    instance: BundleLocalInstance;
    connections: StaleTcpConnectionItem[];
  } | null>(null);
  const [isImportOpen, setIsImportOpen] = useState<boolean>(false);
  const [isModeGuideOpen, setIsModeGuideOpen] = useState<boolean>(false);
  const [currentTrafficMode, setCurrentTrafficMode] = useState<string>("app_proxy");

  // 全局 DNS 护航与提示 (智能联动与托管状态)
  const [dnsGuardEnabled, setDnsGuardEnabled] = useState<boolean>(false);
  const [dnsGuardOrigin, setDnsGuardOrigin] = useState<"none" | "manual" | "bundle">("none");
  const [isDnsPending, setIsDnsPending] = useState<boolean>(false);
  const [bannerToast, setBannerToast] = useState<string>("");

  const showToast = (msg: string) => {
    setBannerToast(msg);
    setTimeout(() => setBannerToast(""), 3500);
  };

  // 1. 加载可用节点列表
  useEffect(() => {
    void bundleController.refresh();

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refreshDns = () => {
      if (!processOnly && platform.dnsGuard) {
        void getDnsGuardInfo().then(info => {
          if (!disposed) {
            setDnsGuardEnabled(info.enabled);
            setDnsGuardOrigin(info.origin);
          }
        }).catch(() => {});
      }
    };
    const refreshTrafficMode = () => {
      void getGeneralSettings().then(s => {
        const mode = (s.trafficMode as string) || (s.tunMode ? "tun" : "app_proxy");
        if (!disposed) setCurrentTrafficMode(mode);
      }).catch(() => {});
    };
    refreshTrafficMode();
    refreshDns();
    window.addEventListener("focus", refreshDns);
    window.addEventListener("procweaver-dns-guard-changed", refreshDns);
    window.addEventListener("netbox-settings-saved", refreshTrafficMode);
    if (isTauri()) void import("@tauri-apps/api/event").then(({ listen }) => listen("procweaver-dns-guard-changed", refreshDns))
      .then(remove => { if (disposed) remove(); else unlisten = remove; }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", refreshDns);
      window.removeEventListener("procweaver-dns-guard-changed", refreshDns);
      window.removeEventListener("netbox-settings-saved", refreshTrafficMode);
    };
  }, []);

  // 2. 业务包守护由独立入口检测负责，不修改其他进程使用的旧版全局守护。
  const persistAndSync = useCallback((nextInstances: BundleLocalInstance[]) => {
    void bundleController.apply(nextInstances).then(async success => {
      if (!success) { setBannerToast(""); return; }
      if (isTauri()) await bundleTools.refreshEntries();
    });
  }, []);

  const getExternalLabel = useCallback((inst?: BundleLocalInstance | null) => {
    if (!inst || inst.backend !== "external") return undefined;
    const endpoints = bundleState.external?.endpoints || [];
    const epId = inst.externalEndpointId || bundleState.external?.defaultEndpointId;
    if (!epId) return undefined;
    const ep = endpoints.find(e => e.id === epId);
    if (!ep) return undefined;
    return inst.externalEndpointId ? ep.name : `${ep.name} (默认)`;
  }, [bundleState.external]);

  // 存量旧长连接检测
  const checkStaleConnectionsForInstance = async (inst: BundleLocalInstance) => {
    if (platform.os !== "windows") return;
    const exes = bundleProcesses(inst.definition, "windows").map(p => p.exe).filter(Boolean);
    if (exes.length === 0) return;
    const bundlePort = inst.backend === "external"
      ? (bundleState.external?.states.find(s => s.id === inst.instanceId)?.port || 0)
      : (bundleState.view?.config.bundles?.find(b => b.id === inst.instanceId)?.port || 0);
    const trackSubs = inst.policy?.proxySubprocesses ?? inst.definition.policy?.proxySubprocesses ?? true;
    const staleConns = await inspectBundleStaleConnections(inst.instanceId, exes, bundlePort, trackSubs);
    if (staleConns.length > 0) {
      const strategy = inst.policy?.staleConnectionStrategy || inst.definition.policy?.staleConnectionStrategy || "prompt";
      if (strategy === "auto_reset") {
        // 自动重置时：智能过滤出海外目标连接（若全是国内则按原样全部重置）
        const targetsToReset = staleConns.some(c => c.isTarget !== false)
          ? staleConns.filter(c => c.isTarget !== false)
          : staleConns;
        await resetBundleStaleConnections(targetsToReset);
        showToast(`⚡ 出口已更新，并自动微秒热刷新了 ${targetsToReset.length} 条存量长连接！`);
      } else if (strategy === "prompt") {
        setStalePromptTarget({ instance: inst, connections: staleConns });
      }
    }
  };

  const handleConfirmStaleReset = async (
    selectedConns: StaleTcpConnectionItem[],
    rememberChoice: boolean
  ) => {
    if (!stalePromptTarget) return;
    const { instance } = stalePromptTarget;
    const res = await resetBundleStaleConnections(selectedConns);
    if (rememberChoice) {
      const next = updateBundleInstance(instance.instanceId, (prev) => ({
        ...prev,
        policy: {
          ...(prev.policy ?? prev.definition.policy ?? defaultBundlePolicy()),
          staleConnectionStrategy: "auto_reset",
        },
        isModified: true,
      }));
      persistAndSync(next);
    }
    setStalePromptTarget(null);
    showToast(`⚡ 成功重置 ${res.totalReset} 条存量连接，应用已自动自愈切入代理！`);
  };

  const handleIgnoreStale = () => {
    setStalePromptTarget(null);
  };

  // 切换开关
  const handleToggleSwitch = (instanceId: string, nextState: boolean) => {
    const next = updateBundleInstance(instanceId, (prev) => ({
      ...prev,
      enabled: nextState,
    }));
    persistAndSync(next);
    if (nextState) {
      const targetInst = next.find(i => i.instanceId === instanceId);
      const isBound = targetInst?.backend === "external"
        ? Boolean(targetInst.externalEndpointId || bundleState.external?.defaultEndpointId)
        : Boolean(targetInst?.slotBindings.main);
      if (targetInst && isBound) {
        void checkStaleConnectionsForInstance(targetInst);
      }
    }
  };

  // 弹窗确认应用出口（含主出口与 DNS 出口联动）
  const handleSelectExitConfirm = (instanceId: string, mainExit: string | null, dnsExit?: string | null) => {
    let updatedTarget: BundleLocalInstance | null = null;
    const next = updateBundleInstance(instanceId, (prev) => {
      const isUnbinding = !mainExit || mainExit.trim() === "";
      const updated = {
        ...prev,
        backend: "core" as const,
        slotBindings: {
          ...prev.slotBindings,
          main: isUnbinding ? null : mainExit,
          dns: dnsExit !== undefined ? dnsExit : prev.slotBindings.dns,
        },
        slotTargets: {
          ...prev.slotTargets,
          main: bundleState.view?.targets.find(t => t.name === mainExit),
          dns: dnsExit === undefined ? prev.slotTargets?.dns : dnsExit && dnsExit !== "FOLLOW_MAIN" ? bundleState.view?.targets.find(t => t.name === dnsExit) : undefined,
        },
        // 如果解除绑定，则自动停用；若选了有效节点，则自动开启强锁
        enabled: !isUnbinding,
      };
      updatedTarget = updated;
      return updated;
    });
    persistAndSync(next);
    showToast(
      mainExit
        ? `正在应用出口【${mainExit}】，请查看核心确认状态`
        : `正在解除绑定，请等待核心确认`
    );
    if (mainExit && updatedTarget) {
      void checkStaleConnectionsForInstance(updatedTarget);
    }
  };

  // 切换单包守护模式
  const handleChangeWatcherMode = (instanceId: string, mode: BundleWatcherMode) => {
    const next = updateBundleInstance(instanceId, (prev) => ({
      ...prev,
      watcherMode: mode,
    }));
    persistAndSync(next);
  };

  // 卸载套件
  const handleDeleteInstance = (instanceId: string) => {
    const next = deleteBundleInstance(instanceId);
    persistAndSync(next);
    showToast("已移除本机规则包，正在确认核心规则已移除");
  };

  // 导入完成处理
  const handleImportConfirm = (
    bundle: BusinessBundleDefinition,
    autoEnable: boolean,
    boundNode: string | null
  ) => {
    const installed = installPresetBundle(bundle, processOnly ? false : autoEnable, processOnly ? null : boundNode);
    if (processOnly) updateBundleInstance(installed.instanceId, prev => ({ ...prev, backend: "external" }));
    const next = getBundleInstances();
    persistAndSync(next);
    setActiveTab("installed");
    showToast(
      autoEnable
        ? `已导入「${bundle.packageName}」，正在应用规则`
        : `📥 成功导入「${bundle.packageName}」，当前处于【已停用 (跟随系统默认)】状态。`
    );
  };

  // 预设中心装载
  const handleInstallFromPreset = (item: RepositoryPackage) => {
    const def = item.definition;
    try { const installed = installPresetBundle(def, false, null, item.origin); if (processOnly) updateBundleInstance(installed.instanceId, prev => ({ ...prev, backend: "external" })); }
    catch (e) { showToast(e instanceof Error ? e.message : "装载失败，请重试"); return; }
    const next = getBundleInstances();
    persistAndSync(next);
    setActiveTab("installed");
    showToast(`📦 已将「${def.packageName}」装载到本机列表（已停用跟随系统默认）！`);
  };

  // 自定义工坊保存装载回调
  const handleSaveCustomBundle = (_newInstance: BundleLocalInstance) => {
    if (processOnly) updateBundleInstance(_newInstance.instanceId, prev => ({ ...prev, backend: "external", enabled: false }));
    const next = getBundleInstances();
    persistAndSync(next);
    setActiveTab("installed");
  };

  // DNS 护航切换 (恪守用户最高主权)
  const handleToggleDns = async () => {
    if (isDnsPending) return;
    setIsDnsPending(true);
    try {
      const next = !dnsGuardEnabled;
      if (!next) {
        const res = await toggleDnsGuard(false, "manual");
        setDnsGuardEnabled(res);
        setDnsGuardOrigin("none");
        showToast("ℹ️ 已手动关闭本地 DNS 防投毒护航");
      } else {
        const res = await toggleDnsGuard(true, "manual");
        setDnsGuardEnabled(res);
        setDnsGuardOrigin("manual");
        showToast("🛡️ 已手动开启本地 DNS 防投毒护航");
      }
    } catch (err: any) {
      showToast(`❌ 切换 DNS 护航失败: ${err?.message || err}`);
    } finally {
      setIsDnsPending(false);
    }
  };

  // 保存二次编辑 (B03)
  const handleSaveEdit = (updatedDef: BusinessBundleDefinition, processBindings?: BundleProcessBindings, policy?: BundlePolicy) => {
    if (!editingTarget) return;
    const effectivePolicy = policy !== undefined ? policy : (updatedDef.policy ?? editingTarget.policy);
    const next = updateBundleInstance(editingTarget.instanceId, (prev) => ({
      ...prev,
      definition: {
        ...updatedDef,
        policy: effectivePolicy,
      },
      processBindings,
      policy: effectivePolicy,
      isModified: true,
    }));
    persistAndSync(next);
    setEditingTarget(null);
    showToast(`✏️ 规则包「${updatedDef.packageName}」定义及接管防护策略已成功更新！`);
  };

  // 保存高级接管与防护策略
  const handleSavePolicy = (newPolicy: BundlePolicy) => {
    if (!policyTarget) return;
    const next = updateBundleInstance(policyTarget.instanceId, (prev) => ({
      ...prev,
      policy: newPolicy,
      definition: {
        ...prev.definition,
        policy: newPolicy,
      },
      isModified: true,
    }));
    persistAndSync(next);
    setPolicyTarget(null);
    showToast(`🛡️ 规则包「${policyTarget.definition.packageName}」接管防护策略已更新！`);
  };

  // 调整规则包在列表中的优先级次序 (B10)
  const handleMoveInstance = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= instances.length) return;
    const next = [...instances];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    persistAndSync(next);
    showToast(`🔄 已调整「${moved.definition.packageName}」优先级次序！`);
  };

  // 冲突体检（包含主进程与全部附加进程，严格对齐 B10）
  const handleConflictCheck = () => {
    const activeInstances = instances.filter((i) => i.enabled && i.slotBindings.main);
    const exeCounts: Record<string, string[]> = {};
    for (const inst of activeInstances) {
      const exes = new Set(bundleExes(inst.definition, os).flatMap(e => {
        const paths = os === "android" ? [] : inst.processBindings?.[os]?.filter(b => processKey(b.exe, os) === processKey(e, os)) ?? [];
        return paths.length ? paths.map(b => `路径 ${processKey(b.executablePath, os)}`) : [`名称 ${processKey(e, os)}`];
      }));
      for (const exe of exes) {
        if (!exeCounts[exe]) exeCounts[exe] = [];
        exeCounts[exe].push(inst.definition.packageName);
      }
    }

    const conflicts = Object.entries(exeCounts).filter(([_, pkgs]) => pkgs.length > 1);
    if (conflicts.length === 0) {
      alert("✅ 冲突体检通过：\n\n所有已开启的业务规则包之间（包含主进程与附加进程）不存在任何重复的进程抢占冲突，出口策略清晰明确！");
    } else {
      const detail = conflicts.map(([exe, pkgs]) => `• ${exe}: 被 [${pkgs.join(", ")}] 同时接管`).join("\n");
      alert(`⚠️ 检测到进程规则重叠：\n\n${detail}\n\n重复进程会阻止本次应用。请停用冲突套件或编辑移除重复进程。`);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-[#08090a] text-slate-900 dark:text-zinc-100 font-sans p-4 md:p-6 select-none transition-colors duration-200">
      <div className="max-w-6xl w-full mx-auto space-y-4">
        {(bundleState.error || bundleState.readError || bundleState.pending) && (
          <div role={bundleState.pending ? "status" : "alert"} className="p-3 rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-0 break-words">{bundleState.pending ? "正在保存本次变更；未修改的业务包保持原配置。节点切换仅影响该包的新连接。" : `${bundleState.error || bundleState.readError}。本次变更未确认生效；已选择出口不代表实际出口，请查看各业务包的应用状态和新连接记录。`}</span>
            <button type="button" disabled={bundleState.pending} onClick={() => persistAndSync(instances)} className="px-3 py-1 rounded border border-current disabled:opacity-50">重新应用</button>
          </div>
        )}
        {/* 全局通知条 */}
        {bannerToast && (
          <div className="p-3 rounded-xl bg-indigo-600 text-white text-xs font-medium shadow-lg flex items-center justify-between animate-in fade-in">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4" />
              <span>{bannerToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerToast("")}
              className="text-white/80 hover:text-white cursor-pointer ml-3"
            >
              ✕
            </button>
          </div>
        )}

        {/* 顶部全局状态与控制栏 (去框一体化平铺工具带, 极致纯净) */}
        {!processOnly && <header className="px-1 py-1 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 relative z-10 transition-colors">
          {/* 左侧：全局分流总开关 + 底层接管模式下拉 + 核心状态 */}
          <div className="flex items-center space-x-3">
            {/* 业务包分流总开关 */}
            <button
              type="button"
              role="switch"
              aria-label="业务包分流总开关"
              aria-checked={bundleState.view?.config.bundlesEnabled !== false}
              disabled={!bundleState.view || bundleState.pending || Boolean(bundleState.readError)}
              onClick={() => void bundleController.setMasterEnabled(bundleState.view?.config.bundlesEnabled === false)}
              className="flex items-center space-x-2 px-2 py-1 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/[0.06] cursor-pointer select-none text-xs font-bold text-slate-800 dark:text-zinc-200 disabled:opacity-50 transition"
              title={bundleState.view?.config.bundlesEnabled === false ? "点击开启业务包分流" : "点击暂停业务包分流"}
            >
              {/* 1. 胶囊开关 */}
              <span
                aria-hidden="true"
                className={`relative inline-flex items-center w-9 h-5 rounded-full shrink-0 transition-colors duration-200 ${
                  bundleState.view?.config.bundlesEnabled === false
                    ? "bg-slate-300 dark:bg-zinc-700"
                    : "bg-emerald-500 shadow-sm"
                }`}
              >
                <span
                  className={`inline-block w-4 h-4 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                    bundleState.view?.config.bundlesEnabled === false
                      ? "translate-x-0.5"
                      : "translate-x-[18px]"
                  }`}
                />
              </span>

              {/* 2. 状态指示灯 */}
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  bundleState.masterPending
                    ? "bg-amber-500 animate-pulse"
                    : bundleState.view?.config.bundlesEnabled === false
                    ? "bg-zinc-500"
                    : "bg-emerald-500 ring-2 ring-emerald-500/20"
                }`}
              />

              {/* 3. 状态说明文字与优雅待命微胶囊 */}
              <span className="text-[11px] sm:text-xs">
                核心业务包 · {bundleState.masterPending ? "切换中" : bundleState.view?.config.bundlesEnabled === false ? "已暂停" : "已开启"}
              </span>
              {bundleState.view?.config.bundlesEnabled === false && (
                <span
                  className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1 cursor-help"
                  title="业务包分流当前处于暂停状态。单包设置已保留，应用遵循本地直连；已有 Hook、代理启动参数或 Fake-IP 缓存的应用需正常退出并重启"
                >
                  <span>⏸️ 直连放行</span>
                </span>
              )}
            </button>

            <span className="h-3.5 w-px bg-slate-200 dark:bg-white/[0.08] hidden sm:inline-block" />

            {/* 全局底层接管模式下拉选择器 (WinDivert / TUN / 智能双模式 / 纯应用层 / 用户态强接管) */}
            {platform.os === "windows" && (
              <TrafficModeSelector
                variant="compact"
                onModeChanged={(mode) => { setCurrentTrafficMode(mode); void bundleController.refresh(); }}
              />
            )}

            {/* 模式说明信息按钮 */}
            {platform.os === "windows" && (
              <button
                type="button"
                onClick={() => setIsModeGuideOpen(true)}
                className="h-7 w-7 rounded-lg bg-slate-100 hover:bg-slate-200/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white flex items-center justify-center transition shadow-2xs cursor-pointer shrink-0"
                title="查看各底层接管模式说明及 WinDivert 优缺点"
                aria-label="模式说明"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            )}

            {/* 核心正常状态小绿点 */}
            <div className="hidden sm:flex items-center space-x-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
              <span className={`w-2 h-2 rounded-full ${bundleState.view?.running && !bundleState.readError ? "bg-emerald-500" : "bg-zinc-500"}`} />
              <span>{bundleState.readError ? "核心异常" : bundleState.view?.running ? "核心正常" : "核心未运行"}</span>
            </div>
          </div>

          {/* 右侧：DNS 护航开关 + 冲突体检 + 进程跟踪说明悬停气泡 (去厚框幽灵微胶囊) */}
          <div className="flex items-center space-x-2">
            {/* DNS 护航 */}
            <button
              type="button"
              onClick={handleToggleDns}
              disabled={!platform.dnsGuard || isDnsPending}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ${
                isDnsPending ? "opacity-60 cursor-wait" : "cursor-pointer"
              } ${
                dnsGuardEnabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-slate-100/80 hover:bg-slate-200/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-slate-600 dark:text-zinc-400"
              }`}
              title={
                !platform.dnsGuard
                  ? "macOS 首版不修改网卡 DNS；核心 DNS 策略仅作用于进入核心的查询"
                  : dnsGuardEnabled
                    ? dnsGuardOrigin === "bundle"
                      ? "旧版业务自动护航等待清理。业务目标域名改由绑定出口远端解析。点击可关闭系统护航。"
                      : "已手动开启系统 DNS 护航，使用公共 DNS 配置，独立于业务包启停。点击可关闭。"
                    : "手动接管系统 DNS，使用公共 DNS 配置；业务目标域名由绑定出口远端解析，无需开启此项。"
              }
            >
              <span>🛡️</span>
              <span>系统DNS: <strong className={
                dnsGuardEnabled
                  ? "text-emerald-600 dark:text-emerald-400 font-bold"
                  : "text-slate-700 dark:text-zinc-300"
              }>
                {!platform.dnsGuard
                  ? "不支持"
                  : isDnsPending
                  ? "切换中..."
                  : dnsGuardEnabled
                  ? dnsGuardOrigin === "bundle"
                    ? "旧版待清理"
                    : "开启"
                  : "关闭"}
              </strong></span>
            </button>

            {/* 冲突体检 */}
            <button
              type="button"
              onClick={handleConflictCheck}
              className="px-2.5 py-1 rounded-lg bg-slate-100/80 dark:bg-white/[0.04] hover:bg-slate-200/80 dark:hover:bg-white/[0.08] text-slate-700 dark:text-zinc-300 cursor-pointer transition text-xs font-medium flex items-center space-x-1.5"
            >
              <span>🔍</span>
              <span>冲突体检</span>
            </button>

            {/* 进程跟踪说明悬停气泡 */}
            <div className="relative group">
              <button
                type="button"
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition cursor-help ${
                  bundleState.view?.running && Boolean(bundleState.view.tracking.warnings?.length)
                    ? "text-amber-500 hover:bg-amber-500/10"
                    : "text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10"
                }`}
                aria-label="进程跟踪说明"
              >
                {bundleState.view?.running && Boolean(bundleState.view.tracking.warnings?.length) ? "⚠️" : "ⓘ"}
              </button>
              <div className="hidden group-hover:block absolute right-0 top-7 z-50 w-72 bg-white/95 dark:bg-[#0d1015]/95 backdrop-blur-2xl text-slate-800 dark:text-zinc-200 text-[11px] p-2.5 rounded-xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.8)] leading-relaxed border border-slate-200 dark:border-white/10 pointer-events-none">
                <span className="font-bold text-amber-500 block mb-1">
                  {bundleState.view?.running && Boolean(bundleState.view.tracking.warnings?.length)
                    ? "进程跟踪提示："
                    : "进程跟踪说明："}
                </span>
                {bundleState.view?.running && Boolean(bundleState.view.tracking.warnings?.length)
                  ? `${bundleState.view.tracking.warnings?.join("；") ?? ""}。未核实的进程不会被标记为已接管。`
                  : "部分短命或受系统保护的后台进程无法直接核验身份；未核实归属的进程不会被强制标记为已接管。"}
              </div>
            </div>
          </div>
        </header>}

        {/* 主导航切换器与动作区 (Linear 标志性无缝下沉胶囊分段条 + 物理反光高光主按钮) */}
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-white/[0.06] pb-3">
          <div className="flex items-center p-0.5 rounded-xl bg-slate-100/90 dark:bg-black/45 border border-slate-200/80 dark:border-white/[0.08] shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3)] shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("installed")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-2 cursor-pointer select-none ${
                activeTab === "installed"
                  ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-semibold"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <span>📦 已装载套件</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/5 dark:bg-white/10 text-[10px] font-mono font-bold">
                {instances.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("presets");
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-2 cursor-pointer select-none ${
                activeTab === "presets"
                  ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-semibold"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <span>🌐 仓库中心</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/5 dark:bg-white/10 text-[10px] font-mono font-bold">
                {loadingRepo ? "..." : repoCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("studio")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-2 cursor-pointer select-none ${
                activeTab === "studio"
                  ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-semibold"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Wrench className="w-3.5 h-3.5 text-amber-400" />
              <span>自定义工坊</span>
            </button>
          </div>

          {/* 右侧动作区：导入向导 (Linear 物理反光高光白底主按钮) */}
          <div className="flex items-center space-x-2 text-xs">
            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              className="px-3.5 py-1.5 rounded-xl font-semibold bg-zinc-100 hover:bg-white text-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] flex items-center space-x-1.5 cursor-pointer transition select-none active:scale-[0.98]"
            >
              <Download className="w-3.5 h-3.5 text-zinc-950" />
              <span>导入规则包 (.pwpack)</span>
            </button>
          </div>
        </nav>

        {/* ================= 视图 1：已装载套件列表 ================= */}
        {activeTab === "installed" && (
          <main className="space-y-2.5">
            {processOnly && <label className="block text-xs text-slate-500">搜索业务包<input aria-label="搜索业务包" value={search} onChange={e => setSearch(e.target.value)} placeholder="名称或进程文件名" className="block mt-1 w-full sm:max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none" /></label>}
            {instances.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-xs">
                <div className="text-3xl">📦</div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">暂未装载任何业务规则包</div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  您可以前往「仓库中心」挑选常用套件，或导入现有的 .pwpack.json 规则包。
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("presets")}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer transition inline-block shadow-md"
                >
                  前往仓库中心浏览
                </button>
              </div>
            ) : (
              <>
                {/* 列表表头 */}
                <div className="flex items-center justify-between px-4 py-1 text-[11px] font-bold text-slate-400 dark:text-slate-500 select-none">
                  <div className="flex items-center space-x-3.5">
                    <span className="w-10 text-center">开关</span>
                    <span>业务应用 / 规则包</span>
                  </div>
                  <div className="flex items-center space-x-6 pr-2">
                    <span className="hidden sm:inline">模式</span>
                    <span className="w-[170px] text-left pl-2">出站出口</span>
                    <span className="w-16 text-center">操作</span>
                  </div>
                </div>

                {/* 列表项 (统一黑曜石发丝底座, 内部去卡片化发丝平铺) */}
                {search && !instances.some(instance => `${instance.definition.packageName} ${bundleExes(instance.definition, os).join(" ")}`.toLowerCase().includes(search.toLowerCase())) && <p role="status" className="py-8 text-center text-sm text-slate-500">没有匹配的业务包，请调整搜索条件。</p>}
                <div className="rounded-2xl bg-white/70 dark:bg-[#121316]/50 border border-slate-200/80 dark:border-white/[0.08] overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                  {instances.map((instance, idx) => (!search || `${instance.definition.packageName} ${bundleExes(instance.definition, os).join(" ")}`.toLowerCase().includes(search.toLowerCase())) && (
                    <BundleRow
                      key={instance.instanceId}
                      instance={instance}
                      status={getBundleStatus(instance, bundleState)}
                      entry={entryStates[instance.instanceId]}
                      proxyLabels={bundleState.view?.targetLabels}
                      externalLabel={getExternalLabel(instance)}
                      trafficMode={currentTrafficMode}
                      unavailable={processOnly && instance.backend !== "external"}
                      compact={processOnly}
                      masterEnabled={bundleState.view?.config.bundlesEnabled !== false}
                      onLaunch={() => void bundleTools.launch({ instanceId: instance.instanceId })}
                      onShortcuts={() => void bundleTools.shortcuts(instance.instanceId)}
                      onToggleSwitch={handleToggleSwitch}
                      onOpenSelectExit={openExit}
                      onOpenDetail={(inst) => setDetailTarget(inst)}
                      onOpenPolicy={(inst) => setPolicyTarget(inst)}
                      onEdit={(inst) => setEditingTarget(inst)}
                      onExport={(inst) => setExportTarget(inst)}
                      onDelete={handleDeleteInstance}
                      onMoveUp={() => handleMoveInstance(idx, "up")}
                      onMoveDown={() => handleMoveInstance(idx, "down")}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < instances.length - 1}
                    />
                  ))}
                </div>

              </>
            )}
          </main>
        )}

        {/* 仓库管理独立于已装载规则与运行配置。 */}
        {activeTab === "presets" && <RepositoryCenter state={repositories.state} instances={instances}
          onRefresh={id => { void repositories.actions.refresh(id); }} onReload={() => { repositories.actions.reload(); }}
          onSave={repositories.actions.upsert} onToggle={repositories.actions.toggle} onRemove={repositories.actions.remove}
          onInstall={handleInstallFromPreset} repositoryLink={repositoryPage} />}

        {/* ================= 视图 3：自定义工坊 (全新重构) ================= */}
        {activeTab === "studio" && (
          <BundleStudio
            remoteDns={platform.os === "windows" && !processOnly}
            os={os}
            existingInstances={instances}
            availableProxies={availableProxies}
            proxyLabels={bundleState.view?.targetLabels}
            processTreeSupported={Boolean(platform.processTree)}
            onSave={handleSaveCustomBundle}
            showToast={showToast}
          />
        )}

      </div>

      {/* 业务出口选择弹窗 (弹窗形式选择出口) */}
      <SelectExitModal
        isOpen={Boolean(selectExitTarget)}
        instance={selectExitTarget}
        availableProxies={availableProxies}
        proxyLabels={bundleState.view?.targetLabels}
        onConfirm={handleSelectExitConfirm}
        onCancel={() => setSelectExitTarget(null)}
      />

      {/* 业务包详情与运行状态审计弹窗 (原第二张图信息) */}
      <BundleDetailModal
        isOpen={Boolean(detailTarget)}
        instance={instances.find(i => i.instanceId === detailTarget?.instanceId) || detailTarget}
        status={detailTarget ? getBundleStatus(instances.find(i => i.instanceId === detailTarget.instanceId) || detailTarget, bundleState) : undefined}
        entry={detailTarget ? entryStates[detailTarget.instanceId] : undefined}
        proxyLabels={bundleState.view?.targetLabels}
        externalLabel={getExternalLabel(detailTarget)}
        drawer={processOnly}
        unavailable={processOnly && detailTarget?.backend !== "external"}
        onChangeWatcherMode={handleChangeWatcherMode}
        onShortcuts={(id) => void bundleTools.shortcuts(id)}
        onLaunch={(id) => void bundleTools.launch({ instanceId: id })}
        onEdit={(inst) => setEditingTarget(inst)}
        onOpenSelectExit={openExit}
        onClose={() => setDetailTarget(null)}
      />

      {/* 导入向导弹窗 */}
      <ImportBundleModal
        isOpen={isImportOpen}
        availableProxies={availableProxies}
        proxyLabels={bundleState.view?.targetLabels}
        onConfirm={handleImportConfirm}
        onCancel={() => setIsImportOpen(false)}
      />

      {/* 导出向导弹窗 */}
      <ExportBundleModal
        isOpen={Boolean(exportTarget)}
        instance={exportTarget}
        onClose={() => setExportTarget(null)}
      />

      {/* 规则包二次编辑弹窗 (B03) */}
      <EditBundleModal
        isOpen={Boolean(editingTarget)}
        bundleInstance={editingTarget}
        onSave={handleSaveEdit}
        onCancel={() => setEditingTarget(null)}
      />

      {/* 规则包高级防护策略弹窗 */}
      <BundlePolicyModal
        isOpen={Boolean(policyTarget)}
        instance={policyTarget}
        onSave={handleSavePolicy}
        onCancel={() => setPolicyTarget(null)}
      />

      {/* 接管模式说明及各模式优缺点详解弹窗 */}
      <TrafficModeGuideModal
        isOpen={isModeGuideOpen}
        onClose={() => setIsModeGuideOpen(false)}
        onConfirm={() => setIsModeGuideOpen(false)}
        currentMode={currentTrafficMode}
      />

      {/* 存量直连旧连接热重置提示弹窗 */}
      <StaleConnectionsModal
        isOpen={Boolean(stalePromptTarget)}
        instance={stalePromptTarget?.instance || null}
        connections={stalePromptTarget?.connections || []}
        onConfirmReset={handleConfirmStaleReset}
        onIgnore={handleIgnoreStale}
        onClose={handleIgnoreStale}
      />
    </div>
  );
};
