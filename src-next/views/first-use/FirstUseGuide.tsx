import { useEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { Button } from "../../primitives/Button";
import { invokeCommand, isTauriEnvironment } from "../../services/client";
import { fetchActiveConnections } from "../../services/connectionsService";
import type { GuideMethod } from "../../services/firstUseService";
import { toBundleGroupName } from "../../services/processRoutingService";
import { PROFILE_CHANGED_EVENT } from "../../services/profileService";
import { fetchProxiesData, type ProxiesSnapshot } from "../../services/proxyService";
import type { NavTab } from "../../shell/DesktopLayout";
import type { CoreStatusSnapshot, EngineMode } from "../../types/core";
import type { ProxyItem } from "../../types/proxy";
import { isRealProxyNode } from "../../utils/nodeParser";
import type { RoutingView } from "../../../src/types/routingOverrides";

interface GuideProps {
  tab: NavTab;
  status: CoreStatusSnapshot;
  method: GuideMethod | null;
  saving: boolean;
  onChoose: (method: GuideMethod | null) => void;
  onNavigate: (tab: NavTab) => void;
  onDismiss: () => void;
}

interface NextPage {
  tab: NavTab;
  label: string;
}

interface Step {
  number: number;
  title: string;
  detail: string;
  page?: NextPage;
  alternate?: NextPage;
  chooseMethod?: boolean;
  canFinish?: boolean;
}

function isOutletNode(node?: ProxyItem): node is ProxyItem {
  if (!node) return false;
  // Local nodes have a reserved runtime alias and still represent real outbounds.
  return node.name.startsWith("PW-L-")
    ? isRealProxyNode({ ...node, name: node.name.slice(5) })
    : isRealProxyNode(node);
}

function activeOutlet(snapshot: ProxiesSnapshot | null, mode: EngineMode): ProxyItem | undefined {
  if (!snapshot) return undefined;
  const groups = snapshot.groups.filter((group) =>
    !group.hidden && group.name !== "自建 VPS 节点" && !group.name.startsWith("PW-")
  );
  const ruleGroups = ["proxy", "节点选择", "本地方案·节点选择"];
  const preferred = mode === "global" ? ["global", ...ruleGroups] : [...ruleGroups, "global"];
  const group = preferred.map((name) => groups.find((item) => item.name.toLowerCase() === name))
    .find(Boolean) ?? groups[0];
  const visited = new Set<string>();
  let node = group?.now ? snapshot.proxies[group.now] : undefined;
  while (node?.now && !visited.has(node.name)) {
    visited.add(node.name);
    node = snapshot.proxies[node.now];
  }
  return isOutletNode(node) && !node.isCustom ? node : undefined;
}

const profilesPage: NextPage = { tab: "profiles", label: "添加订阅源" };
const nodesPage: NextPage = { tab: "proxies", label: "前往出口节点" };
const overviewPage: NextPage = { tab: "overview", label: "前往核心概览" };
const processPage: NextPage = { tab: "process", label: "前往进程分流" };
const connectionsPage: NextPage = { tab: "connections", label: "查看链接追踪" };

function getStep(
  hasNodes: boolean, testedOutlet: boolean, outletLabel: string,
  method: GuideMethod | null, systemProxyReady: boolean, systemVerified: boolean,
  processReady: boolean, observedBundle: string, mode: EngineMode,
): Step {
  if (!hasNodes) return {
    number: 1, title: "添加节点", detail: "添加并启用一份订阅，或在出口节点中添加自建节点。",
    page: profilesPage, alternate: { tab: "proxies", label: "添加自建节点" },
  };
  if (!testedOutlet) return {
    number: 2, title: "确认可用出口", detail: "在出口节点选择一个节点并完成测速。测速成功后继续。",
    page: nodesPage,
  };
  if (!method) return {
    number: 3, title: "选择使用方式", detail: outletLabel + " 已通过测速。选择系统代理，或只为指定应用分流。",
    chooseMethod: true,
  };
  if (method === "system") {
    if (!systemProxyReady) return {
      number: 3, title: "开启系统代理", detail: mode === "direct"
        ? "将分流模式切换到规则或全局，再开启系统代理。"
        : "在核心概览的「网络接管」中开启系统代理。",
      page: overviewPage,
    };
    return systemVerified ? {
      number: 4, title: "已取得出口检测结果", detail: "系统代理已开启。可在核心概览查看出口体检详情。",
      canFinish: true,
    } : {
      number: 4, title: "检测当前出口", detail: "在核心概览点击「刷新体检」，查看当前的出口 IP。",
      page: overviewPage,
    };
  }
  if (!processReady) return {
    number: 3, title: "配置指定应用分流",
    detail: "选择或新建一个业务规则包，绑定可用出口并启用套件和进程分流。",
    page: processPage,
  };
  return {
    number: 4,
    title: observedBundle ? "已观察到应用连接" : "配置完成，等待应用连接",
    detail: observedBundle
      ? `「${observedBundle}」已产生连接。可在链接追踪查看实际出口。`
      : "打开目标应用并发起一次请求，再到链接追踪查看它的出口。",
    page: connectionsPage,
    canFinish: true,
  };
}

export function FirstUseGuide({ tab, status, method, saving, onChoose, onNavigate, onDismiss }: GuideProps) {
  const [snapshot, setSnapshot] = useState<ProxiesSnapshot | null>(null);
  const [routing, setRouting] = useState<RoutingView | null>(null);
  const [testDelays, setTestDelays] = useState<Record<string, number>>({});
  const [checkedOutlet, setCheckedOutlet] = useState("");
  const [observedBundle, setObservedBundle] = useState("");
  const request = useRef(0);

  useEffect(() => {
    const load = async () => {
      const id = ++request.current;
      const [proxiesResult, routingResult] = await Promise.allSettled([
        fetchProxiesData(),
        isTauriEnvironment() ? invokeCommand<RoutingView>("get_routing_overrides") : Promise.resolve(null),
      ]);
      if (id !== request.current) return;
      setSnapshot(proxiesResult.status === "fulfilled" ? proxiesResult.value : null);
      setRouting(routingResult.status === "fulfilled" ? routingResult.value : null);
    };
    const onProfile = () => {
      setTestDelays({});
      setCheckedOutlet("");
      void load();
    };
    const onTested = (event: Event) => {
      const { name, delay } = (event as CustomEvent<{ name: string; delay: number }>).detail;
      setTestDelays((old) => ({ ...old, [name]: delay }));
    };
    void load();
    window.addEventListener(PROFILE_CHANGED_EVENT, onProfile);
    window.addEventListener("netbox-route-changed", load);
    window.addEventListener("procweaver-node-tested", onTested);
    return () => {
      ++request.current;
      window.removeEventListener(PROFILE_CHANGED_EVENT, onProfile);
      window.removeEventListener("netbox-route-changed", load);
      window.removeEventListener("procweaver-node-tested", onTested);
    };
  }, [status.running, tab]);

  const hasNodes = Object.values(snapshot?.proxies ?? {}).some(isOutletNode)
    || Boolean(routing?.targets.some((target) => target.kind === "node"));
  const outlet = activeOutlet(snapshot, status.mode);
  const delay = outlet ? testDelays[outlet.name] ?? outlet.history?.at(-1)?.delay : undefined;
  const testedOutlet = typeof delay === "number" && delay > 0;
  const outletLabel = (outlet && routing?.targetLabels?.[outlet.name]) || outlet?.name || "选中的出口";
  const systemProxyReady = status.running && Boolean(status.systemProxyEnabled) && status.mode !== "direct";
  const config = routing?.config;
  const applied = Boolean(routing?.running && config?.processEnabled && config.bundlesEnabled
    && routing.appliedRevision === config.revision);
  const bundles = applied ? (config?.bundles ?? []).filter((bundle) =>
    bundle.enabled && bundle.mainTarget && !routing?.unavailableRules?.includes(`bundle:${bundle.id}`)
  ) : [];
  const processReady = bundles.length > 0;
  const bundleRevision = processReady ? config?.revision : undefined;

  useEffect(() => {
    if (method !== "system" || !systemProxyReady || !outlet) {
      setCheckedOutlet("");
      return;
    }
    const check = () => setCheckedOutlet(outlet.name);
    window.addEventListener("procweaver-exit-checked", check);
    return () => window.removeEventListener("procweaver-exit-checked", check);
  }, [method, systemProxyReady, outlet?.name]);

  useEffect(() => {
    setObservedBundle("");
    if (method !== "process" || bundleRevision === undefined || !testedOutlet) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const verify = async () => {
      try {
        const { connections } = await fetchActiveConnections();
        if (!live) return;
        const matched = bundles.find((bundle) => connections.some((connection) =>
          connection.chains.includes(toBundleGroupName(bundle.id))
          || connection.metadata.processContext?.owner === `bundle:${bundle.id}`
        ));
        if (matched) {
          setObservedBundle(matched.name);
          return;
        }
      } catch {
        // Connection evidence may arrive after the target app starts.
      }
      if (live) timer = setTimeout(verify, 2000);
    };
    void verify();
    return () => { live = false; clearTimeout(timer); };
  }, [method, bundleRevision, testedOutlet]);

  const step = getStep(
    hasNodes, testedOutlet, outletLabel, method, systemProxyReady, checkedOutlet === outlet?.name,
    processReady, observedBundle, status.mode,
  );
  const page = step.page?.tab !== tab ? step.page : undefined;
  const alternate = step.alternate?.tab !== tab ? step.alternate : undefined;
  return (
    <section className="workbench-panel workbench-first-use-guide" aria-label="新手引导">
      <span className="workbench-first-use-icon"><Compass size={20} aria-hidden="true" /></span>
      <div className="workbench-first-use-guide-copy">
        <div className="workbench-first-use-progress">新手引导 <span>{step.number} / 4</span></div>
        <h2>{step.title}</h2>
        <p>{step.detail}</p>
      </div>
      <div className="workbench-first-use-guide-actions">
        {!step.canFinish && <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onDismiss}>稍后</Button>}
        {method && step.number >= 3 && (
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => onChoose(null)}>切换方式</Button>
        )}
        {step.chooseMethod && (
          <>
            <Button type="button" disabled={saving} onClick={() => onChoose("system")}>系统代理</Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => onChoose("process")}>指定应用分流</Button>
          </>
        )}
        {alternate && <Button type="button" onClick={() => onNavigate(alternate.tab)}>{alternate.label}</Button>}
        {page && <Button type="button" variant={step.canFinish ? "secondary" : "primary"} onClick={() => onNavigate(page.tab)}>{page.label}</Button>}
        {step.canFinish && <Button type="button" variant="primary" disabled={saving} onClick={onDismiss}>完成引导</Button>}
      </div>
    </section>
  );
}
