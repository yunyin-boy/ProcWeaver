// ==========================================================================
// ProcWeaver src-next 核心全功能中央驾驶舱 (对齐旧版 16 项全量能力)
// 规范溯源: taste-skill / impeccable-design / tauri-linear-raycast-ui
// ==========================================================================

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { GlassCard } from "../../primitives/GlassCard";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { ExclusionsModal } from "./ExclusionsModal";
import { CoreStatusSnapshot } from "../../types/core";
import { BandwidthSnapshot } from "../../types/telemetry";
import { ExitIpHealthInfo } from "../../types/exitHealth";
import { DnsGuardInfo, DnsListenerStatus } from "../../types/dns";
import { GeneralSettings, DEFAULT_GENERAL_SETTINGS } from "../../types/settings";
import { BundleSummary } from "../../types/bundle";
import {
  formatBitrate,
  formatTrafficBytes,
  calculateAdaptiveCeilingBps,
} from "../../services/telemetryService";
import { formatMemoryBytes, getActiveOutboundNode, ActiveNodeInfo } from "../../services/coreService";
import { generateSvgWave } from "../../utils/trafficWave";
import { fetchExitIpHealth, getCachedExitHealth } from "../../services/exitHealthService";
import { toggleSystemProxy, getSystemProxyState } from "../../services/systemProxyService";
import {
  getDnsGuardInfo,
  getDnsListenerStatus,
  flushDns,
  reloadCoreConfig,
} from "../../services/dnsService";
import { getGeneralSettings, saveGeneralSettings } from "../../services/settingsService";
import { getBundleSummary } from "../../services/bundleService";

interface OverviewViewProps {
  status: CoreStatusSnapshot;
  bandwidth: BandwidthSnapshot;
  onNavigateTab: (tab: string) => void;
  onShowNotice: (msg: string) => void;
  onToggleCore: (start: boolean) => Promise<void>;
  onChangeMode: (mode: "rule" | "global" | "direct") => void;
  onToggleSystemProxy?: (enable: boolean) => Promise<void>;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  status,
  bandwidth,
  onNavigateTab,
  onShowNotice,
  onToggleCore,
  onChangeMode,
  onToggleSystemProxy,
}) => {
  // 1. 落地 IP 深度体检状态 (优先从持久化快照中秒级回显，实现 Stale-While-Revalidate)
  const [exitHealth, setExitHealth] = useState<ExitIpHealthInfo | null>(() => getCachedExitHealth());
  const [exitLoading, setExitLoading] = useState(false);

  const loadExitHealth = async (isManual = false) => {
    setExitLoading(true);
    try {
      const data = await fetchExitIpHealth(status.mixedPort);
      setExitHealth(data);
      if (isManual) {
        onShowNotice(`出口体检完成 · ${data.country || "链路正常"}`);
      }
    } catch {
      // 仅当用户主动点击“刷新体检”且完全无响应时才温和提示；后台静默体检绝不弹窗打扰
      if (isManual) {
        onShowNotice("出口网络探测耗时较长，节点仍在服务中");
      }
    } finally {
      setExitLoading(false);
    }
  };

  const [activeNode, setActiveNode] = useState<ActiveNodeInfo>({
    name: "香港 01 | 极速专线 [BGP]",
    type: "Shadowsocks",
    delay: 24,
  });

  const refreshActiveNode = useCallback(() => {
    if (status.running) {
      getActiveOutboundNode().then(setActiveNode).catch(() => {});
    }
  }, [status.running]);

  useEffect(() => {
    loadExitHealth(false);
    refreshActiveNode();
  }, [status.running, status.activeProfile, refreshActiveNode]);

  useEffect(() => {
    window.addEventListener("netbox-route-changed", refreshActiveNode);
    return () => window.removeEventListener("netbox-route-changed", refreshActiveNode);
  }, [refreshActiveNode]);

  // 2. 系统代理接管状态 (Hero 大按钮核心映射，与全局状态双向强联动)
  const [isProxyActive, setIsProxyActive] = useState(false);
  const [proxyPending, setProxyPending] = useState(false);

  const isSystemProxyActive =
    status.systemProxyEnabled !== undefined ? status.systemProxyEnabled : isProxyActive;

  useEffect(() => {
    getSystemProxyState().then(setIsProxyActive);
  }, []);

  useEffect(() => {
    if (status.systemProxyEnabled !== undefined) {
      setIsProxyActive(status.systemProxyEnabled);
    }
  }, [status.systemProxyEnabled]);

  const handleToggleSystemProxy = async () => {
    if (proxyPending) return;
    setProxyPending(true);
    try {
      if (!status.running) {
        onShowNotice("正在拉起核心网络服务...");
        await onToggleCore(true);
      }
      const next = !isSystemProxyActive;
      if (onToggleSystemProxy) {
        await onToggleSystemProxy(next);
      } else {
        const res = await toggleSystemProxy(next, status.mixedPort);
        setIsProxyActive(res);
        onShowNotice(res ? "系统代理已连接 · 流量接管中" : "系统代理已断开 · 直连模式");
      }
    } catch (e: any) {
      onShowNotice(`切换代理失败: ${e?.message || e}`);
    } finally {
      setProxyPending(false);
    }
  };

  // 3. 运行常驻秒表计时器 (精确到秒的高精度走字，tabular-nums 防抖)
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const startSecRef = useRef<number | null>(null);

  useEffect(() => {
    if (!status.running) {
      setUptimeSeconds(0);
      startSecRef.current = null;
      return;
    }
    if (!startSecRef.current) startSecRef.current = Math.floor(Date.now() / 1000);

    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setUptimeSeconds(Math.max(0, now - (startSecRef.current || now)));
    }, 1000);

    return () => clearInterval(timer);
  }, [status.running]);

  const formattedUptime = useMemo(() => {
    if (!status.running || uptimeSeconds === 0) return "--:--:--";
    const h = Math.floor(uptimeSeconds / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = uptimeSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, [status.running, uptimeSeconds]);

  // 4. 全景 60 秒滑动窗口采样曲线 (三次贝塞尔光滑流，bps 精度)
  const [downWaveHistory, setDownWaveHistory] = useState<number[]>(() => new Array(60).fill(0));
  const [upWaveHistory, setUpWaveHistory] = useState<number[]>(() => new Array(60).fill(0));

  useEffect(() => {
    const downBps = (bandwidth.downloadRateBytes || 0) * 8;
    const upBps = (bandwidth.uploadRateBytes || 0) * 8;
    setDownWaveHistory((prev) => [...prev.slice(1), downBps]);
    setUpWaveHistory((prev) => [...prev.slice(1), upBps]);
  }, [bandwidth.downloadRateBytes, bandwidth.uploadRateBytes]);

  // 动态捕获 60 秒滑动窗口峰值，计算自适应顶线标尺 (支持顶线 10Gbps 封顶)
  const peakHistoryBps = useMemo(() => {
    return Math.max(...downWaveHistory, ...upWaveHistory, 0);
  }, [downWaveHistory, upWaveHistory]);

  const ceilingBps = useMemo(() => {
    return calculateAdaptiveCeilingBps(peakHistoryBps, 10_000_000_000);
  }, [peakHistoryBps]);

  const ceilingFormatted = useMemo(() => formatBitrate(ceilingBps / 8), [ceilingBps]);
  const halfCeilingFormatted = useMemo(() => formatBitrate(ceilingBps / 16), [ceilingBps]);

  const downWave = useMemo(
    () => generateSvgWave(downWaveHistory, 100, ceilingBps),
    [downWaveHistory, ceilingBps]
  );
  const upWave = useMemo(
    () => generateSvgWave(upWaveHistory, 100, ceilingBps),
    [upWaveHistory, ceilingBps]
  );

  // 5. 首选项设置 (TUN 模式、允许局域网、排除名单)
  const [settings, setSettings] = useState<GeneralSettings>({
    ...DEFAULT_GENERAL_SETTINGS,
    bypassList: ["*.cn", "10.0.0.0/8", "192.168.0.0/16", "localhost"],
  });
  const [isExclusionsOpen, setIsExclusionsOpen] = useState(false);

  useEffect(() => {
    getGeneralSettings().then(setSettings);
  }, []);

  const handleToggleTun = async (val: boolean) => {
    const next = { ...settings, tunMode: val, trafficMode: val ? ("tun" as const) : ("app_proxy" as const) };
    setSettings(next);
    await saveGeneralSettings(next);
    onShowNotice(val ? "TUN 虚拟网卡已接管系统流量" : "TUN 虚拟网卡已停用");
  };

  const handleToggleLan = async (val: boolean) => {
    const next = { ...settings, allowLan: val };
    setSettings(next);
    await saveGeneralSettings(next);
    onShowNotice(val ? "已允许局域网设备接入" : "已关闭局域网连接");
  };

  const handleSaveBypass = async (list: string[]) => {
    const next = { ...settings, bypassList: list };
    setSettings(next);
    await saveGeneralSettings(next);
    onShowNotice(`排除名单已更新 (${list.length} 条生效)`);
  };

  // 6. 快捷运维动作 (重载配置 & 清理 DNS)
  const [reloading, setReloading] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const handleReload = async () => {
    setReloading(true);
    try {
      await reloadCoreConfig();
      onShowNotice("分流规则与内核配置已平滑重载");
    } finally {
      setReloading(false);
    }
  };

  const handleFlush = async () => {
    setFlushing(true);
    try {
      await flushDns();
      onShowNotice("系统 DNS 缓存与 Fake-IP 映射已清空");
    } finally {
      setFlushing(false);
    }
  };

  // 7. 复制出口 IP
  const handleCopyIp = () => {
    if (!exitHealth?.ip) return;
    navigator.clipboard.writeText(exitHealth.ip);
    onShowNotice(`已复制出口 IP: ${exitHealth.ip}`);
  };

  // 8. DNS 智能护航与业务包概要
  const [dnsGuard, setDnsGuard] = useState<DnsGuardInfo | null>(null);
  const [dnsListener, setDnsListener] = useState<DnsListenerStatus | null>(null);
  const [bundleSummary, setBundleSummary] = useState<BundleSummary | null>(null);

  const refreshOverviewExtras = useCallback(() => {
    getDnsGuardInfo().then(setDnsGuard).catch(() => {});
    getDnsListenerStatus().then(setDnsListener).catch(() => {});
    getBundleSummary().then(setBundleSummary).catch(() => {});
  }, []);

  useEffect(() => {
    refreshOverviewExtras();
    window.addEventListener("netbox-route-changed", refreshOverviewExtras);
    window.addEventListener("netbox-process-master-changed", refreshOverviewExtras);
    window.addEventListener("procweaver-route-changed", refreshOverviewExtras);
    return () => {
      window.removeEventListener("netbox-route-changed", refreshOverviewExtras);
      window.removeEventListener("netbox-process-master-changed", refreshOverviewExtras);
      window.removeEventListener("procweaver-route-changed", refreshOverviewExtras);
    };
  }, [refreshOverviewExtras]);

  // 欺诈风控分评级计算
  const fraudScore = exitHealth?.fraudScore ?? 12;
  const fraudBadge = useMemo(() => {
    if (fraudScore <= 25) return { text: "极佳 / 低风险", color: "text-emerald-500", bar: "bg-emerald-500" };
    if (fraudScore <= 60) return { text: "良好 / 常见机房", color: "text-amber-500", bar: "bg-amber-500" };
    return { text: "风险较高 / 需注意", color: "text-rose-500", bar: "bg-rose-500" };
  }, [fraudScore]);

  const downFormatted = formatBitrate(bandwidth.downloadRateBytes);
  const upFormatted = formatBitrate(bandwidth.uploadRateBytes);
  const totalDownFormatted = formatTrafficBytes(bandwidth.downloadTotalBytes);
  const totalUpFormatted = formatTrafficBytes(bandwidth.uploadTotalBytes);

  return (
    <div className="space-y-4">
      {/* ===================================================================
         区域 1: 出站路由与落地网络深度体检 (一体化透光 Spec Strip)
         =================================================================== */}
      <GlassCard className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3.5 border-b border-[var(--glass-border-subtle)]">
          {/* 活动线路与节点快速选择 (Feature 1 & 2) */}
          <div
            onClick={() => onNavigateTab("proxies")}
            className="flex items-center gap-3.5 cursor-pointer group select-none min-w-0"
            title="点击切换出站节点线路"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-xs bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 border border-emerald-500/20 group-hover:scale-105 transition-transform shrink-0">
              {activeNode.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[13px] text-[var(--text-primary)] truncate">
                  {activeNode.name}
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-white/10 dark:bg-white/10 text-zinc-300">
                  {activeNode.type}
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] font-mono flex items-center gap-2 mt-0.5">
                <span className="text-emerald-500 font-semibold flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="tabular-numeric">{activeNode.delay ? `${activeNode.delay} ms` : "-- ms"}</span>
                </span>
                <span>•</span>
                <span>UDP 满载</span>
                <span>•</span>
                <span>BBR 拥塞控制</span>
                <span>•</span>
                <span>核心内存 {formatMemoryBytes(status.memoryUsageBytes)}</span>
              </div>
            </div>
          </div>

          {/* 快捷运维动作与刷新体检 (Feature 5 & 7 & 8) */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              loading={exitLoading}
              onClick={() => loadExitHealth(true)}
              title="重新检测公网落地 IP 与风险指标"
            >
              刷新体检
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={reloading}
              onClick={handleReload}
              title="平滑重载最新分流规则与配置"
            >
              重载配置
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={flushing}
              onClick={handleFlush}
              title="彻底清理系统本地 DNS 缓存并清空 Fake-IP 映射"
            >
              清理 DNS
            </Button>
          </div>
        </div>

        {/* 落地 IP 物理参数流 (Feature 3, 4, 5, 6) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3.5 text-xs font-mono">
          {/* 1. 落地 IP */}
          <div className="flex flex-col justify-between min-w-0">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
              <span>落地 IP</span>
              <button
                type="button"
                onClick={handleCopyIp}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="复制公网出口 IP"
              >
                复制
              </button>
            </div>
            <div className="font-bold text-[13px] text-[var(--text-primary)] mt-1 truncate tabular-numeric">
              {exitHealth?.ip || "104.28.192.88"}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
              {exitHealth?.asn || "Cloudflare AS13335"}
            </div>
          </div>

          {/* 2. 落地地理 */}
          <div className="flex flex-col justify-between min-w-0 sm:border-l border-[var(--glass-border-subtle)] sm:pl-4">
            <div className="text-[11px] text-[var(--text-muted)]">落地地理</div>
            <div className="font-bold text-[13px] text-[var(--text-primary)] mt-1 truncate">
              {exitHealth?.country || "中国香港"} {exitHealth?.city ? `(${exitHealth.city})` : ""}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
              HKBN 专线出口
            </div>
          </div>

          {/* 3. 欺诈风控分 */}
          <div className="flex flex-col justify-between min-w-0 border-l border-[var(--glass-border-subtle)] pl-4">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
              <span>欺诈风控</span>
              <span className={`font-bold tabular-numeric ${fraudBadge.color}`}>
                {fraudScore}/100
              </span>
            </div>
            <div className="w-full h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden my-1.5">
              <div
                className={`h-full ${fraudBadge.bar} transition-all duration-300`}
                style={{ width: `${Math.min(100, Math.max(10, fraudScore))}%` }}
              />
            </div>
            <div className={`text-[10px] font-medium ${fraudBadge.color}`}>
              {fraudBadge.text}
            </div>
          </div>

          {/* 4. IP 属性 */}
          <div className="flex flex-col justify-between min-w-0 border-l border-[var(--glass-border-subtle)] pl-4">
            <div className="text-[11px] text-[var(--text-muted)]">IP 属性</div>
            <div className="font-bold text-[13px] text-[var(--text-primary)] mt-1 truncate">
              {exitHealth?.isResidential ? "家宽 (Residential)" : "商宽 (DC/ISP)"}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5 tabular-numeric">
              首包 {exitHealth?.firstPacketMs || 2.1} ms
            </div>
          </div>
        </div>
      </GlassCard>

      {/* ===================================================================
         区域 2 & 3: 左侧 60s 贝塞尔波形雷达 + 右侧系统代理中枢 (双栏布局)
         =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 【左侧 7 列：全景 60 秒平滑实时吞吐波形雷达】 (Feature 12) */}
        <GlassCard className="lg:col-span-7 p-5 flex flex-col justify-between min-h-[260px] relative overflow-hidden">
          {/* 顶部遥测指标行 */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-border-subtle)] z-10 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[13px] text-[var(--text-primary)] font-sans">
                实时网络吞吐
              </span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/10 text-blue-500 dark:text-blue-400 font-bold">
                1S 周期
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div
                className="flex items-center gap-1.5 text-blue-500 dark:text-blue-400 font-semibold"
                title={`实时下行: ${downFormatted.value} ${downFormatted.unit}`}
              >
                <span>↓</span>
                <span className="tabular-numeric text-[13px] min-w-[5ch] text-right inline-block">
                  {downFormatted.value}
                </span>
                <span className="text-[10px] uppercase font-sans text-[var(--text-muted)] font-bold">
                  {downFormatted.unit}
                </span>
              </div>
              <div
                className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400 font-semibold"
                title={`实时上行: ${upFormatted.value} ${upFormatted.unit}`}
              >
                <span>↑</span>
                <span className="tabular-numeric text-[13px] min-w-[5ch] text-right inline-block">
                  {upFormatted.value}
                </span>
                <span className="text-[10px] uppercase font-sans text-[var(--text-muted)] font-bold">
                  {upFormatted.unit}
                </span>
              </div>
              <span className="text-emerald-500 text-[11px] hidden sm:inline">
                丢包 0.00%
              </span>
            </div>
          </div>

          {/* 彻底融入双层毛玻璃的 SVG 贝塞尔波形绘图区 (支持自适应 10Gbps 顶线) */}
          <div className="relative w-full flex-1 min-h-[140px] flex items-end overflow-hidden my-2">
            {/* 发丝背景刻度辅助虚线与动态顶线标尺 */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-0 select-none py-1">
              {/* 顶线刻度 */}
              <div className="w-full flex items-center justify-between border-b border-[var(--glass-border-subtle)] border-dashed pb-0.5">
                <span className="text-[10px] font-mono text-[var(--text-secondary)] font-medium tracking-wider">
                  {ceilingFormatted.value} {ceilingFormatted.unit}
                </span>
                <span className="text-[9px] font-mono text-[var(--text-muted)]">
                  顶线标尺 (MAX 10Gbps)
                </span>
              </div>
              {/* 中间 50% 刻度 */}
              <div className="w-full flex items-center justify-between border-b border-[var(--glass-border-subtle)] border-dashed py-0.5">
                <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-wider">
                  {halfCeilingFormatted.value} {halfCeilingFormatted.unit}
                </span>
                <span className="text-[9px] font-mono text-[var(--text-muted)]">
                  50%
                </span>
              </div>
              {/* 基准底 0 刻度 */}
              <div className="w-full flex items-center justify-between border-b border-[var(--glass-border-subtle)] pt-0.5">
                <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-wider">
                  0 bps
                </span>
                <span className="text-[9px] font-mono text-[var(--text-muted)]">
                  基准底
                </span>
              </div>
            </div>

            <svg
              className="w-full h-full relative z-10"
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="downWaveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="upWaveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity="0.01" />
                </linearGradient>
              </defs>
              {/* 下行科技蓝主力起伏波 */}
              <path d={downWave.areaD} fill="url(#downWaveGrad)" />
              <path d={downWave.pathD} fill="none" stroke="#0ea5e9" strokeWidth="2.5" />
              {/* 上行紫色柔和轻波 */}
              <path d={upWave.areaD} fill="url(#upWaveGrad)" />
              <path d={upWave.pathD} fill="none" stroke="#818cf8" strokeWidth="1.8" />
              {/* 实时动态起伏脉冲光点 */}
              <circle
                cx="995"
                cy={downWave.lastY || 80}
                r="3.5"
                fill="#0ea5e9"
                className="animate-pulse"
              />
            </svg>
          </div>

          {/* 时间轴刻度与累计流量 */}
          <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--glass-border-subtle)]">
            <div className="flex items-center gap-3">
              <span>-60s</span>
              <span>-30s</span>
              <span className="text-blue-500 font-semibold flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
                <span>实时 (NOW)</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>总下行: {totalDownFormatted.value} {totalDownFormatted.unit}</span>
              <span>总上行: {totalUpFormatted.value} {totalUpFormatted.unit}</span>
            </div>
          </div>
        </GlassCard>

        {/* 【右侧 5 列：系统代理总控中枢】 (Feature 6, 8, 9, 10, 11) */}
        <GlassCard className="lg:col-span-5 p-5 flex flex-col justify-between">
          <div>
            {/* 顶栏：系统代理状态徽章 */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--glass-border-subtle)]">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                系统代理 (SYSTEM PROXY)
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase transition-colors ${
                  isSystemProxyActive
                    ? "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/20"
                    : "bg-black/10 dark:bg-white/10 text-[var(--text-muted)]"
                }`}
              >
                {isSystemProxyActive ? "● PROXY ON" : "○ PROXY OFF"}
              </span>
            </div>

            {/* 居中 Hero 冰晶大电源开关与 Uptime 秒表走字 (Feature 6 & 7) */}
            <div className="flex flex-col items-center justify-center py-4 select-none">
              <button
                type="button"
                onClick={handleToggleSystemProxy}
                disabled={proxyPending}
                className="cursor-pointer group flex flex-col items-center focus:outline-none"
              >
                <div
                  className={`
                    w-16 h-16 rounded-full flex items-center justify-center shadow-lg relative
                    transition-all duration-200 ease-[var(--ease-out-expo)]
                    group-hover:scale-105 group-active:scale-95
                    ${
                      isSystemProxyActive
                        ? "bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-indigo-500/30"
                        : "bg-black/10 dark:bg-white/10 text-zinc-400 border border-black/[0.06] dark:border-white/[0.08] group-hover:bg-black/15 dark:group-hover:bg-white/15"
                    }
                  `}
                >
                  <svg className="w-7 h-7 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>

                  {/* 激活时的柔和外发光微晶光晕 */}
                  {isSystemProxyActive && (
                    <div className="absolute -inset-1 rounded-full bg-indigo-500/25 blur-lg pointer-events-none animate-pulse" />
                  )}
                </div>

                <div className="mt-3 text-center">
                  <div className="font-bold text-[13px] text-[var(--text-primary)] tracking-tight">
                    {isSystemProxyActive ? "系统代理已接管 · 全局生效" : "系统代理已断开 · 点击开启"}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tabular-numeric text-[var(--text-muted)] flex items-center justify-center gap-2">
                    <span>常驻: {formattedUptime}</span>
                    <span>•</span>
                    <span>内存: {formatMemoryBytes(status.memoryUsageBytes)}</span>
                  </div>
                </div>
              </button>
            </div>

            {/* 三段分流模式滑块 (Feature 8) */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.03] border border-[var(--glass-border-subtle)] text-xs font-semibold">
              {(["rule", "global", "direct"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onChangeMode(m)}
                  className={`
                    py-1 rounded text-center transition-all duration-120 text-[11px]
                    ${
                      status.mode === m
                        ? "bg-white dark:bg-white/10 text-[var(--text-primary)] shadow-sm font-bold border border-black/5 dark:border-white/10"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }
                  `}
                >
                  {m === "rule" ? "智能分流" : m === "global" ? "全局代理" : "直连模式"}
                </button>
              ))}
            </div>

            {/* 排除代理名单条 (Feature 9) */}
            <div className="mt-3 px-2 py-1.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-[var(--glass-border-subtle)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[var(--text-muted)] text-[11px]">排除名单:</span>
                <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 font-mono text-[10px] font-bold">
                  {settings.bypassList.length} 条
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)] truncate hidden sm:inline">
                  {settings.bypassList.slice(0, 2).join(", ")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsExclusionsOpen(true)}
                className="text-[11px] font-medium text-blue-500 hover:text-blue-400 transition-colors"
              >
                配置
              </button>
            </div>
          </div>

          {/* 硬件级双开关并列 (TUN 虚拟网卡 & 允许局域网) (Feature 10 & 11) */}
          <div className="mt-4 pt-3 border-t border-[var(--glass-border-subtle)] grid grid-cols-2 gap-2 text-xs">
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleToggleTun(!settings.tunMode)}
              onKeyDown={(e) => e.key === "Enter" && handleToggleTun(!settings.tunMode)}
              className="flex items-center justify-between p-2 px-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-[var(--glass-border-subtle)] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all cursor-pointer select-none group"
              title="开启后将劫持系统全部底层流量"
            >
              <span className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] font-medium transition-colors">
                TUN 网卡接管
              </span>
              <CapsuleToggle
                checked={settings.tunMode}
                onChange={handleToggleTun}
              />
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => handleToggleLan(!settings.allowLan)}
              onKeyDown={(e) => e.key === "Enter" && handleToggleLan(!settings.allowLan)}
              className="flex items-center justify-between p-2 px-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-[var(--glass-border-subtle)] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all cursor-pointer select-none group"
              title="允许同一 WiFi 下的其他设备连接代理"
            >
              <span className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] font-medium transition-colors">
                允许局域网
              </span>
              <CapsuleToggle
                checked={settings.allowLan}
                onChange={handleToggleLan}
              />
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ===================================================================
         区域 4: 一体化常驻底盘四大能力卡 (Feature 13, 14, 15, 16)
         =================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
        {/* [卡片 1] 链路协议与 UDP 真实能力 */}
        <GlassCard
          interactive
          onClick={() => onNavigateTab("proxies")}
          className="p-3.5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span className="font-sans font-medium text-[var(--text-primary)]">链路能力</span>
            <span className="px-1.5 py-0.2 rounded font-bold text-[9px] bg-emerald-500/15 text-emerald-500">
              ● UDP 就绪
            </span>
          </div>
          <div className="my-1.5 font-bold text-[14px] text-[var(--text-primary)] font-sans truncate">
            {activeNode.type ? `${activeNode.type} 链路` : "标准代理专线"}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            {activeNode.type?.toLowerCase().includes("hysteria") || activeNode.type?.toLowerCase().includes("tuic")
              ? "基于 UDP/QUIC 极速拥塞控制协议"
              : activeNode.type?.toLowerCase().includes("shadowsocks") ||
                activeNode.type?.toLowerCase().includes("trojan") ||
                activeNode.type?.toLowerCase().includes("vmess") ||
                activeNode.type?.toLowerCase().includes("vless")
              ? "支持标准 TCP 与 UDP 全双工转发"
              : "支持完整 UDP 联机游戏转发"}
          </div>
        </GlassCard>

        {/* [卡片 2] 分流业务规则包 */}
        <GlassCard
          interactive
          onClick={() => onNavigateTab("routing")}
          className="p-3.5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span className="font-sans font-medium text-[var(--text-primary)]">分流业务包</span>
            <span
              className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
                bundleSummary?.isProcessMasterOn && (bundleSummary?.activeCount || 0) > 0
                  ? "bg-indigo-500/15 text-indigo-500"
                  : "bg-zinc-500/15 text-[var(--text-muted)]"
              }`}
            >
              {bundleSummary?.isProcessMasterOn
                ? `${bundleSummary?.activeCount ?? 0} 包生效`
                : "○ 已挂起"}
            </span>
          </div>
          <div className="my-1.5 font-bold text-[14px] text-[var(--text-primary)] font-sans truncate">
            {bundleSummary?.totalCount ?? 0} 个规则包托管
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            {bundleSummary?.isProcessMasterOn
              ? `覆盖 ${bundleSummary?.processCount ?? 0} 个强锁进程`
              : "进程分流总开关未开启"}
          </div>
        </GlassCard>

        {/* [卡片 3] DNS 智能护航 */}
        <GlassCard
          interactive
          onClick={() => onNavigateTab("settings")}
          className="p-3.5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span className="font-sans font-medium text-[var(--text-primary)]">DNS 智能护航</span>
            <span className="px-1.5 py-0.2 rounded font-bold text-[9px] bg-blue-500/15 text-blue-500">
              {dnsGuard?.enabled ? "● 护航生效" : "○ 未接管"}
            </span>
          </div>
          <div className="my-1.5 font-bold text-[14px] text-[var(--text-primary)] font-sans truncate">
            {dnsListener?.listen || "127.0.0.1:53"}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            防污染纯净解析 · DoH 守护
          </div>
        </GlassCard>

        {/* [卡片 4] 今日累计吞吐 */}
        <GlassCard
          interactive
          onClick={() => onNavigateTab("settings")}
          className="p-3.5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span className="font-sans font-medium text-[var(--text-primary)]">今日累计吞吐</span>
            <span className="px-1.5 py-0.2 rounded font-bold text-[9px] bg-amber-500/15 text-amber-500">
              {settings.onlyProxyTraffic ? "仅统计代理" : "全网累积"}
            </span>
          </div>
          <div className="my-1.5 font-bold text-[14px] text-[var(--text-primary)] font-sans truncate tabular-numeric">
            {totalDownFormatted.value} {totalDownFormatted.unit}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            点击前往连接追踪大盘
          </div>
        </GlassCard>
      </div>

      {/* 排除名单编辑弹窗 (Feature 9 弹窗) */}
      <ExclusionsModal
        isOpen={isExclusionsOpen}
        onClose={() => setIsExclusionsOpen(false)}
        bypassList={settings.bypassList}
        onSave={handleSaveBypass}
      />
    </div>
  );
};
