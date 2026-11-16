// ==========================================================================
// ProcWeaver src-next 桌面迷你小挂件视口 (Mini Widget HUD - 380×580)
// 规范溯源: tauri-linear-raycast-ui / impeccable-design / taste-skill / typography-dark-mono-optics
// 风格约束: 严禁任何 Emoji，全量内联细线 SVG，极简高密度，就地节点快切抽屉，等宽数字消除光渗
// ==========================================================================

import React, { useState, useEffect, useMemo } from "react";
import { CoreStatusSnapshot, EngineMode } from "../../types/core";
import { BandwidthSnapshot } from "../../types/telemetry";
import { FormFactor } from "../../utils/useWindowFormFactor";
import { ProxyItem } from "../../types/proxy";
import {
  getActiveOutboundNode,
  ActiveNodeInfo,
  setEngineMode,
  formatMemoryBytes,
} from "../../services/coreService";
import {
  fetchProxiesData,
  switchGroupProxy,
} from "../../services/proxyService";
import {
  toggleSystemProxy,
  getSystemProxyState,
} from "../../services/systemProxyService";
import {
  formatBitrate,
  calculateAdaptiveCeilingBps,
} from "../../services/telemetryService";
import { generateSvgWave } from "../../utils/trafficWave";
import { flushDns, reloadCoreConfig } from "../../services/dnsService";
import { getGeneralSettings, saveGeneralSettings } from "../../services/settingsService";

import {
  fetchProcessRoutingState,
  saveProcessRoutingState,
  fetchBundles,
  updateBundleInstance,
} from "../../services/processRoutingService";
import {
  ProcessBundleItem,
  ProcessRoutingState,
} from "../../types/processRouting";

interface MiniWidgetViewProps {
  status: CoreStatusSnapshot;
  bandwidth: BandwidthSnapshot;
  onSetFormFactor: (factor: FormFactor) => void;
  onShowNotice?: (msg: string) => void;
  onNavigateTab?: (tab: string) => void;
}

type MiniTab = "monitor" | "bundles" | "tools";

interface MiniNodeItem {
  name: string;
  type: string;
  delay?: number;
}

export const MiniWidgetView: React.FC<MiniWidgetViewProps> = ({
  status,
  bandwidth,
  onSetFormFactor,
  onShowNotice,
  onNavigateTab,
}) => {
  const [miniTab, setMiniTab] = useState<MiniTab>("monitor");

  // 出站节点与快切抽屉
  const [activeNode, setActiveNode] = useState<ActiveNodeInfo>({
    name: "正在读取节点...",
    type: "Proxy",
  });
  const [isNodeSheetOpen, setIsNodeSheetOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [availableNodes, setAvailableNodes] = useState<MiniNodeItem[]>([]);
  const [switchingNode, setSwitchingNode] = useState<string | null>(null);

  // 系统代理开关状态
  const [isProxyActive, setIsProxyActive] = useState(true);
  const [isTogglingProxy, setIsTogglingProxy] = useState(false);

  // TUN 模式与局域网共享
  const [tunMode, setTunMode] = useState(false);
  const [allowLan, setAllowLan] = useState(false);

  // 业务规则包与运维状态

  const [isRepairingDns, setIsRepairingDns] = useState(false);
  const [isReloadingCore, setIsReloadingCore] = useState(false);

  // 真实业务规则包与全局进程分流总控状态
  const [routingState, setRoutingState] = useState<ProcessRoutingState>({
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
  const [bundles, setBundles] = useState<ProcessBundleItem[]>([]);
  const [isLoadingBundles, setIsLoadingBundles] = useState(false);
  const [isTogglingMaster, setIsTogglingMaster] = useState(false);
  const [togglingBundleId, setTogglingBundleId] = useState<string | null>(null);

  // 加载真实业务包与分流总控数据
  const loadRoutingData = async () => {
    setIsLoadingBundles(true);
    try {
      const [rState, bList] = await Promise.all([
        fetchProcessRoutingState(),
        fetchBundles(),
      ]);
      setRoutingState(rState);
      setBundles(bList);
    } catch (e) {
      console.warn("加载小挂件分流数据失败:", e);
    } finally {
      setIsLoadingBundles(false);
    }
  };

  useEffect(() => {
    loadRoutingData();
    const handleRouteChanged = () => {
      loadRoutingData();
    };
    window.addEventListener("netbox-route-changed", handleRouteChanged);
    window.addEventListener("netbox-process-master-changed", handleRouteChanged);
    return () => {
      window.removeEventListener("netbox-route-changed", handleRouteChanged);
      window.removeEventListener("netbox-process-master-changed", handleRouteChanged);
    };
  }, []);

  // 切换全局进程分流总开关
  const handleToggleMasterRouting = async () => {
    if (isTogglingMaster) return;
    setIsTogglingMaster(true);
    const nextMaster = !routingState.bundlesEnabled;
    try {
      const nextState: ProcessRoutingState = {
        ...routingState,
        bundlesEnabled: nextMaster,
        processEnabled: nextMaster,
      };
      await saveProcessRoutingState(nextState);
      setRoutingState(nextState);
      if (onShowNotice) {
        onShowNotice(
          nextMaster
            ? "业务规则包分流已全局开启"
            : "业务规则包分流已全局暂停 (全量直连放行)"
        );
      }
    } catch (err: any) {
      if (onShowNotice) onShowNotice(`切换分流总控失败: ${err?.message || err}`);
    } finally {
      setIsTogglingMaster(false);
    }
  };

  // 切换单包独立开关
  const handleToggleBundle = async (bundleId: string, currentEnabled: boolean) => {
    if (togglingBundleId === bundleId) return;
    setTogglingBundleId(bundleId);
    const nextEnabled = !currentEnabled;
    try {
      const updated = await updateBundleInstance(bundleId, { enabled: nextEnabled });
      setBundles(updated);
      const target = updated.find((b) => b.id === bundleId);
      if (onShowNotice) {
        onShowNotice(
          nextEnabled
            ? `已启用业务规则包「${target?.name || bundleId}」`
            : `已停用业务规则包「${target?.name || bundleId}」 (跟随默认)`
        );
      }
    } catch (err: any) {
      if (onShowNotice) onShowNotice(`切换规则包状态失败: ${err?.message || err}`);
    } finally {
      setTogglingBundleId(null);
    }
  };

  const activeBundleCount = useMemo(() => {
    return bundles.filter((b) => b.enabled).length;
  }, [bundles]);

  // 流量波形历史缓冲
  const [downWaveHistory, setDownWaveHistory] = useState<number[]>([
    120000, 240000, 180000, 320000, 480000, 650000, 890000, 1200000,
    1450000, 1850000, 1600000, 2100000,
  ]);

  // 定期更新瞬时波形
  useEffect(() => {
    setDownWaveHistory((prev) => {
      const next = [...prev.slice(1), bandwidth.downloadRateBytes || 0];
      return next;
    });
  }, [bandwidth.downloadRateBytes]);

  // 计算自适应天花板与 SVG 曲线
  const ceilingBps = useMemo(() => {
    const peak = Math.max(...downWaveHistory, 1);
    return calculateAdaptiveCeilingBps(peak);
  }, [downWaveHistory]);

  const downWave = useMemo(
    () => generateSvgWave(downWaveHistory, 60, ceilingBps),
    [downWaveHistory, ceilingBps]
  );

  // 格式化速率字符串
  const formatRate = (bps: number) => {
    const r = formatBitrate(bps);
    return `${r.value} ${r.unit}`;
  };

  // 初始化加载当前节点、系统代理状态与设置
  useEffect(() => {
    getActiveOutboundNode().then(setActiveNode).catch(console.error);
    getSystemProxyState().then(setIsProxyActive).catch(console.error);
    getGeneralSettings().then((s) => {
      setTunMode(Boolean(s.tunMode));
      setAllowLan(Boolean(s.allowLan));
    });

  }, []);

  // 切换系统代理
  const handleToggleProxy = async () => {
    setIsTogglingProxy(true);
    try {
      const next = !isProxyActive;
      await toggleSystemProxy(next);
      setIsProxyActive(next);
      if (onShowNotice) {
        onShowNotice(next ? "系统代理已连接，流量接管生效中" : "系统代理已断开");
      }
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`切换代理失败: ${e?.message || e}`);
    } finally {
      setIsTogglingProxy(false);
    }
  };

  // 切换分流模式 (rule / global / direct)
  const handleChangeMode = async (m: EngineMode) => {
    try {
      await setEngineMode(m);
      if (onShowNotice) {
        onShowNotice(`已切换为: ${m === "rule" ? "智能分流" : m === "global" ? "全局代理" : "直连模式"}`);
      }
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`切换模式失败: ${e?.message || e}`);
    }
  };

  // 打开节点快换抽屉时拉取全量节点
  const handleOpenNodeSheet = async () => {
    setIsNodeSheetOpen(true);
    try {
      const snap = await fetchProxiesData();
      const list: MiniNodeItem[] = Object.values(snap.proxies || {})
        .filter((p: ProxyItem) => !p.all && p.name && p.name !== "DIRECT" && p.name !== "REJECT")
        .map((p: ProxyItem) => ({
          name: p.name,
          type: p.type || "Proxy",
          delay: p.history?.length ? p.history[p.history.length - 1].delay : undefined,
        }));
      setAvailableNodes(list);
    } catch (e) {
      console.warn("拉取节点失败:", e);
    }
  };

  // 快速秒切出站节点
  const handleSelectNode = async (node: MiniNodeItem) => {
    setSwitchingNode(node.name);
    try {
      await switchGroupProxy("GLOBAL", node.name);
      await switchGroupProxy("PROXY", node.name);
      setActiveNode({
        name: node.name,
        type: node.type,
        delay: node.delay,
      });
      setIsNodeSheetOpen(false);
      if (onShowNotice) onShowNotice(`已切换出站线路: ${node.name}`);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`切换节点失败: ${e?.message || e}`);
    } finally {
      setSwitchingNode(null);
    }
  };

  // 快捷网络急救
  const handleFlushDns = async () => {
    setIsRepairingDns(true);
    try {
      await flushDns();
      if (onShowNotice) onShowNotice("网络急救完成: 本地 DNS 缓存已清空");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`急救失败: ${e?.message || e}`);
    } finally {
      setIsRepairingDns(false);
    }
  };

  // 重启核心
  const handleReloadCore = async () => {
    setIsReloadingCore(true);
    try {
      await reloadCoreConfig();
      if (onShowNotice) onShowNotice("代理核心已平滑重启");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`重启核心失败: ${e?.message || e}`);
    } finally {
      setIsReloadingCore(false);
    }
  };

  // 切换 TUN
  const handleToggleTun = async () => {
    const next = !tunMode;
    setTunMode(next);
    await saveGeneralSettings({ tunMode: next, trafficMode: next ? "tun" : "app_proxy" });
    if (onShowNotice) onShowNotice(next ? "TUN 虚拟网卡已启用" : "TUN 虚拟网卡已停用");
  };

  // 切换局域网
  const handleToggleLan = async () => {
    const next = !allowLan;
    setAllowLan(next);
    await saveGeneralSettings({ allowLan: next });
    if (onShowNotice) onShowNotice(next ? "已允许局域网设备接入" : "已关闭局域网连接");
  };

  // 过滤后的节点列表
  const filteredNodes = useMemo(() => {
    if (!nodeSearch.trim()) return availableNodes;
    const q = nodeSearch.toLowerCase();
    return availableNodes.filter((n) => n.name.toLowerCase().includes(q));
  }, [availableNodes, nodeSearch]);

  // 运行时长格式化 (HH:MM:SS)
  const formattedUptime = useMemo(() => {
    const s = status.uptimeSeconds || 0;
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, [status.uptimeSeconds]);

  return (
    <div className="relative flex flex-col justify-between h-full w-full select-none overflow-hidden p-3 bg-transparent text-[var(--text-primary)]">
      {/* ============================================================== */}
      {/* 方案 B 核心重构：三维微型子 Tab 导航条置顶 (一级视图路由器) */}
      {/* 规范: Segmented Control 优先原则，真正的液态毛玻璃水晶导轨 */}
      {/* ============================================================== */}
      <nav
        aria-label="挂件视口导航"
        className="flex items-center gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] backdrop-blur-md mb-2.5 shrink-0"
      >
        {[
          { id: "monitor" as const, label: "监控大盘" },
          { id: "bundles" as const, label: "进程分流" },
          { id: "tools" as const, label: "急救工具" },
        ].map((tab) => {
          const isActive = miniTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMiniTab(tab.id)}
              className={`flex-1 py-1.5 rounded-lg text-center text-[11.5px] transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-[0.97] relative overflow-hidden ${
                isActive
                  ? "glass-pill-active text-slate-900 dark:text-white font-bold"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/20 font-medium"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* ============================================================== */}
      {/* 子视口 1: 监控大盘 (HUD Monitor - 节点卡片归属大盘首位) */}
      {/* ============================================================== */}
      {miniTab === "monitor" && (
        <div className="flex-1 flex flex-col justify-between space-y-2.5 overflow-hidden animate-in fade-in duration-150">
          {/* 出站节点卡片 (双层透光水晶卡片，迎光 1px 晶体白微反光) */}
          <div
            onClick={handleOpenNodeSheet}
            className="p-2.5 px-3 rounded-2xl glass-surface hover:border-indigo-500/40 transition flex items-center justify-between cursor-pointer group shrink-0 active:scale-[0.99] relative overflow-hidden"
            title="点击在小窗内就地切换出站节点"
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-300 font-mono font-bold text-[11px] flex items-center justify-center shrink-0 group-hover:scale-105 transition border border-indigo-500/30 backdrop-blur-sm">
                {activeNode.type ? activeNode.type.slice(0, 3).toUpperCase() : "PROX"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                  {activeNode.name}
                </div>
                <div className="text-[10px] font-mono text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                  <span>{activeNode.type || "HY2"}</span>
                  <span className="opacity-40">·</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500 animate-pulse" />
                    <span>{activeNode.delay ? `${activeNode.delay}ms` : "在线"}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-500 transition shrink-0 pl-2">
              <span>换节点</span>
              <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
          {/* 中央触觉系统代理大开关 */}
          <div className="flex-1 flex flex-col items-center justify-center py-2 min-h-[110px]">
            <button
              type="button"
              onClick={handleToggleProxy}
              disabled={isTogglingProxy}
              className="group flex flex-col items-center cursor-pointer outline-none focus:outline-none"
            >
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 relative ${
                  isProxyActive
                    ? "bg-gradient-to-tr from-indigo-600 to-sky-500 text-white shadow-lg shadow-indigo-500/35 group-hover:scale-105"
                    : "glass-surface text-[var(--text-muted)] hover:text-indigo-600 hover:border-indigo-400/60 group-hover:scale-105 shadow-md"
                }`}
              >
                {/* 细线电源图标 */}
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>

                {/* 激活时的柔和外发光 */}
                {isProxyActive && (
                  <div className="absolute -inset-1 rounded-full bg-indigo-500/25 blur-lg pointer-events-none animate-pulse" />
                )}
              </div>

              <div className="mt-2.5 text-center">
                <div className="text-xs font-bold text-[var(--text-primary)] tracking-tight">
                  {isProxyActive ? "系统代理已连接" : "系统代理已断开"}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                  {isProxyActive ? "流量与进程接管中" : "点击连接开启分流"}
                </div>
                <div className="text-[9px] text-[var(--text-muted)]/70 font-mono mt-0.5">
                  常驻: {formattedUptime} · 内存: {formatMemoryBytes(status.memoryUsageBytes)}
                </div>
              </div>
            </button>
          </div>

          {/* 分流模式三段滑块 (液态磨砂导轨) */}
          <div className="p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] backdrop-blur-md grid grid-cols-3 gap-1 shrink-0">
            {[
              { id: "rule" as const, label: "智能分流" },
              { id: "global" as const, label: "全局代理" },
              { id: "direct" as const, label: "直连模式" },
            ].map((m) => {
              const isSelected = status.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleChangeMode(m.id)}
                  className={`py-1.5 rounded-lg text-center text-[10.5px] font-semibold transition cursor-pointer whitespace-nowrap active:scale-[0.97] ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 font-bold"
                      : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/20"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* 实时微波形卡片 Sparkline (双层透光晶体玻璃) */}
          <div className="p-3 rounded-2xl glass-surface shadow-xs flex flex-col justify-between shrink-0 overflow-hidden relative">
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
            <div className="flex items-center justify-between text-[11px] font-mono shrink-0 mb-1 z-10">
              <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="tabular-nums font-bold">
                  {formatRate(bandwidth.downloadRateBytes)}
                </span>
              </span>
              <span className="text-sky-700 dark:text-sky-400 font-bold flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                <span className="tabular-nums font-bold">
                  {formatRate(bandwidth.uploadRateBytes)}
                </span>
              </span>
            </div>

            {/* 动态 SVG 微波形 */}
            <div className="h-10 w-full overflow-hidden flex items-end relative">
              <svg className="w-full h-full" viewBox="0 0 300 52" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="miniTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path d={downWave.areaD} fill="url(#miniTrafficGrad)" />
                <path d={downWave.pathD} fill="none" stroke="#10b981" strokeWidth={1.5} />
              </svg>
            </div>
          </div>

          {/* 底层开关：TUN 虚拟网卡与允许局域网 (液态磨砂水晶底托盘 - 微型滑动开关) */}
          <div className="p-2 px-3.5 rounded-xl bg-white/35 dark:bg-white/[0.04] border border-white/65 dark:border-white/[0.08] backdrop-blur-md flex items-center justify-between text-[11px] shrink-0 mb-1 shadow-2xs">
            {/* TUN 虚拟网卡 */}
            <div
              role="switch"
              aria-checked={tunMode}
              onClick={handleToggleTun}
              className="flex items-center gap-2 cursor-pointer select-none group"
              title={tunMode ? "点击停用 TUN 虚拟网卡" : "点击启用 TUN 虚拟网卡"}
            >
              <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] font-medium transition-colors">
                TUN 虚拟网卡
              </span>
              <div
                className={`w-7 h-4 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 ${
                  tunMode
                    ? "bg-indigo-600 shadow-sm shadow-indigo-500/25"
                    : "bg-slate-300 group-hover:bg-slate-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-600"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                    tunMode ? "translate-x-3" : "translate-x-0"
                  }`}
                />
              </div>
            </div>

            {/* 细腻中线分隔 */}
            <div className="w-px h-3.5 bg-black/[0.08] dark:bg-white/[0.10]" />

            {/* 允许局域网 */}
            <div
              role="switch"
              aria-checked={allowLan}
              onClick={handleToggleLan}
              className="flex items-center gap-2 cursor-pointer select-none group"
              title={allowLan ? "点击关闭局域网连接" : "点击允许局域网设备接入"}
            >
              <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] font-medium transition-colors">
                允许局域网
              </span>
              <div
                className={`w-7 h-4 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 ${
                  allowLan
                    ? "bg-indigo-600 shadow-sm shadow-indigo-500/25"
                    : "bg-slate-300 group-hover:bg-slate-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-600"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                    allowLan ? "translate-x-3" : "translate-x-0"
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 子视口 2: 进程分流与真实业务规则包 (Process Routing & Bundles) */}
      {/* 规范: 彻底清除假数据，双层开关互锁，等宽排版，双层毛玻璃晶体拟态 */}
      {/* ============================================================== */}
      {miniTab === "bundles" && (
        <div className="flex-1 flex flex-col justify-between py-1 animate-in fade-in duration-150 overflow-hidden space-y-2">
          {/* 1. 顶层：全局进程分流总开关控制条 (Master Routing Strip - 液态晶体导轨) */}
          <div
            className={`p-2.5 rounded-xl border flex items-center justify-between transition-all duration-200 select-none shrink-0 relative overflow-hidden ${
              routingState.bundlesEnabled
                ? "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-600/30 dark:border-emerald-500/30 shadow-xs"
                : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)] opacity-85"
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isTogglingMaster
                    ? "bg-amber-400 animate-pulse"
                    : routingState.bundlesEnabled
                    ? "bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_8px_rgba(5,150,105,0.4)]"
                    : "bg-slate-400 dark:bg-zinc-500"
                }`}
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 truncate">
                  <span>业务包分流</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-medium ${
                      routingState.bundlesEnabled
                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-semibold"
                        : "bg-slate-200 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {isTogglingMaster
                      ? "切换中..."
                      : routingState.bundlesEnabled
                      ? `运行中 (${activeBundleCount}/${bundles.length})`
                      : "已暂停 (全量直连)"}
                  </span>
                </div>
              </div>
            </div>

            {/* 全局 Master 滑动开关 */}
            <button
              type="button"
              role="switch"
              aria-checked={routingState.bundlesEnabled}
              disabled={isTogglingMaster}
              onClick={handleToggleMasterRouting}
              className={`w-9 h-5 rounded-full transition-colors duration-200 relative p-0.5 cursor-pointer shrink-0 ${
                routingState.bundlesEnabled
                  ? "bg-emerald-600 dark:bg-emerald-500"
                  : "bg-slate-300 hover:bg-slate-400 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              }`}
              title={routingState.bundlesEnabled ? "点击暂停全局进程分流" : "点击开启全局进程分流"}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                  routingState.bundlesEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* 2. 标题与状态提示 */}
          <div className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between px-1 shrink-0">
            <span>已装载业务规则包</span>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {isLoadingBundles
                ? "读取中..."
                : routingState.bundlesEnabled
                ? `${activeBundleCount} 个生效中`
                : "全量直连放行"}
            </span>
          </div>

          {/* 3. 真实规则包列表 */}
          <div className="space-y-1.5 flex-1 overflow-y-auto pr-0.5 scrollbar-none">
            {bundles.length === 0 ? (
              <div className="h-32 flex flex-col items-center justify-center text-center p-4 rounded-xl border border-dashed border-[var(--glass-border-subtle)] text-[var(--text-muted)]">
                <svg className="w-6 h-6 text-zinc-400 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <div className="text-xs font-medium text-[var(--text-secondary)]">暂无业务规则包</div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">请在大窗口中添加或从仓库导入</div>
              </div>
            ) : (
              bundles.map((bundle) => {
                const isItemActive = bundle.enabled && routingState.bundlesEnabled;
                const isToggling = togglingBundleId === bundle.id;
                // 主进程显示
                const processSummary =
                  bundle.exes && bundle.exes.length > 0
                    ? bundle.exes.slice(0, 2).join(", ") + (bundle.exes.length > 2 ? ` +${bundle.exes.length - 2}` : "")
                    : bundle.mainExe || "未指定进程";
                // 真实绑定节点
                const boundNode = bundle.targetProxy || "未选出口";

                return (
                  <div
                    key={bundle.id}
                    className={`p-2.5 rounded-xl glass-surface flex items-center justify-between text-xs transition-all duration-150 relative overflow-hidden group ${
                      !routingState.bundlesEnabled
                        ? "opacity-60"
                        : isItemActive
                        ? "hover:border-indigo-500/40"
                        : "opacity-75"
                    }`}
                  >
                    {/* 顶部 1px 细微物理发丝高光 */}
                    <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />

                    {/* 左侧：包名 + 进程清单 */}
                    <div className="min-w-0 pr-3 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                            isItemActive
                              ? "bg-indigo-600 dark:bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                              : "bg-slate-400 dark:bg-zinc-600"
                          }`}
                        />
                        <span className="font-semibold text-[var(--text-primary)] text-[12px] truncate">
                          {bundle.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono truncate pl-3.5 mt-0.5">
                        {processSummary}
                      </div>
                    </div>

                    {/* 右侧操作区：标准尺寸独立开关 (对齐顶部总开关: 36×20px, 杜绝错位) */}
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={bundle.enabled}
                        disabled={!routingState.bundlesEnabled || isToggling}
                        onClick={() => handleToggleBundle(bundle.id, bundle.enabled)}
                        className={`w-9 h-5 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 active:scale-95 ${
                          !routingState.bundlesEnabled
                            ? "bg-slate-200 dark:bg-zinc-800 cursor-not-allowed opacity-40"
                            : bundle.enabled
                            ? "bg-indigo-600 hover:bg-indigo-500 cursor-pointer shadow-sm shadow-indigo-500/25"
                            : "bg-slate-300 hover:bg-slate-400 dark:bg-zinc-700 dark:hover:bg-zinc-600 cursor-pointer"
                        }`}
                        title={
                          !routingState.bundlesEnabled
                            ? "全局分流已暂停"
                            : bundle.enabled
                            ? `已启用 (出口: ${boundNode})，点击停用`
                            : `已停用 (出口: ${boundNode})，点击启用`
                        }
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            bundle.enabled ? "translate-x-4" : "translate-x-0"
                          } ${isToggling ? "opacity-75" : ""}`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 4. 底部入口按钮 */}
          <button
            type="button"
            onClick={() => {
              onSetFormFactor("standard");
              if (onNavigateTab) onNavigateTab("process");
            }}
            className="w-full py-2 rounded-xl glass-surface hover:bg-[var(--glass-bg-hover)] active:scale-[0.98] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs shrink-0 whitespace-nowrap"
          >
            <span>在大窗口中深入配置分流规则</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* 子视口 3: 运维急救箱与还原展开 (Quick Tools) */}
      {/* ============================================================== */}
      {miniTab === "tools" && (
        <div className="flex-1 flex flex-col justify-between py-1 animate-in fade-in duration-150 space-y-3">
          <div className="space-y-2">
            {/* 端口指标 (双层毛玻璃晶体) */}
            <div className="p-2.5 rounded-xl glass-surface shadow-xs flex items-center justify-between text-xs relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
              <div>
                <div className="font-semibold text-[var(--text-primary)]">混合代理端口</div>
                <div className="text-[10px] text-[var(--text-muted)] font-mono">
                  HTTP / SOCKS5: {status.mixedPort || 7890}
                </div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-mono font-medium border border-emerald-500/20">
                常驻监听
              </span>
            </div>

            {/* 网络急救刷新 DNS 按钮 */}
            <button
              type="button"
              onClick={handleFlushDns}
              disabled={isRepairingDns}
              className="w-full p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 text-amber-800 dark:text-amber-400 text-xs font-semibold transition cursor-pointer flex items-center justify-between shrink-0 shadow-xs relative overflow-hidden"
            >
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-amber-400/40 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>一键刷新 DNS 缓存与修复网络</span>
              </div>
              {isRepairingDns && <span className="animate-spin text-xs">●</span>}
            </button>

            {/* 平滑重启核心 */}
            <button
              type="button"
              onClick={handleReloadCore}
              disabled={isReloadingCore}
              className="w-full p-2.5 rounded-xl glass-surface hover:bg-[var(--glass-bg-hover)] text-[var(--text-primary)] text-xs font-semibold transition cursor-pointer flex items-center justify-between shrink-0 shadow-xs relative overflow-hidden"
            >
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>平滑重启核心与重载最新配置</span>
              </div>
              {isReloadingCore && <span className="animate-spin text-xs">●</span>}
            </button>
          </div>

          {/* 还原展开大窗口工作台 */}
          <button
            type="button"
            onClick={() => onSetFormFactor("standard")}
            className="w-full p-2.5 rounded-xl glass-surface hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold transition cursor-pointer flex items-center justify-between shrink-0 shadow-xs relative overflow-hidden"
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              <span>还原全尺寸标准工作台 (1160×740)</span>
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">STAND</span>
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* 就地节点快换抽屉 (In-place Bottom Sheet - 沉浸毛玻璃抽屉) */}
      {/* ============================================================== */}
      {isNodeSheetOpen && (
        <div className="absolute inset-0 z-50 glass-hud-window flex flex-col p-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
          {/* 抽屉顶栏 */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-border-subtle)] shrink-0">
            <span className="text-xs font-bold text-[var(--text-primary)]">选择出站节点线路</span>
            <button
              type="button"
              onClick={() => setIsNodeSheetOpen(false)}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-hover)] transition cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 节点搜索框 */}
          <div className="py-2 shrink-0">
            <input
              type="text"
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              placeholder="搜索节点名称..."
              className="w-full px-2.5 py-1.5 rounded-lg glass-surface border border-[var(--glass-border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-500 font-mono shadow-xs"
            />
          </div>

          {/* 节点列表 */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-none">
            {filteredNodes.length > 0 ? (
              filteredNodes.map((n) => {
                const isSelected = activeNode.name === n.name;
                const isBusy = switchingNode === n.name;
                return (
                  <div
                    key={n.name}
                    onClick={() => handleSelectNode(n)}
                    className={`p-2 rounded-xl border text-xs flex items-center justify-between transition cursor-pointer relative overflow-hidden ${
                      isSelected
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-500/20 dark:border-indigo-400 dark:text-indigo-300 font-semibold shadow-xs"
                        : "glass-surface border-[var(--glass-border-subtle)] text-[var(--text-secondary)] hover:border-indigo-400/50 shadow-2xs"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold truncate">{n.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                        {n.type} · {n.delay ? `${n.delay}ms` : "在线"}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {isBusy && <span className="animate-spin text-xs">●</span>}
                      {isSelected && (
                        <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-xs text-[var(--text-muted)]">
                暂无匹配节点
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
