import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronRight, Expand, Globe2, Power, RefreshCw, Search, Stethoscope } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { Modal } from "../../primitives/Modal";
import { RoutingModeControl } from "../../primitives/RoutingModeControl";
import { formatMemoryBytes } from "../../services/coreService";
import { flushDns, reloadCoreConfig } from "../../services/dnsService";
import { PROFILE_CHANGED_EVENT } from "../../services/profileService";
import { fetchProxiesData, switchGroupProxy, type ProxiesSnapshot } from "../../services/proxyService";
import { getGeneralSettings, saveGeneralSettings } from "../../services/settingsService";
import { calculateAdaptiveCeilingBps, formatBitrate, formatTrafficBytes } from "../../services/telemetryService";
import type { CoreStatusSnapshot, EngineMode } from "../../types/core";
import type { ProxyItem } from "../../types/proxy";
import type { GeneralSettings } from "../../types/settings";
import type { BandwidthSnapshot } from "../../types/telemetry";
import { isAdOrInfoNode } from "../../utils/nodeParser";
import { generateSvgWave } from "../../utils/trafficWave";
import type { FormFactor } from "../../utils/useWindowFormFactor";
import { MiniProcessRouting } from "./MiniProcessRouting";

interface MiniWidgetViewProps {
  status: CoreStatusSnapshot;
  bandwidth: BandwidthSnapshot;
  onSetFormFactor: (factor: FormFactor) => void;
  onChangeMode: (mode: EngineMode) => Promise<void>;
  onToggleSystemProxy: (enabled: boolean) => Promise<void>;
  onShowNotice?: (message: string) => void;
  onNavigateTab?: (tab: string) => void;
}

const tabs = [
  { id: "monitor", label: "实时监控" },
  { id: "bundles", label: "进程分流" },
  { id: "tools", label: "急救工具" },
] as const;

type MiniTab = typeof tabs[number]["id"];
type NetworkOptions = Pick<GeneralSettings, "tunMode" | "allowLan">;
type ToolAction = "repair" | "restart";
const MAX_TRAFFIC_SAMPLES = 30;
const blockedTargets = new Set(["REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"]);

function getOutletGroup(snapshot: ProxiesSnapshot | null | undefined, mode: EngineMode) {
  if (!snapshot) return undefined;
  const manualGroups = snapshot.groups.filter((group) => (
    !group.hidden && group.name !== "自建 VPS 节点" && !group.name.startsWith("PW-")
    && ["select", "selector"].includes(group.type.toLowerCase())
  ));
  const ruleGroups = ["proxy", "节点选择", "本地方案·节点选择"];
  const preferred = mode === "global" ? ["global", ...ruleGroups] : [...ruleGroups, "global"];
  for (const name of preferred) {
    const group = manualGroups.find((item) => item.name.toLowerCase() === name);
    if (group) return group;
  }
  return manualGroups[0];
}

function getNodeDetail(node?: ProxyItem): string {
  const history = node?.history;
  const delay = history?.[history.length - 1]?.delay;
  return [node?.type, typeof delay === "number" && delay > 0 ? delay + " ms" : undefined].filter(Boolean).join(" · ");
}

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const days = Math.floor(seconds / 86400);
  const time = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
  return days ? days + " 天 " + time : time;
}

function describeRate(bytesPerSecond: number): string {
  const rate = formatBitrate(bytesPerSecond);
  return rate.value + " " + rate.unit;
}

function describeTotal(bytes: number): string {
  const total = formatTrafficBytes(bytes);
  return total.value + " " + total.unit;
}

export const MiniWidgetView: React.FC<MiniWidgetViewProps> = ({
  status,
  bandwidth,
  onSetFormFactor,
  onChangeMode,
  onToggleSystemProxy,
  onShowNotice,
  onNavigateTab,
}) => {
  const [tab, setTab] = useState<MiniTab>("monitor");
  const [outlets, setOutlets] = useState<ProxiesSnapshot | null>();
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [pendingNode, setPendingNode] = useState("");
  const [nodeError, setNodeError] = useState("");
  const [options, setOptions] = useState<NetworkOptions | null>();
  const [pendingControl, setPendingControl] = useState(false);
  const [toolAction, setToolAction] = useState<ToolAction | null>(null);
  const [traffic, setTraffic] = useState<{ down: number; up: number }[]>([]);
  const outletRequest = useRef(0);

  const refreshOutlets = useCallback(async () => {
    const id = ++outletRequest.current;
    try {
      const data = await fetchProxiesData();
      if (id === outletRequest.current) setOutlets(data);
    } catch {
      if (id === outletRequest.current) setOutlets(null);
    }
  }, []);

  const readNetworkOptions = useCallback(async () => {
    try {
      const { tunMode, allowLan } = await getGeneralSettings({ strict: true });
      setOptions({ tunMode, allowLan });
    } catch {
      setOptions(null);
    }
  }, []);

  useEffect(() => { void readNetworkOptions(); }, [readNetworkOptions]);

  useEffect(() => {
    const reload = () => void refreshOutlets();
    reload();
    window.addEventListener(PROFILE_CHANGED_EVENT, reload);
    window.addEventListener("netbox-active-node-changed", reload);
    return () => {
      ++outletRequest.current;
      window.removeEventListener(PROFILE_CHANGED_EVENT, reload);
      window.removeEventListener("netbox-active-node-changed", reload);
    };
  }, [refreshOutlets, status.running]);

  useEffect(() => {
    if (!status.running) {
      setTraffic([]);
      return;
    }
    setTraffic((samples) => [...samples.slice(1 - MAX_TRAFFIC_SAMPLES), {
      down: bandwidth.downloadRateBytes * 8,
      up: bandwidth.uploadRateBytes * 8,
    }]);
  }, [bandwidth, status.running]);

  const group = useMemo(() => getOutletGroup(outlets, status.mode), [outlets, status.mode]);
  const nodes = useMemo(() => {
    if (!outlets || !group) return [];
    return group.all.flatMap((name) => {
      const node = outlets.proxies[name];
      return node && !node.all && !blockedTargets.has(name) && !isAdOrInfoNode(name) ? [{ ...node, name }] : [];
    });
  }, [group, outlets]);

  const query = nodeSearch.trim().toLowerCase();
  const visibleNodes = query ? nodes.filter((node) => node.name.toLowerCase().includes(query)) : nodes;
  const isDirect = status.mode === "direct";
  const chosenNode = isDirect ? "DIRECT" : group?.now;
  const outletName = chosenNode || (outlets === undefined ? "正在读取…" : outlets === null ? "读取失败" : "暂无出口选择");
  const outletDetail = isDirect ? "直连模式" : [group?.name, getNodeDetail(chosenNode ? outlets?.proxies[chosenNode] : undefined)].filter(Boolean).join(" · ");

  const waves = useMemo(() => {
    const down = traffic.map((sample) => sample.down);
    const up = traffic.map((sample) => sample.up);
    const ceiling = calculateAdaptiveCeilingBps(Math.max(1, ...down, ...up));
    return [generateSvgWave(down, 46, ceiling), generateSvgWave(up, 46, ceiling)];
  }, [traffic]);

  const openNodePicker = () => {
    setNodeSearch("");
    setNodeError("");
    setShowNodePicker(true);
    void refreshOutlets();
  };

  const selectNode = async (node: ProxyItem) => {
    if (!group || pendingNode || node.name === group.now) return;
    setPendingNode(node.name);
    setNodeError("");
    try {
      if (!(await switchGroupProxy(group.name, node.name))) throw new Error("策略组未接受切换");
      await refreshOutlets();
      setShowNodePicker(false);
      onShowNotice?.("已切换 " + group.name + " 的出口");
    } catch (error) {
      setNodeError("切换出口失败，" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPendingNode("");
    }
  };

  const runControl = async (action: () => Promise<void>) => {
    if (pendingControl || toolAction) return;
    setPendingControl(true);
    try { await action(); }
    catch (error) { onShowNotice?.("更新网络设置失败，" + (error instanceof Error ? error.message : String(error))); }
    finally { setPendingControl(false); }
  };

  const changeNetworkOption = (key: keyof NetworkOptions, checked: boolean) => {
    if (!options) return;
    void runControl(async () => {
      await saveGeneralSettings(key === "tunMode"
        ? { tunMode: checked, trafficMode: checked ? "tun" : "app_proxy" }
        : { allowLan: checked });
      setOptions({ ...options, [key]: checked });
      onShowNotice?.((key === "tunMode" ? "TUN" : "局域网访问") + (checked ? "已开启" : "已关闭"));
    });
  };

  const runTool = async (action: ToolAction) => {
    if (toolAction || pendingControl) return;
    setToolAction(action);
    try {
      if (action === "repair") {
        await flushDns();
        onShowNotice?.("网络修复已完成");
      } else {
        await reloadCoreConfig();
        onShowNotice?.("核心已重启");
      }
      await Promise.all([readNetworkOptions(), refreshOutlets()]);
    } catch (error) {
      onShowNotice?.((action === "repair" ? "网络修复失败，" : "重启核心失败，") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setToolAction(null);
    }
  };

  const systemProxy = Boolean(status.systemProxyEnabled);
  const proxyStatus = systemProxy ? "已接管" : status.running ? "未接管" : "核心未启动";
  const controlBusy = pendingControl || toolAction !== null;
  const runningTime = status.running ? formatUptime(status.uptimeSeconds) : "—";
  const memory = status.running && status.memoryUsageBytes ? formatMemoryBytes(status.memoryUsageBytes) : "—";

  return (
    <div className="workbench-view workbench-mini">
      <nav className="workbench-segments workbench-mini-nav" aria-label="挂件视口导航">
        {tabs.map((item) => (
          <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </nav>

      {tab === "monitor" && (
        <div className="workbench-mini-page" aria-label="挂件实时监控">
          <section className="workbench-panel workbench-mini-panel workbench-mini-access" aria-label="挂件网络接管">
            <div className="workbench-proxy-entry">
              <button
                type="button"
                role="switch"
                aria-label="系统代理"
                aria-checked={systemProxy}
                title={systemProxy ? "关闭系统代理" : "开启系统代理"}
                disabled={controlBusy || (!status.running && !systemProxy)}
                className="workbench-proxy-power"
                onClick={() => void runControl(() => onToggleSystemProxy(!systemProxy))}
              >
                <Power size={22} aria-hidden="true" />
              </button>
              <p className="flex flex-wrap justify-center gap-x-1.5 text-xs">
                <span className="font-semibold">系统代理</span>
                <span role="status" className="text-[var(--text-muted)]">{proxyStatus}</span>
              </p>
            </div>
            <div className="workbench-network-switches" role="group" aria-label="网络开关">
              <div className="workbench-network-switch-row">
                <span>TUN 虚拟网卡</span>
                <CapsuleToggle title="TUN 虚拟网卡" checked={Boolean(options?.tunMode)} disabled={!options || controlBusy}
                  onChange={(checked) => changeNetworkOption("tunMode", checked)} />
              </div>
              <div className="workbench-network-switch-row">
                <span>允许局域网</span>
                <CapsuleToggle title="允许局域网" checked={Boolean(options?.allowLan)} disabled={!options || controlBusy}
                  onChange={(checked) => changeNetworkOption("allowLan", checked)} />
              </div>
            </div>
            {options === null && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span>读取网络设置失败</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => void readNetworkOptions()}>重试</Button>
              </div>
            )}
          </section>

          <section className="workbench-panel workbench-mini-panel" aria-label="挂件网络">
            <div className="workbench-mini-outlet" role="group" aria-label="挂件出口">
              <span className="workbench-mini-glyph" aria-hidden="true"><Globe2 size={17} /></span>
              <div className="grid min-w-0 gap-0.5">
                <span className="text-[11px] text-[var(--text-muted)]">出口</span>
                <strong className="truncate text-[13px] font-semibold" title={outletName}>{outletName}</strong>
                {outletDetail && <p className="truncate text-[11px] text-[var(--text-muted)]" title={outletDetail}>{outletDetail}</p>}
              </div>
              <Button type="button" size="sm" onClick={openNodePicker}>
                更换 <ChevronRight size={13} aria-hidden="true" />
              </Button>
            </div>
            <div className="workbench-routing-mode-row">
              <span className="text-xs text-[var(--text-muted)]">分流模式</span>
              <RoutingModeControl mode={status.mode} disabled={controlBusy}
                onChange={(mode) => { if (mode !== status.mode) void runControl(() => onChangeMode(mode)); }} />
            </div>
          </section>

          <section className="workbench-panel workbench-mini-panel workbench-mini-flow" aria-label="挂件实时流量">
            <h3 className="text-[13px] font-semibold">实时流量</h3>
            <div className="workbench-mini-stats">
              <div>
                <span className="workbench-mini-metric-label" style={{ color: "var(--workbench-down)" }}><ArrowDown size={13} aria-hidden="true" />下行</span>
                <strong>{describeRate(status.running ? bandwidth.downloadRateBytes : 0)}</strong>
                <small>累计 {describeTotal(bandwidth.downloadTotalBytes)}</small>
              </div>
              <div>
                <span className="workbench-mini-metric-label" style={{ color: "var(--workbench-up)" }}><ArrowUp size={13} aria-hidden="true" />上行</span>
                <strong>{describeRate(status.running ? bandwidth.uploadRateBytes : 0)}</strong>
                <small>累计 {describeTotal(bandwidth.uploadTotalBytes)}</small>
              </div>
            </div>
            <svg className="workbench-mini-chart" viewBox="0 0 1000 50" preserveAspectRatio="none" role="img" aria-label="上下行速率趋势">
              <path d="M 0 8 H 1000 M 0 27 H 1000 M 0 46 H 1000" stroke="var(--workbench-chart-grid)" vectorEffect="non-scaling-stroke" fill="none" />
              <path d={waves[0].pathD} stroke="var(--workbench-down)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" fill="none" />
              <path d={waves[1].pathD} stroke="var(--workbench-up)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" fill="none" />
            </svg>
            <div className="workbench-mini-runtime">
              <span>核心运行 <strong>{runningTime}</strong></span>
              <span>内存 <strong>{memory}</strong></span>
            </div>
          </section>
        </div>
      )}

      {tab === "bundles" && <MiniProcessRouting onManage={onNavigateTab ? () => onNavigateTab("process") : undefined} onShowNotice={onShowNotice} />}

      {tab === "tools" && (
        <div className="workbench-mini-page" aria-label="挂件急救工具">
          <section className="workbench-panel workbench-mini-panel" aria-label="核心与端口">
            <div className="workbench-mini-stats">
              <div><span className="workbench-mini-metric-label">混合代理端口</span><strong>{status.mixedPort}</strong></div>
              <div><span className="workbench-mini-metric-label">核心状态</span><strong>{status.running ? "运行中" : "已停止"}</strong></div>
            </div>
          </section>
          <section className="workbench-panel workbench-mini-panel" aria-label="挂件网络维护">
            <div className="workbench-mini-command">
              <div>
                <h3>网络修复</h3>
                <p>清理 DNS 缓存并修复网络设置。</p>
              </div>
              <Button type="button" size="sm" aria-label="运行网络修复" onClick={() => void runTool("repair")} disabled={controlBusy} loading={toolAction === "repair"}>
                {toolAction !== "repair" && <Stethoscope size={14} aria-hidden="true" />}运行
              </Button>
            </div>
            <div className="workbench-mini-command">
              <div>
                <h3>重启核心</h3>
                <p>重新载入当前代理配置。</p>
              </div>
              <Button type="button" size="sm" aria-label="重启代理核心" onClick={() => void runTool("restart")} disabled={controlBusy} loading={toolAction === "restart"}>
                {toolAction !== "restart" && <RefreshCw size={14} aria-hidden="true" />}重启
              </Button>
            </div>
          </section>
          <Button type="button" variant="ghost" onClick={() => onSetFormFactor("standard")}>
            <Expand size={14} aria-hidden="true" />展开标准工作台
          </Button>
        </div>
      )}

      <Modal isOpen={showNodePicker} onClose={() => { if (!pendingNode) setShowNodePicker(false); }} title="更换出口" subtitle={group?.name}>
        <div className="grid min-w-0 gap-3">
          <label className="workbench-field workbench-mini-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" aria-label="搜索挂件出口" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)}
              placeholder="搜索此策略组的节点" />
          </label>
          {nodeError && <p className="workbench-mini-error" role="alert">{nodeError}</p>}
          <ul className="workbench-mini-node-list" aria-label="可切换的节点">
            {visibleNodes.map((node) => {
              const selected = node.name === group?.now;
              return (
                <li key={node.name}>
                  <Button type="button" size="sm" className="workbench-mini-node" variant={selected ? "primary" : "secondary"}
                    aria-current={selected || undefined}
                    onClick={() => void selectNode(node)} disabled={selected || !!pendingNode} loading={pendingNode === node.name}>
                    <span className="grid min-w-0 flex-1 gap-0.5 text-left">
                      <span className="truncate" title={node.name}>{node.name}</span>
                      <span className="truncate text-[11px] font-normal text-[var(--text-muted)]">{getNodeDetail(node)}</span>
                    </span>
                    {selected && <span className="shrink-0 text-[11px]">已选</span>}
                  </Button>
                </li>
              );
            })}
          </ul>
          {!visibleNodes.length && (
            <p className="py-2 text-xs text-[var(--text-muted)]">
              {outlets === undefined ? "正在读取出口…" : nodes.length ? "没有匹配的节点" : "暂无可切换的节点"}
            </p>
          )}
          {onNavigateTab && (
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" disabled={!!pendingNode} onClick={() => onNavigateTab("proxies")}>
                打开出口节点 <ArrowUpRight size={13} aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
