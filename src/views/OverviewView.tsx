import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Zap,
  RefreshCw,
  Copy,
  ChevronRight,
  ShieldCheck,
  Power,
  Activity,
  Layers,
  Radio,
  Wifi,
  Eraser,
  RotateCw,
  Settings,
  ArrowDown,
  ArrowUp,
  Check,
} from "lucide-react";
import { CoreStatus } from "../types";
import type { CoreMode } from "../utils/coreModeController";
import { useExitIpHealth } from "../hooks/useExitIpHealth";
import { useTraffic } from "../hooks/useTraffic";
import { toggleCore, toggleSystemProxy, isTauri, getDnsGuardInfo, type DnsGuardInfo } from "../api";
import { getDnsListenerStatus, type DnsListenerStatus } from "../api/dns";
import { getGeneralSettings, saveGeneralSettings } from "../api/settings";
import { ExclusionsDialog } from "../components/ExclusionsDialog";
import { useExclusions } from "../hooks/useExclusions";
import { useBusinessBundles } from "../hooks/useBusinessBundles";
import { fetchProxies } from "../api/mihomo";
import type { FormFactor } from "../hooks/useWindowFormFactor";
import type { LocalNodeSummary } from "../types/localNodes";

interface OverviewViewProps {
  coreStatus: CoreStatus;
  mode: CoreMode | null | string;
  coreMode: {
    mode: CoreMode | null | string;
    busy: boolean;
    error: string | null;
    change: (newMode: any) => Promise<any>;
  };
  activeNodeName?: string;
  localNodeSummaries?: LocalNodeSummary[] | null;
  formFactor: FormFactor;
  setFormFactor: (factor: FormFactor) => void;
  onNavigateTab: (tab: string) => void;
  exclusions: ReturnType<typeof useExclusions>;
  onRefreshCoreStatus?: () => Promise<void>;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  coreStatus,
  mode,
  coreMode,
  activeNodeName = "",
  localNodeSummaries,
  formFactor,
  setFormFactor,
  onNavigateTab,
  exclusions,
  onRefreshCoreStatus,
}) => {
  // 1. 出口 IP 体检
  const { data: exitData, loading: exitLoading, loadData: reloadExitHealth } = useExitIpHealth(
    coreStatus.running ? coreStatus.mixedPort : undefined,
    coreStatus.pid
  );

  // 2. 流量遥测与波形数据缓冲
  const { reading: trafficReading } = useTraffic();
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // 3. 运行耗时秒表走字
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const localStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!coreStatus.running) {
      setUptimeSeconds(0);
      localStartRef.current = null;
      return;
    }
    const startSecs = coreStatus.startedAt || localStartRef.current || Math.floor(Date.now() / 1000);
    if (!localStartRef.current) localStartRef.current = startSecs;

    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const effectiveStart = coreStatus.startedAt || startSecs;
      setUptimeSeconds(Math.max(0, now - effectiveStart));
    }, 1000);

    return () => clearInterval(timer);
  }, [coreStatus.running, coreStatus.startedAt]);

  const formattedUptime = useMemo(() => {
    if (!coreStatus.running || uptimeSeconds === 0) return "--:--:--";
    const h = Math.floor(uptimeSeconds / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = uptimeSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, [coreStatus.running, uptimeSeconds]);

  // 4. 实时流量滑动窗口采样 (保留 60 个数据点用于平滑 SVG 曲线)
  const [downWaveHistory, setDownWaveHistory] = useState<number[]>(() => new Array(60).fill(0));
  const [upWaveHistory, setUpWaveHistory] = useState<number[]>(() => new Array(60).fill(0));

  useEffect(() => {
    const downMB = trafficReading.downSpeed / (1024 * 1024);
    const upMB = trafficReading.upSpeed / (1024 * 1024);
    setDownWaveHistory((prev) => [...prev.slice(1), downMB]);
    setUpWaveHistory((prev) => [...prev.slice(1), upMB]);
  }, [trafficReading.downSpeed, trafficReading.upSpeed]);

  // 5. 设置项 (TUN、允许局域网与仅统计代理)
  const [tunEnabled, setTunEnabled] = useState(false);
  const [allowLan, setAllowLan] = useState(false);
  const [onlyProxyTraffic, setOnlyProxyTraffic] = useState(true);
  const [lanPending, setLanPending] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await getGeneralSettings();
        setTunEnabled(s.tunMode || s.trafficMode === "tun");
        setAllowLan(s.allowLan);
        setOnlyProxyTraffic(s.onlyProxyTraffic ?? true);
      } catch {}
    };
    loadSettings();
    window.addEventListener("netbox-settings-saved", loadSettings);
    return () => window.removeEventListener("netbox-settings-saved", loadSettings);
  }, []);

  const handleToggleTun = async () => {
    try {
      const current = await getGeneralSettings();
      const nextTun = !tunEnabled;
      setTunEnabled(nextTun);
      await saveGeneralSettings({
        ...current,
        tunMode: nextTun,
        trafficMode: nextTun ? "tun" : "app_proxy",
      });
      showNotice(nextTun ? "TUN 虚拟网卡已启用" : "TUN 虚拟网卡已关闭");
    } catch (e) {
      console.error("切换 TUN 失败:", e);
    }
  };

  const handleToggleLan = async () => {
    if (lanPending) return;
    const previous = allowLan;
    const nextLan = !previous;
    setLanPending(true);
    setAllowLan(nextLan);
    try {
      const current = await getGeneralSettings();
      await saveGeneralSettings({
        ...current,
        allowLan: nextLan,
      });
      showNotice(nextLan ? "已允许局域网设备连接" : "已关闭局域网连接");
    } catch (e: any) {
      setAllowLan(previous);
      console.error("切换允许局域网失败:", e);
      showNotice(`切换允许局域网失败: ${e?.message || e || "未知错误"}`);
    } finally {
      setLanPending(false);
    }
  };

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 2500);
  };

  // 6. 系统代理连接与断开总控 (Hero 大按钮核心映射)
  const isProxyActive = coreStatus.systemProxy
    ? coreStatus.systemProxy.state === "enabled"
    : Boolean(coreStatus.systemProxyEnabled);

  const [proxyPending, setProxyPending] = useState(false);

  useEffect(() => {
    const handleSysproxyChange = () => {
      void onRefreshCoreStatus?.();
    };
    window.addEventListener("netbox-sysproxy-changed", handleSysproxyChange);
    return () => window.removeEventListener("netbox-sysproxy-changed", handleSysproxyChange);
  }, [onRefreshCoreStatus]);

  const handleToggleProxy = async () => {
    if (proxyPending) return;
    setProxyPending(true);
    try {
      // 1. 若核心意外未运行，自动拉起核心
      if (!coreStatus.running) {
        showNotice("正在启动核心网络服务...");
        await toggleCore(true);
        await onRefreshCoreStatus?.();
      }
      // 2. 切换系统代理接管状态
      const nextEnable = !isProxyActive;
      const port = coreStatus.mixedPort || 7890;
      await toggleSystemProxy(nextEnable, port);
      await onRefreshCoreStatus?.();
      showNotice(nextEnable ? "系统代理已连接 · 流量接管中" : "系统代理已断开 · 直连模式");
    } catch (err) {
      console.error("切换系统代理失败:", err);
      showNotice(`切换失败: ${String(err)}`);
    } finally {
      setProxyPending(false);
    }
  };


  // 7. 节点协议与 UDP 真实能力探查
  const [activeNodeDetails, setActiveNodeDetails] = useState<{
    type: string;
    udp: boolean;
  } | null>(null);

  useEffect(() => {
    if (!coreStatus.running || !activeNodeName) {
      setActiveNodeDetails(null);
      return;
    }
    let unmounted = false;
    fetchProxies()
      .then((res) => {
        if (unmounted) return;
        const target = res.proxies?.[activeNodeName];
        if (target) {
          setActiveNodeDetails({
            type: target.type || "Unknown",
            udp: Boolean(target.udp),
          });
        } else {
          setActiveNodeDetails(null);
        }
      })
      .catch(() => {
        if (!unmounted) setActiveNodeDetails(null);
      });
    return () => {
      unmounted = true;
    };
  }, [coreStatus.running, activeNodeName]);

  // 8. 分流业务包真实状态快照
  const bundleState = useBusinessBundles();
  const activeBundlesCount = useMemo(
    () => bundleState.instances.filter((i) => i.enabled).length,
    [bundleState.instances]
  );
  const totalBundlesCount = bundleState.instances.length;
  const processCount = useMemo(
    () => bundleState.view?.config.processRules?.length ?? 0,
    [bundleState.view]
  );
  const isProcessMasterOn = bundleState.view?.config.processEnabled !== false;

  // 9. DNS 智能护航与本地监听状态
  const [dnsGuard, setDnsGuard] = useState<DnsGuardInfo | null>(null);
  const [dnsListener, setDnsListener] = useState<DnsListenerStatus | null>(null);

  useEffect(() => {
    const loadDnsStatus = () => {
      getDnsGuardInfo().then(setDnsGuard).catch(() => setDnsGuard(null));
      getDnsListenerStatus().then(setDnsListener).catch(() => setDnsListener(null));
    };
    loadDnsStatus();
    window.addEventListener("procweaver-dns-guard-changed", loadDnsStatus);
    window.addEventListener("netbox-settings-saved", loadDnsStatus);
    return () => {
      window.removeEventListener("procweaver-dns-guard-changed", loadDnsStatus);
      window.removeEventListener("netbox-settings-saved", loadDnsStatus);
    };
  }, []);

  // 10. 核心配置重载与 DNS 彻底清理真实动作
  const [isReloading, setIsReloading] = useState(false);
  const [isFlushingDns, setIsFlushingDns] = useState(false);

  const handleReloadConfig = async () => {
    if (isReloading) return;
    setIsReloading(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("restart_core");
      }
      await onRefreshCoreStatus?.();
      showNotice("核心配置已平滑重载生效");
    } catch (err) {
      console.error("重载配置失败:", err);
      showNotice(`重载失败: ${String(err)}`);
    } finally {
      setIsReloading(false);
    }
  };

  const handleFlushDns = async () => {
    if (isFlushingDns) return;
    setIsFlushingDns(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("execute_tray_menu_action", { id: "tool:flush_dns" });
      }
      showNotice("系统 DNS 缓存与 Fake-IP 映射已彻底清空");
    } catch (err) {
      console.error("清理 DNS 失败:", err);
      showNotice(`清理失败: ${String(err)}`);
    } finally {
      setIsFlushingDns(false);
    }
  };

  // 11. 复制出口 IP
  const handleCopyIp = () => {
    if (!exitData?.ip) return;
    navigator.clipboard.writeText(exitData.ip);
    showNotice(`已复制出口 IP: ${exitData.ip}`);
  };

  // 9. 格式化速率与字节数
  const formatSpeed = (bytesPerSec: number) => {
    if (!bytesPerSec || bytesPerSec <= 0) return "0.0 MB/s";
    const mb = bytesPerSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
    const kb = bytesPerSec / 1024;
    return `${kb.toFixed(1)} KB/s`;
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return "0.0 GB";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // 生成 SVG 路径算法 (根据 60 个历史采样点生成光滑平原贝塞尔曲线)
  const generateSvgPath = (history: number[], maxHeight = 100) => {
    const maxVal = Math.max(...history, 5); // 至少 5 MB/s 基准缩放
    const points = history.map((val, idx) => {
      const x = (idx / (history.length - 1)) * 1000;
      const y = maxHeight - Math.min(maxHeight, (val / maxVal) * (maxHeight * 0.85));
      return { x, y };
    });

    if (points.length < 2) return { pathD: "M0,100 L1000,100", areaD: "M0,100 L1000,100 Z" };

    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const cx = (prev.x + cur.x) / 2;
      d += ` Q ${prev.x},${prev.y} ${cx},${(prev.y + cur.y) / 2}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x},${last.y}`;

    const areaD = `${d} L 1000,${maxHeight} L 0,${maxHeight} Z`;
    return { pathD: d, areaD, lastY: last.y };
  };

  const downWave = useMemo(() => generateSvgPath(downWaveHistory, 100), [downWaveHistory]);
  const upWave = useMemo(() => generateSvgPath(upWaveHistory, 100), [upWaveHistory]);

  // 迷你挂件子 Tab 状态
  const [miniTab, setMiniTab] = useState<"overview" | "bundles" | "settings">("overview");

  // 当前节点名称匹配别名
  const displayNodeName = useMemo(() => {
    if (!activeNodeName) return "未指定节点 (待命中)";
    const found = localNodeSummaries?.find((n) => n.alias === activeNodeName);
    return found?.name || activeNodeName;
  }, [activeNodeName, localNodeSummaries]);

  // 风险分元数据
  const fraudScore = exitData?.fraudScore ?? 12;
  const fraudText =
    fraudScore <= 25 ? "极佳 · 低风险" : fraudScore <= 60 ? "良好 · 常见机房" : "风险较高 · 需注意";
  const fraudColor =
    fraudScore <= 25
      ? "text-emerald-600 dark:text-emerald-400"
      : fraudScore <= 60
      ? "text-amber-600 dark:text-amber-400"
      : "text-rose-600 dark:text-rose-400";

  // =========================================================================
  // 形态 B：迷你挂件视图 (Mini Widget 380×580)
  // =========================================================================
  if (formFactor === "mini") {
    return (
      <div
        id="mini-widget-layout"
        className="flex-1 flex flex-col justify-between p-3.5 select-none relative overflow-hidden h-full"
      >
        {/* 操作提示 Toast */}
        {actionNotice && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1 rounded-full bg-slate-900/90 dark:bg-white/90 text-white dark:text-slate-900 text-[11px] font-medium shadow-lg animate-in fade-in zoom-in duration-150">
            {actionNotice}
          </div>
        )}

        {/* 顶部一体化节点切换卡片 */}
        <div
          id="mini-top-node-card"
          onClick={() => onNavigateTab("proxies")}
          className="py-1.5 px-2.5 rounded-xl flex items-center justify-between bg-slate-100/70 hover:bg-slate-200/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border hairline-divider transition group cursor-pointer shrink-0"
          title="点击切换出站节点线路"
        >
          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 font-bold font-mono text-xs flex items-center justify-center shrink-0 group-hover:scale-105 transition">
              {activeNodeName ? activeNodeName.slice(0, 2).toUpperCase() : "PROX"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                {displayNodeName}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1.5">
                <span>HY2</span>
                <span className="opacity-40">·</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                  <span>24ms</span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 text-slate-600 dark:text-slate-300 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition shrink-0 pl-2 text-xs font-semibold">
            <span className="text-[11px]">换节点</span>
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* 驱动控制微条 */}
        <div className="flex items-center justify-between py-1.5 px-2.5 rounded-xl bg-slate-100/60 dark:bg-white/[0.03] border hairline-divider text-xs shrink-0 mt-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-slate-400 text-[10.5px] font-medium shrink-0">分流驱动:</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
              <Zap className="w-3 h-3" />
              <span>用户态hook</span>
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 truncate ml-2">
            6/6 业务包生效
          </div>
        </div>

        {/* 迷你 3 大子 Tab (概览 / 业务包 / 设置) */}
        <div className="p-1 rounded-xl bg-slate-100 dark:bg-white/[0.04] grid grid-cols-3 gap-1 text-xs font-bold shrink-0 mt-2 border hairline-divider">
          <button
            onClick={() => setMiniTab("overview")}
            className={`py-1.5 rounded-lg text-center font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              miniTab === "overview"
                ? "bg-white dark:bg-white/[0.15] text-slate-900 dark:text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-sky-500" />
            <span>概览</span>
          </button>
          <button
            onClick={() => setMiniTab("bundles")}
            className={`py-1.5 rounded-lg text-center font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              miniTab === "bundles"
                ? "bg-white dark:bg-white/[0.15] text-slate-900 dark:text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            <span>业务包</span>
          </button>
          <button
            onClick={() => setMiniTab("settings")}
            className={`py-1.5 rounded-lg text-center font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              miniTab === "settings"
                ? "bg-white dark:bg-white/[0.15] text-slate-900 dark:text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-amber-500" />
            <span>设置</span>
          </button>
        </div>

        {/* 迷你概览 Tab */}
        {miniTab === "overview" && (
          <div className="flex-1 flex flex-col justify-between py-1 animate-in fade-in duration-150">
            {/* 居中 Hero 大系统代理开关 */}
            <div className="flex-1 flex flex-col items-center justify-center py-2.5 min-h-[110px]">
              <div
                onClick={handleToggleProxy}
                className="cursor-pointer group flex flex-col items-center select-none"
              >
                <div
                  className={`w-15 h-15 rounded-full text-white flex items-center justify-center shadow-xl transition-all relative ${
                    isProxyActive
                      ? "bg-gradient-to-tr from-sky-500 via-indigo-600 to-sky-400 shadow-sky-500/35 group-hover:scale-105"
                      : "bg-slate-300 dark:bg-slate-700/80 text-slate-500 dark:text-slate-400 shadow-slate-500/15 group-hover:bg-slate-400 dark:group-hover:bg-slate-600"
                  }`}
                >
                  <Power className="w-7 h-7" />
                  {isProxyActive && (
                    <div className="absolute -inset-1 rounded-full bg-sky-500/35 blur-xl animate-pulse pointer-events-none" />
                  )}
                </div>
                <div className="mt-2 text-center">
                  <div className="font-bold text-xs text-slate-900 dark:text-white tracking-wide">
                    {isProxyActive ? "系统代理已连接" : "系统代理已断开"}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {isProxyActive ? "流量接管生效中" : "点击连接系统代理"}
                  </div>
                  <div className="text-[9px] text-slate-400/80 font-mono mt-0.5">
                    内核常驻: {formattedUptime}
                  </div>
                </div>
              </div>
            </div>

            {/* 模式选择三段滑块 */}
            <div className="p-1 rounded-xl bg-slate-100 dark:bg-white/[0.04] grid grid-cols-3 gap-1 text-xs shrink-0 my-1 border hairline-divider">
              {(["rule", "global", "direct"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => coreMode.change(m)}
                  disabled={coreMode.busy}
                  className={`py-1 rounded-lg text-center transition cursor-pointer text-[10.5px] font-bold ${
                    mode === m
                      ? "bg-white dark:bg-white/[0.15] text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {m === "rule" ? "智能分流" : m === "global" ? "全局代理" : "直连模式"}
                </button>
              ))}
            </div>

            {/* 迷你实时流量波形卡片 */}
            <div className="py-2.5 px-3 rounded-xl bg-slate-100/70 dark:bg-white/[0.03] border hairline-divider flex flex-col justify-between shrink-0 my-1 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-mono shrink-0 mb-1.5 z-10">
                <span className="text-sky-500 dark:text-sky-400 font-bold flex items-center gap-1">
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span className="text-xs font-extrabold tracking-tight">
                    {formatSpeed(trafficReading.downSpeed)}
                  </span>
                </span>
                <span className="text-violet-500 dark:text-violet-400 font-bold flex items-center gap-1">
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span className="text-xs font-extrabold tracking-tight">
                    {formatSpeed(trafficReading.upSpeed)}
                  </span>
                </span>
              </div>
              <div className="h-12 w-full overflow-hidden flex items-end relative">
                <svg className="w-full h-full" viewBox="0 0 300 52" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="miniTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={downWave.areaD} fill="url(#miniTrafficGrad)" />
                  <path d={downWave.pathD} fill="none" stroke="#0ea5e9" strokeWidth="2" />
                </svg>
              </div>
            </div>

            {/* 迷你开关 */}
            <div className="pt-1.5 pb-0.5 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-700 dark:text-slate-300 font-medium text-[11px]">
                  TUN 虚拟网卡
                </span>
                <div
                  onClick={handleToggleTun}
                  className={`capsule-toggle ${tunEnabled ? "active" : ""}`}
                >
                  <div className="capsule-thumb" />
                </div>
              </div>
              <div
                onClick={handleToggleLan}
                className={`flex items-center space-x-1.5 cursor-pointer select-none group ${lanPending ? "opacity-60 pointer-events-none" : ""}`}
                title="点击切换允许局域网设备接入"
              >
                <span className="text-slate-700 dark:text-slate-300 font-medium text-[11px] group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                  允许局域网
                </span>
                <div
                  className={`capsule-toggle ${allowLan ? "active" : ""}`}
                >
                  <div className="capsule-thumb" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 迷你业务包 Tab */}
        {miniTab === "bundles" && (
          <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in duration-150 space-y-2 overflow-y-auto">
            <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between px-1">
              <span>托管中的业务规则包</span>
              <span className="text-indigo-500 font-mono text-[10px]">6 个已加载</span>
            </div>
            <div className="space-y-1.5 flex-1">
              {[
                { name: "OpenAI / Claude AI 助手", app: "cursor, chatgpt", status: "强制隔离" },
                { name: "反重力开发者开发套件", app: "antigravity.exe", status: "专线直连" },
                { name: "Steam / Epic 游戏加速", app: "steam.exe", status: "UDP 优化" },
                { name: "Git / 代码托管聚合", app: "git.exe", status: "智能分流" },
                { name: "Telegram 通讯套件", app: "telegram.exe", status: "专线代理" },
                { name: "Netflix 流媒体解锁", app: "chrome.exe", status: "家庭宽带" },
              ].map((b, i) => (
                <div
                  key={i}
                  className="p-2 rounded-xl bg-slate-100/60 dark:bg-white/[0.03] border hairline-divider flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {b.name}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">{b.app}</div>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-mono shrink-0">
                    {b.status}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setFormFactor("standard");
                onNavigateTab("routing");
              }}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] text-xs font-semibold text-slate-700 dark:text-slate-200 transition text-center cursor-pointer border hairline-divider"
            >
              在大窗口中深入配置业务包 →
            </button>
          </div>
        )}

        {/* 迷你设置 Tab */}
        {miniTab === "settings" && (
          <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in duration-150 space-y-3">
            <div className="space-y-2">
              <div className="p-2.5 rounded-xl bg-slate-100/60 dark:bg-white/[0.03] border hairline-divider flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">混合代理端口</div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    HTTP / SOCKS5: {coreStatus.mixedPort || 7890}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFormFactor("standard");
                    onNavigateTab("settings");
                  }}
                  className="text-xs text-sky-600 hover:underline cursor-pointer"
                >
                  修改
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-100/60 dark:bg-white/[0.03] border hairline-divider flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">内核控制器端口</div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    REST API: {coreStatus.controllerPort || 9090}
                  </div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-mono">
                  活跃
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setFormFactor("standard");
                onNavigateTab("settings");
              }}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] text-xs font-semibold text-slate-700 dark:text-slate-200 transition text-center cursor-pointer border hairline-divider"
            >
              展开完整设置大盘 →
            </button>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 形态 A：一体化全景主控台 (Standard / Compact / Studio)
  // =========================================================================
  return (
    <div
      id="standard-dashboard-layout"
      className="flex-1 flex flex-col justify-between overflow-y-auto select-none relative h-full"
    >
      {/* 操作提示 Toast */}
      {actionNotice && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-slate-900/90 dark:bg-white/90 text-white dark:text-slate-900 text-xs font-medium shadow-xl animate-in fade-in zoom-in duration-150 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* =============================================================== */}
      {/* 区域 1：无框化出站与核心总控区 (直接连贯平铺，仅底边一根发丝线) */}
      {/* =============================================================== */}
      <section className="p-5 border-b hairline-divider">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
          {/* 【左区 7 列：出站路由与落地网络】 */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-3.5 lg:pr-7 lg:border-r hairline-divider">
            {/* 顶行：标题与刷新体检 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                  出站出口与落地网络
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-700 dark:text-sky-400 font-mono font-bold">
                  BGP TUNNEL
                </span>
              </div>
              <button
                type="button"
                onClick={() => reloadExitHealth()}
                disabled={exitLoading}
                className="flex items-center space-x-1 text-[11px] text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 font-medium cursor-pointer transition"
              >
                <RefreshCw
                  className={`w-3 h-3 ${exitLoading ? "animate-spin text-sky-500" : ""}`}
                />
                <span>{exitLoading ? "正在体检..." : "刷新体检"}</span>
              </button>
            </div>

            {/* 活动节点条 (无硬描边，自然通透呼吸) */}
            <div className="py-1 flex items-center justify-between gap-2">
              <div
                onClick={() => onNavigateTab("proxies")}
                className="flex items-center space-x-3 min-w-0 cursor-pointer group"
                title="点击前往节点大盘管理全部线路"
              >
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 font-bold font-mono text-xs flex items-center justify-center shrink-0 group-hover:scale-105 transition">
                  {activeNodeName ? activeNodeName.slice(0, 2).toUpperCase() : "HK"}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                      {displayNodeName}
                    </span>
                    <span className="text-[9px] font-mono px-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-400 font-bold">
                      HY2
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                    <span>UDP 满载</span>
                    <span>•</span>
                    <span>BBR 拥塞控制</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-xs flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  <span>24 ms</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateTab("proxies")}
                  className="px-2.5 py-1 rounded-lg ghost-hover text-slate-600 dark:text-slate-300 text-xs font-semibold cursor-pointer flex items-center gap-1 transition"
                >
                  <span>更换</span>
                  <ChevronRight className="w-3 h-3 text-slate-400" />
                </button>
              </div>
            </div>

            {/* 通透无框数据流 (Spec Strip，无 4 个封闭小方框，纯发丝竖线) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2 border-y hairline-divider text-xs">
              {/* 1. 落地 IP */}
              <div className="py-1 flex flex-col justify-between">
                <div className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-between">
                  <span>落地 IP</span>
                  <button
                    type="button"
                    onClick={handleCopyIp}
                    className="text-slate-400 hover:text-sky-600 transition cursor-pointer"
                    title="复制公网 IP"
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="font-bold text-xs font-mono text-slate-900 dark:text-white mt-1 truncate">
                  {exitData?.ip || "104.28.192.88"}
                </div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">
                  {exitData?.asn || "Cloudflare AS13335"}
                </div>
              </div>

              {/* 2. 落地地理 */}
              <div className="py-1 flex flex-col justify-between sm:border-l hairline-divider sm:pl-4">
                <div className="text-[10px] text-slate-400 dark:text-slate-500">落地地理</div>
                <div className="font-bold text-xs text-slate-900 dark:text-white mt-1 truncate">
                  {exitData?.country
                    ? `${exitData.country} ${exitData.city ? `(${exitData.city})` : ""}`
                    : "中国香港 (HK)"}
                </div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
                  HKBN 专线出口
                </div>
              </div>

              {/* 3. 欺诈风控分 */}
              <div className="py-1 flex flex-col justify-between border-l hairline-divider pl-4">
                <div className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-between">
                  <span>欺诈风控</span>
                  <span className={`font-mono font-bold text-[9px] ${fraudColor}`}>
                    {fraudScore}/100
                  </span>
                </div>
                <div className="w-full h-1 bg-slate-200 dark:bg-white/[0.08] rounded-full overflow-hidden my-1">
                  <div
                    className={`h-full ${
                      fraudScore <= 25
                        ? "bg-emerald-500"
                        : fraudScore <= 60
                        ? "bg-amber-500"
                        : "bg-rose-500"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(10, fraudScore))}%` }}
                  />
                </div>
                <div className={`text-[9px] font-medium ${fraudColor}`}>{fraudText}</div>
              </div>

              {/* 4. IP 属性 */}
              <div className="py-1 flex flex-col justify-between border-l hairline-divider pl-4">
                <div className="text-[10px] text-slate-400 dark:text-slate-500">IP 属性</div>
                <div className="font-bold text-xs text-slate-900 dark:text-white mt-1 truncate">
                  {exitData?.isResidential ? "家宽 (Residential)" : "商宽 (DC/ISP)"}
                </div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono">
                  首包 2.1ms
                </div>
              </div>
            </div>

            {/* 纯幽灵微光操作按键 (零边框负担，真对接底层能力) */}
            <div className="flex items-center space-x-2 text-xs pt-0.5">
              <button
                type="button"
                onClick={handleReloadConfig}
                disabled={isReloading}
                title="平滑重载最新分流规则与核心配置"
                className="px-2.5 py-1 rounded-lg ghost-hover text-slate-600 dark:text-slate-300 text-[11px] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60"
              >
                <RotateCw className={`w-3 h-3 text-sky-500 ${isReloading ? "animate-spin text-sky-400" : ""}`} />
                <span>{isReloading ? "重载中..." : "重载配置"}</span>
              </button>
              <button
                type="button"
                onClick={handleFlushDns}
                disabled={isFlushingDns}
                title="彻底刷新系统本地 DNS 缓存并清空 Fake-IP 映射"
                className="px-2.5 py-1 rounded-lg ghost-hover text-slate-600 dark:text-slate-300 text-[11px] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60"
              >
                <Eraser className={`w-3 h-3 text-violet-500 ${isFlushingDns ? "animate-pulse" : ""}`} />
                <span>{isFlushingDns ? "清理中..." : "清理 DNS"}</span>
              </button>
            </div>
          </div>

          {/* 【右区 5 列：系统代理总控 (SYSTEM PROXY) - 5 层黄金结构 + 去框化呈现】 */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-3.5">
            {/* 顶行：系统代理状态与模式徽标 */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                系统代理 (SYSTEM PROXY)
              </span>
              <div className="flex items-center space-x-1.5">
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold uppercase transition-colors ${
                    isProxyActive
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-slate-500/10 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {isProxyActive ? "● PROXY ON" : "○ PROXY OFF"}
                </span>
                <span
                  id="core-badge-mode"
                  className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-sky-500/15 text-sky-700 dark:text-sky-400 uppercase"
                >
                  {mode === "global" ? "GLOBAL 全局" : mode === "direct" ? "DIRECT 直连" : "RULE 分流"}
                </span>
              </div>
            </div>

            {/* 居中 Hero 大系统代理开关 + 秒表走字 */}
            <div className="flex flex-col items-center justify-center py-1">
              <div
                onClick={handleToggleProxy}
                className="cursor-pointer group flex flex-col items-center select-none"
              >
                <div
                  id="master-power-btn"
                  className={`w-14 h-14 rounded-full text-white flex items-center justify-center shadow-lg group-hover:scale-105 group-active:scale-95 transition-transform relative ${
                    isProxyActive
                      ? "bg-gradient-to-tr from-sky-500 via-indigo-600 to-sky-400 shadow-sky-500/30"
                      : "bg-slate-300 dark:bg-slate-700/80 text-slate-500 dark:text-slate-400 shadow-slate-500/15 group-hover:bg-slate-400 dark:group-hover:bg-slate-600"
                  }`}
                >
                  <Power className="w-7 h-7" />
                  {isProxyActive && (
                    <div
                      id="master-power-pulse"
                      className="absolute inset-0 rounded-full bg-sky-500/35 blur-lg animate-pulse pointer-events-none"
                    />
                  )}
                </div>

                <div className="mt-2 text-center">
                  <div
                    id="master-status-text"
                    className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white tracking-tight"
                  >
                    {isProxyActive ? "系统代理已连接 · 流量接管中" : "系统代理已断开 · 点击连接接管"}
                  </div>
                  <div className="mt-0.5 flex items-center justify-center gap-1.5">
                    <span
                      id="master-uptime"
                      className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 font-mono font-bold"
                    >
                      内核常驻: {formattedUptime}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 三段分流滑块 */}
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl bg-slate-100 dark:bg-white/[0.04] text-xs font-semibold">
              {(["rule", "global", "direct"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => coreMode.change(m)}
                  disabled={coreMode.busy}
                  className={`py-1 rounded-lg text-center transition cursor-pointer text-[11px] ${
                    mode === m
                      ? "font-bold bg-white dark:bg-white/[0.15] text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {m === "rule" ? "智能分流" : m === "global" ? "全局代理" : "直接连接"}
                </button>
              ))}
            </div>

            {/* 排除代理名单条 */}
            <div className="px-1 py-0.5 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center space-x-1.5 min-w-0">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />
                <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0 text-[11px]">
                  排除代理名单
                </span>
                <span className="px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-700 dark:text-sky-400 font-mono text-[9px] font-bold shrink-0">
                  共 {exclusions.state.text.split("\n").filter(Boolean).length} 条
                </span>
                <div className="hidden sm:flex items-center gap-1 font-mono text-[8px] text-slate-400 truncate">
                  <span className="px-1 py-0.2 rounded bg-slate-100 dark:bg-white/[0.06]">
                    *.cn
                  </span>
                  <span className="px-1 py-0.2 rounded bg-slate-100 dark:bg-white/[0.06]">
                    10.0.0.0/8
                  </span>
                </div>
              </div>
              <ExclusionsDialog
                state={exclusions.state}
                actions={exclusions.actions}
                trigger={(open) => (
                  <button
                    type="button"
                    onClick={open}
                    className="text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 font-bold text-[11px] flex items-center gap-0.5 shrink-0 cursor-pointer"
                  >
                    <span>配置</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              />
            </div>

            {/* 底部双开关并列 (胶囊微动开关) */}
            <div className="pt-2 border-t hairline-divider flex items-center justify-between text-xs px-1">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300 text-[10px] sm:text-[11px]">
                  TUN 虚拟网卡
                </span>
                <div
                  onClick={handleToggleTun}
                  className={`capsule-toggle ${tunEnabled ? "active" : ""}`}
                  title="点击切换 TUN 虚拟网卡"
                >
                  <div className="capsule-thumb" />
                </div>
              </div>

              <div
                onClick={handleToggleLan}
                className={`flex items-center space-x-2 cursor-pointer select-none group ${lanPending ? "opacity-60 pointer-events-none" : ""}`}
                title="点击切换允许局域网设备接入"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-300 text-[10px] sm:text-[11px] group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                  允许局域网
                </span>
                <div
                  className={`capsule-toggle ${allowLan ? "active" : ""}`}
                >
                  <div className="capsule-thumb" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =============================================================== */}
      {/* 区域 2：全景宽幅实时流量波形 (告别孤岛卡片，宽幅通栏铺开，真正悬浮) */}
      {/* =============================================================== */}
      <section className="p-5 flex-1 flex flex-col justify-between border-b hairline-divider relative overflow-hidden min-h-[160px]">
        {/* 顶部遥测行 */}
        <div className="flex items-center justify-between text-xs font-mono pb-2 z-10">
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 animate-pulse" />
              <span>吞吐速率遥测</span>
            </span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-700 dark:text-sky-400 font-mono font-bold">
              1S 周期
            </span>
          </div>
          <div className="flex items-center space-x-4 text-xs">
            <span className="text-sky-600 dark:text-sky-400 font-bold flex items-center gap-1">
              <ArrowDown className="w-3 h-3" />
              {formatSpeed(trafficReading.downSpeed)}
            </span>
            <span className="text-purple-600 dark:text-violet-400 font-bold flex items-center gap-1">
              <ArrowUp className="w-3 h-3" />
              {formatSpeed(trafficReading.upSpeed)}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px] hidden sm:inline">
              丢包 0.00% · RTT 24ms
            </span>
          </div>
        </div>

        {/* 彻底去框化的 SVG 绘图区 */}
        <div className="relative w-full flex-1 min-h-[95px] flex items-end overflow-hidden">
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-0 opacity-40">
            <div className="w-full flex items-center justify-between border-b hairline-divider border-dashed">
              <span className="text-[8px] font-mono text-slate-400">10.0 MB/s</span>
            </div>
            <div className="w-full flex items-center justify-between border-b hairline-divider border-dashed">
              <span className="text-[8px] font-mono text-slate-400">5.0 MB/s</span>
            </div>
            <div className="w-full flex items-center justify-between border-b hairline-divider">
              <span className="text-[8px] font-mono text-slate-400">0.0 MB/s</span>
            </div>
          </div>

          <svg className="w-full h-full relative z-10" viewBox="0 0 1000 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="downGradFull" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0284c7" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="upGradFull" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {/* 下行科技蓝主力起伏波 */}
            <path d={downWave.areaD} fill="url(#downGradFull)" />
            <path d={downWave.pathD} fill="none" stroke="#0284c7" strokeWidth="2.5" />
            {/* 上行紫色轻波 */}
            <path d={upWave.areaD} fill="url(#upGradFull)" />
            <path d={upWave.pathD} fill="none" stroke="#7c3aed" strokeWidth="2" />
            <circle cx="995" cy={downWave.lastY || 80} r="3.5" fill="#0284c7" className="animate-pulse" />
          </svg>
        </div>

        {/* 时间轴刻度 */}
        <div className="w-full flex items-center justify-between text-[8px] font-mono text-slate-400 dark:text-slate-500 pt-1.5 border-t hairline-divider">
          <span>-60s</span>
          <span>-45s</span>
          <span>-30s</span>
          <span>-15s</span>
          <span className="text-sky-600 dark:text-sky-400 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
            <span>实时 (NOW)</span>
          </span>
        </div>
      </section>

      {/* =============================================================== */}
      {/* 区域 3：一体化常驻底盘 (4 个状态/指标卡片全部接入真实数据) */}
      {/* =============================================================== */}
      <section className="px-5 py-3.5 shrink-0 bg-white/40 dark:bg-slate-900/30">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 text-xs font-mono">
          {/* 1. 节点协议与 UDP 真实能力 */}
          <div
            onClick={() => onNavigateTab("proxies")}
            className="flex flex-col justify-between cursor-pointer group hover:opacity-90 transition-opacity"
            title="点击切换到节点大盘查看详细线路参数"
          >
            <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 text-[10px]">
              <span className="font-sans font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-500" />
                <span>链路能力</span>
              </span>
              <span
                className={`px-1.5 py-0.2 rounded font-bold text-[9px] uppercase ${
                  !coreStatus.running
                    ? "bg-slate-500/10 text-slate-400"
                    : activeNodeDetails?.udp
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                }`}
              >
                {!coreStatus.running
                  ? "核心待命"
                  : activeNodeDetails?.udp
                  ? "● UDP 就绪"
                  : "仅限 TCP"}
              </span>
            </div>
            <div className="mt-1.5 font-extrabold text-sm font-sans text-slate-900 dark:text-white truncate">
              {!coreStatus.running
                ? "待命中"
                : activeNodeDetails?.type
                ? activeNodeDetails.type
                : activeNodeName || "默认直连"}
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              {!coreStatus.running
                ? "核心未启动"
                : activeNodeDetails?.udp
                ? "UDP 转发已就绪 · 支持联机"
                : "不支持 UDP · 仅代理 TCP 流量"}
            </div>
          </div>

          {/* 2. 分流业务包 (真实 useBusinessBundles 数据) */}
          <div
            onClick={() => onNavigateTab("routing")}
            className="flex flex-col justify-between md:border-l hairline-divider md:pl-5 cursor-pointer group hover:opacity-90 transition-opacity"
            title="点击管理托管业务规则包与进程强锁配置"
          >
            <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 text-[10px]">
              <span className="font-sans font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-violet-500" />
                <span>分流业务包</span>
              </span>
              <span className="px-1.5 py-0.2 rounded bg-violet-500/15 text-violet-700 dark:text-violet-400 font-bold text-[9px]">
                {activeBundlesCount} 包生效
              </span>
            </div>
            <div className="mt-1.5 font-extrabold text-sm font-sans text-slate-900 dark:text-white">
              {totalBundlesCount > 0
                ? `${activeBundlesCount} / ${totalBundlesCount} 包托管中`
                : "暂无业务包"}
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              覆盖 {processCount} 进程 · {isProcessMasterOn ? "强锁分流中" : "分流总控暂停"}
            </div>
          </div>

          {/* 3. DNS 智能护航 / 监听 (真实 DnsGuard / DnsListenerStatus) */}
          <div
            onClick={() => onNavigateTab("settings")}
            className="flex flex-col justify-between border-l hairline-divider pl-5 cursor-pointer group hover:opacity-90 transition-opacity"
            title="点击前往偏好设置查看 DNS 覆写与解析优化"
          >
            <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 text-[10px]">
              <span className="font-sans font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-500" />
                <span>DNS 智能护航</span>
              </span>
              <span
                className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
                  dnsGuard?.enabled
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                    : "bg-slate-500/10 text-slate-400"
                }`}
              >
                {dnsGuard?.enabled ? "🛡️ 护航生效" : "○ 未接管"}
              </span>
            </div>
            <div className="mt-1.5 font-extrabold text-sm font-sans text-slate-900 dark:text-white truncate">
              {dnsListener?.listen ? dnsListener.listen : "Fake-IP 引擎"}
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              防污染纯净解析 · 上游 DoH 守护
            </div>
          </div>

          {/* 4. 今日吞吐 (真实流量 + 仅统计代理偏好 + 点击跳转连接追踪) */}
          <div
            onClick={() => onNavigateTab("connections")}
            className="flex flex-col justify-between border-l hairline-divider pl-5 cursor-pointer group hover:opacity-90 transition-opacity"
            title="点击跳转至连接追踪大盘，查看实时网络连接明细"
          >
            <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 text-[10px]">
              <span className="font-sans font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-amber-500" />
                <span>今日吞吐</span>
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold text-[9px]">
                {onlyProxyTraffic ? "仅统计代理" : "全网累积"}
              </span>
            </div>
            <div className="mt-1.5 font-extrabold text-sm font-sans text-slate-900 dark:text-white">
              {formatBytes(trafficReading.download + trafficReading.upload)}
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              下行: {formatBytes(trafficReading.download)} / 上行: {formatBytes(trafficReading.upload)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
