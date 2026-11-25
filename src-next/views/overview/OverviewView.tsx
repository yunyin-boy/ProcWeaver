// ==========================================================================
// ProcWeaver src-next 核心全功能中央驾驶舱 (对齐旧版 16 项全量能力)
// 规范溯源: taste-skill / impeccable-design / tauri-linear-raycast-ui
// ==========================================================================

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Globe, ChevronRight, Copy, Power } from "lucide-react";
import { RoutingModeControl } from "../../primitives/RoutingModeControl";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { ExclusionsModal } from "./ExclusionsModal";
import { CoreStatusSnapshot } from "../../types/core";
import { BandwidthSnapshot } from "../../types/telemetry";
import { ExitIpHealthInfo } from "../../types/exitHealth";
import { GeneralSettings, DEFAULT_GENERAL_SETTINGS } from "../../types/settings";
import { BundleSummary } from "../../types/bundle";
import {
  formatBitrate,
  formatTrafficBytes,
  calculateAdaptiveCeilingBps,
} from "../../services/telemetryService";
import { getActiveOutboundNode, ActiveNodeInfo } from "../../services/coreService";
import { isRealProxyNode } from "../../utils/nodeParser";
import { generateSvgWave } from "../../utils/trafficWave";
import { fetchExitIpHealth, getCachedExitHealth } from "../../services/exitHealthService";
import { toggleSystemProxy, getSystemProxyState } from "../../services/systemProxyService";
import { flushDns, reloadCoreConfig } from "../../services/dnsService";
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
  const [activeOutlet, setActiveOutlet] = useState<{ scope: string; node: ActiveNodeInfo } | null>(null);
  const [exitHealth, setExitHealth] = useState<ExitIpHealthInfo | null>(null);
  const [exitLoading, setExitLoading] = useState(false);
  const exitRequest = useRef(0);
  const { running, mode, activeProfile, mixedPort } = status;
  const outletScope = JSON.stringify([mode, activeProfile, mixedPort]);
  const currentNode = running && activeOutlet?.scope === outletScope ? activeOutlet.node : null;
  const hasProxyNode = Boolean(currentNode?.type && isRealProxyNode(currentNode));

  const loadExitHealth = useCallback(async (port: number, isManual = false) => {
    const request = ++exitRequest.current;
    setExitLoading(true);
    try {
      const data = await fetchExitIpHealth(port);
      if (request !== exitRequest.current) return;
      setExitHealth(data);
      if (isManual) {
        if (!data.ip) onShowNotice("未取得出口体检结果");
        else if (data.stale) onShowNotice("出口体检暂不可用，显示上次结果");
        else {
          onShowNotice(`出口体检完成 · ${data.country || data.ip}`);
          window.dispatchEvent(new Event("procweaver-exit-checked"));
        }
      }
    } catch {
      // 仅当用户主动点击“刷新体检”且完全无响应时才温和提示；后台静默体检绝不弹窗打扰
      if (isManual && request === exitRequest.current) {
        onShowNotice("出口网络探测耗时较长，节点仍在服务中");
      }
    } finally {
      if (request === exitRequest.current) setExitLoading(false);
    }
  }, [onShowNotice]);

  useEffect(() => {
    let outletRequest = 0;
    const refreshOutlet = async () => {
      const request = ++outletRequest;
      ++exitRequest.current;
      setActiveOutlet(null);
      setExitHealth(null);
      setExitLoading(false);
      if (!running) return;

      const node = await getActiveOutboundNode(mode);
      if (request !== outletRequest) return;
      setActiveOutlet({ scope: outletScope, node });
      if (node.type && isRealProxyNode(node) && mixedPort > 0) {
        setExitHealth(getCachedExitHealth());
        void loadExitHealth(mixedPort);
      }
    };

    void refreshOutlet();
    window.addEventListener("netbox-route-changed", refreshOutlet);
    return () => {
      ++outletRequest;
      ++exitRequest.current;
      window.removeEventListener("netbox-route-changed", refreshOutlet);
    };
  }, [running, mode, mixedPort, outletScope, loadExitHealth]);

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
      window.dispatchEvent(new Event("netbox-route-changed"));
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
  const handleCopyIp = async () => {
    if (!health) return;
    try {
      await navigator.clipboard.writeText(health.ip);
      onShowNotice(`已复制出口 IP ${health.ip}`);
    } catch {
      onShowNotice("复制出口 IP 失败");
    }
  };

  const [bundleSummary, setBundleSummary] = useState<BundleSummary | null>(null);

  useEffect(() => {
    const refreshBundleSummary = () => {
      getBundleSummary().then(setBundleSummary).catch(() => {});
    };
    refreshBundleSummary();
    window.addEventListener("netbox-route-changed", refreshBundleSummary);
    window.addEventListener("netbox-process-master-changed", refreshBundleSummary);
    window.addEventListener("procweaver-route-changed", refreshBundleSummary);
    return () => {
      window.removeEventListener("netbox-route-changed", refreshBundleSummary);
      window.removeEventListener("netbox-process-master-changed", refreshBundleSummary);
      window.removeEventListener("procweaver-route-changed", refreshBundleSummary);
    };
  }, []);

  const health = hasProxyNode && exitHealth?.ip && exitHealth.ip !== "待检测" ? exitHealth : null;
  const emptyExitValue = hasProxyNode ? "待检测" : "无";
  const fraudScore = health?.fraudScore;
  const hasScore = typeof fraudScore === "number" && Number.isFinite(fraudScore);
  let riskLabel = "暂无评分";
  let riskColor = "text-[var(--text-muted)]";
  if (hasScore) {
    if (fraudScore <= 25) {
      riskLabel = "低风险";
      riskColor = "text-[var(--workbench-positive)]";
    } else if (fraudScore <= 60) {
      riskLabel = "常见机房";
      riskColor = "text-[var(--workbench-warning)]";
    } else {
      riskLabel = "需注意";
      riskColor = "text-[var(--workbench-danger)]";
    }
  }

  const protocol = currentNode?.type ?? "";
  const connectionNote = /hysteria|tuic/i.test(protocol)
    ? "UDP / QUIC 协议"
    : /shadowsocks|trojan|vmess|vless/i.test(protocol)
      ? "支持 TCP 与 UDP 转发"
      : null;

  const downFormatted = formatBitrate(bandwidth.downloadRateBytes);
  const upFormatted = formatBitrate(bandwidth.uploadRateBytes);
  const totalDownFormatted = formatTrafficBytes(bandwidth.downloadTotalBytes);
  const totalUpFormatted = formatTrafficBytes(bandwidth.uploadTotalBytes);
  const bypassList = settings.bypassList ?? [];

  const linkedProperties = [
    {
      label: "链路能力",
      value: hasProxyNode ? protocol + " 链路" : "无",
      caption: hasProxyNode ? connectionNote : null,
      tab: "proxies",
      actionLabel: hasProxyNode ? "查看出口节点" : undefined,
    },
    {
      label: "分流业务包",
      value: bundleSummary ? bundleSummary.totalCount + " 个规则包" : "暂无数据",
      caption: bundleSummary?.isProcessMasterOn
        ? bundleSummary.activeCount + " 包生效 · " + bundleSummary.processCount + " 个匹配进程"
        : bundleSummary ? "进程分流已挂起" : null,
      tab: "process",
      actionLabel: "查看进程分流",
    },
  ];

  return (
    <div className="workbench-view workbench-overview">
      <section className="workbench-panel grid gap-4 p-4" aria-label="出口体检">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("proxies")}
            className="group flex min-w-0 items-center gap-3 rounded-lg text-left"
            title="切换出口节点"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--workbench-selected)] text-[var(--workbench-accent)]">
              <Globe size={20} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-[var(--text-muted)]">当前出口</span>
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong className="min-w-0 text-[21px] leading-tight tracking-tight [overflow-wrap:anywhere] group-hover:text-[var(--workbench-accent)]">{currentNode?.name ?? "暂无活动出口"}</strong>
                {protocol && <span className="workbench-tag">{protocol}</span>}
                {currentNode && typeof currentNode.delay === "number" && currentNode.delay > 0 && (
                  <span className="tabular-nums text-xs font-medium text-[var(--workbench-positive)]">{currentNode.delay} ms</span>
                )}
              </span>
            </span>
          </button>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="primary" size="sm" disabled={!hasProxyNode || mixedPort <= 0} loading={hasProxyNode && exitLoading} onClick={() => void loadExitHealth(mixedPort, true)}>刷新体检</Button>
            <Button size="sm" loading={reloading} onClick={handleReload}>重载配置</Button>
            <Button size="sm" loading={flushing} onClick={handleFlush}>清理 DNS</Button>
          </div>
        </div>

        {health?.stale && <p className="text-xs text-[var(--workbench-warning)]">当前显示上次体检结果</p>}
        <dl className="workbench-stat-grid workbench-exit-stats">
          <div>
            <dt className="flex flex-wrap items-center gap-2">
              落地 IP
              {health && (
                <button type="button" onClick={handleCopyIp} className="workbench-stat-action" title="复制出口 IP" aria-label="复制出口 IP">
                  <Copy size={12} aria-hidden="true" />
                </button>
              )}
            </dt>
            <dd className="tabular-nums">{health?.ip ?? emptyExitValue}</dd>
            {health?.asn && <dd className="workbench-stat-note">{health.asn}</dd>}
          </div>
          <div>
            <dt>落地地理</dt>
            <dd>{health?.country || health?.city || emptyExitValue}</dd>
            {health?.country && health.city && health.city !== health.country && (
              <dd className="workbench-stat-note">{health.city}</dd>
            )}
          </div>
          <div>
            <dt>欺诈风控</dt>
            <dd className={"tabular-nums " + riskColor}>{hasScore ? fraudScore + " / 100" : emptyExitValue}</dd>
            {hasScore && <dd className="workbench-stat-note">{riskLabel}</dd>}
          </div>
          <div>
            <dt>IP 属性</dt>
            <dd>{health?.isResidential === undefined ? emptyExitValue : health.isResidential ? "住宅网络" : "商用网络"}</dd>
            {typeof health?.firstPacketMs === "number" && <dd className="workbench-stat-note tabular-nums">首包 {health.firstPacketMs} ms</dd>}
          </div>
          {linkedProperties.map(({ label, value, caption, tab, actionLabel }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="tabular-nums">
                {actionLabel ? (
                  <button
                    type="button"
                    className="workbench-stat-link"
                    title={actionLabel}
                    aria-label={`${value}，${actionLabel}`}
                    onClick={() => onNavigateTab(tab)}
                  >
                    {value}
                  </button>
                ) : value}
              </dd>
              {caption && <dd className="workbench-stat-note">{caption}</dd>}
            </div>
          ))}
        </dl>
      </section>

      <div className="workbench-overview-columns">
        <section className="workbench-panel flex min-h-[290px] flex-col gap-2.5 p-4" aria-label="实时网络吞吐">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="workbench-panel-title">实时网络吞吐</h2>
            <span className="text-xs text-[var(--text-muted)]">最近 60 秒 · 每秒采样</span>
          </header>
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            {[
              { label: "下行", rate: downFormatted, color: "bg-[var(--workbench-down)]" },
              { label: "上行", rate: upFormatted, color: "bg-[var(--workbench-up)]" },
            ].map(({ label, rate, color }) => (
              <div key={label}>
                <dt className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span className={"size-1.5 rounded-full " + color} aria-hidden="true" />
                  {label}
                </dt>
                <dd className="tabular-nums text-[24px] font-bold leading-tight tracking-tight">
                  {rate.value} <span className="text-xs font-normal text-[var(--text-muted)]">{rate.unit}</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className="workbench-chart">
            <div className="workbench-chart-labels tabular-nums" aria-hidden="true">
              <span>{ceilingFormatted.value} {ceilingFormatted.unit}</span>
              <span>{halfCeilingFormatted.value} {halfCeilingFormatted.unit}</span>
              <span>0 bps</span>
            </div>
            <div className="workbench-chart-plot">
              <div className="workbench-chart-grid" aria-hidden="true"><span /><span /><span /></div>
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 1000 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="最近 60 秒的上下行速率曲线"
              >
                <defs>
                  <linearGradient id="overview-down-fill" x1="0" y1="0" x2="0" y2="100%">
                    <stop offset="0%" stopColor="var(--workbench-down)" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="var(--workbench-down)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={downWave.areaD} fill="url(#overview-down-fill)" />
                <path d={downWave.pathD} fill="none" stroke="var(--workbench-down)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <path d={upWave.pathD} fill="none" stroke="var(--workbench-up)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
            <div className="workbench-chart-time" aria-hidden="true"><span>60 秒前</span><span>30 秒前</span><span>现在</span></div>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
            <span>总下行 <strong className="tabular-nums text-[var(--text-secondary)]">{totalDownFormatted.value} {totalDownFormatted.unit}</strong></span>
            <span>总上行 <strong className="tabular-nums text-[var(--text-secondary)]">{totalUpFormatted.value} {totalUpFormatted.unit}</strong></span>
            <span>丢包率 暂无数据</span>
          </div>
        </section>

        <section className="workbench-panel flex flex-col gap-3 p-4" aria-label="网络接管">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="workbench-panel-title">网络接管</h2>
            <span className="tabular-nums text-[11px] text-[var(--text-muted)]" title="核心常驻时长">
              常驻 {formattedUptime}
            </span>
          </header>
          <div className="workbench-proxy-entry flex-1 content-center">
            <button
              type="button"
              role="switch"
              aria-label="系统代理"
              aria-checked={isSystemProxyActive}
              title={isSystemProxyActive ? "关闭系统代理" : "启动系统代理"}
              disabled={proxyPending}
              className="workbench-proxy-power"
              onClick={() => void handleToggleSystemProxy()}
            >
              <Power size={48} aria-hidden="true" />
            </button>
            <p className="mt-1 flex flex-wrap justify-center gap-x-1.5 text-xs">
              <span className="font-semibold">系统代理</span>
              <span role="status" className="text-[var(--text-muted)]">
                {proxyPending ? "切换中" : isSystemProxyActive ? "已接管" : "未接管"}
              </span>
            </p>
          </div>
          <div className="workbench-network-switches min-h-11" role="group" aria-label="网络开关">
            <div className="workbench-network-switch-row">
              <span>TUN 虚拟网卡</span>
              <CapsuleToggle checked={settings.tunMode} onChange={handleToggleTun} title="TUN 虚拟网卡" />
            </div>
            <div className="workbench-network-switch-row">
              <span>允许局域网</span>
              <CapsuleToggle checked={settings.allowLan} onChange={handleToggleLan} title="允许局域网" />
            </div>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium">分流模式</span>
            <RoutingModeControl mode={status.mode} onChange={onChangeMode} />
          </div>
          <button type="button" className="workbench-control-row min-h-11 w-full text-left" onClick={() => setIsExclusionsOpen(true)}>
            <div className="min-w-0">
              <p>排除名单</p>
              {bypassList.length > 0 && <span className="block truncate" title={bypassList.join(" · ")}>{bypassList.slice(0, 2).join(" · ")}</span>}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">{bypassList.length} 条 <ChevronRight size={13} aria-hidden="true" /></span>
          </button>
        </section>
      </div>

      <ExclusionsModal
        isOpen={isExclusionsOpen}
        onClose={() => setIsExclusionsOpen(false)}
        bypassList={bypassList}
        onSave={handleSaveBypass}
      />
    </div>
  );
};
