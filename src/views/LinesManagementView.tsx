import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ProxyGroup, ProxyItem, IpHealthInfo, ProfileItem } from "../types";
import { SmartGroupRule } from "../types/smartGroup";
import { fetchProxies, fetchMihomoConfig, switchProxy, switchPublicNode, testDelay, getPreferredSpeedTestUrl } from "../api/mihomo";
import { mobileSelectionGroup, selectedLeaf, type MobileCoreMode } from "../utils/mobileNodeSelection";
import { logInfo, logWarn, logError } from "../api/logs";
import {
  getSmartGroups,
  syncSmartGroupsToCore,
  getProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
} from "../api";
import {
  probeNodeHealthBatch,
  getPersistedHealthCache,
  savePersistedHealthCache,
  getPersistedNodeRegions,
  savePersistedNodeRegions,
  flushHealthCache,
  flushNodeRegions,
  getIgnoredNodes,
  saveIgnoredNodes,
} from "../api/nodeHealth";
import { getStoredConcurrency, getStoredHealthProbeConcurrency } from "../utils/taskQueue";
import {
  parseMultiplier,
  formatMultiplier,
  formatCountryRegionTitle,
  isInformationalNode,
  extractSubscriptionMeta,
  filterAndSortProxies,
} from "../utils/proxyParser";
import { setGlobalTrayGroups } from "../hooks/useTrayManager";
import { buildCategorizedTrayGroups, RawNodeForTray } from "../utils/trayGroups";
import { SmartGroupModal } from "../components/SmartGroupModal";
import { VirtualGrid, VirtualGridScroller } from "../components/VirtualGrid";
import { MobileNodeCard } from "../components/MobileNodeCard";
import { createBatchUpdates } from "../utils/batchUpdates";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useProfileSwitch } from "../hooks/useProfileSwitch";
import { ProfileSwitchDialog } from "../components/ProfileSwitchDialog";
import { LocalNodeDialog } from "../components/LocalNodeDialog";
import { useLocalNodes } from "../hooks/useLocalNodes";
import type { LocalNodeSummary } from "../types/localNodes";
import { useCoreStatus } from "../hooks/useCoreStatus";
import { probeUnlockMatrix } from "../api/unlock";
import { UnlockItem } from "../types";
import {
  Search,
  RefreshCw,
  Plus,
  Radio,
  Zap,
  Link2,
  Pencil,
  Trash2,
  CheckSquare,
  Square,
  Globe,
  X,
  Shield,
  Check,
  Eye,
  EyeOff,
  ScrollText,
  ChevronDown,
  List,
  LayoutGrid,
  Info,
  Sparkles,
  Compass,
  Copy,
  SlidersHorizontal,
  ArrowDownUp,
  Cpu,
  Layers,
} from "lucide-react";

// 格式化字节为易读格式 (GB / MB)
function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${parseFloat(val.toFixed(1))} ${sizes[i]}`;
}

function formatFriendlyProbeError(raw?: string): string {
  if (!raw) return "未获取到有效出口 IP";
  const text = String(raw).trim();
  if (/unexpected eof|\beof\b/i.test(text)) return "连接意外中断 (EOF)";
  if (/timeout|timed?\s*out|deadline exceeded|超时/i.test(text)) return "节点响应超时";
  if (/connection refused|actively refused|拒绝/i.test(text)) return "目标拒绝连接";
  if (/connection reset|forcibly closed|重置/i.test(text)) return "连接被远端重置";
  if (/no such host|dns|lookup/i.test(text)) return "域名解析失败";
  const cleaned = text
    .replace(/(?:Get|Post|Head)\s+"https?:\/\/[^"]+"\s*:\s*/gi, "")
    .replace(/https?:\/\/[^\s"']+/gi, "")
    .trim();
  return cleaned || "探测请求失败";
}

export const LinesManagementView: React.FC<{ coreMode?: MobileCoreMode }> = React.memo(({ coreMode = null }) => {
  const mobile = document.documentElement.dataset.platform === "android";
  const [catalogOffline, setCatalogOffline] = useState(false);
  const healthUnavailable = !mobile && catalogOffline;
  const [catalogMessage, setCatalogMessage] = useState("");
  const [probeMessage, setProbeMessage] = useState("");
  const [probeFailures, setProbeFailures] = useState<Array<{ node: string; reason: string }>>([]);
  const [probeDetailOpen, setProbeDetailOpen] = useState(false);
  const readRevision = useRef(0);
  const nodeSession = useRef(0);
  const [subDrawerTab, setSubDrawerTab] = useState<"subscriptions" | "custom">("subscriptions");
  const openSubscriptions = (tab?: "subscriptions" | "custom" | React.MouseEvent) => {
    const validTab = (tab === "subscriptions" || tab === "custom") ? tab : "subscriptions";
    setSubDrawerTab(validTab);
    if (mobile) window.dispatchEvent(new CustomEvent("netbox-navigate-tab", { detail: "profiles" }));
    else setSubDrawerOpen(true);
  };
  const profileSwitch = useProfileSwitch();
  const localNodes = useLocalNodes();
  const localByAlias = useMemo(() => new Map(localNodes.view?.nodes.map(n => [n.alias, n]) || []), [localNodes.view]);
  const nodeLabel = (name: string) => localByAlias.get(name)?.name || name;
  const [sourceFilter, setSourceFilter] = useState("all");
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<"group" | "filter" | "sort" | null>(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const groupBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const toggleFilterDropdown = (type: "group" | "filter" | "sort", btn: HTMLButtonElement | null) => {
    if (activeFilterDropdown === type) {
      setActiveFilterDropdown(null);
      return;
    }
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setFilterDropdownPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
      });
    }
    setActiveFilterDropdown(type);
  };

  useEffect(() => {
    if (!activeFilterDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (filterDropdownRef.current?.contains(target)) return;
      if (groupBtnRef.current?.contains(target)) return;
      if (filterBtnRef.current?.contains(target)) return;
      if (sortBtnRef.current?.contains(target)) return;
      setActiveFilterDropdown(null);
    };
    const handleScrollOrResize = () => {
      setActiveFilterDropdown(null);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [activeFilterDropdown]);
  const [groups, setGroups] = useState<ProxyGroup[]>([]);
  const [selectionGroup, setSelectionGroup] = useState("");
  const switchingNode = useRef(false);
  const [switchingNodeName, setSwitchingNodeName] = useState<string | null>(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileSelecting, setMobileSelecting] = useState(false);
  const [proxies, setProxies] = useState<Record<string, ProxyItem>>({});
  const [delayMap, setDelayMap] = useState<Record<string, number | null>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [testingNodes, setTestingNodes] = useState<Record<string, boolean>>({});
  const [searchKeyword, setSearchKeyword] = useState("");
  const search = useDebouncedValue(searchKeyword, 180);
  const pendingBatches = useRef(new Set<() => void>());
  const pendingJobs = useRef(new Set<AbortController>());
  useEffect(() => {
    const flush = () => {
      pendingBatches.current.forEach(commit => commit());
      flushNodeRegions();
      void flushHealthCache().catch(error => logError("IP健康", `保存体检缓存失败：${String(error)}`));
    };
    const hidden = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      pendingJobs.current.forEach(job => job.abort()); pendingJobs.current.clear();
      flush(); pendingBatches.current.clear();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const [hideTimeout, setHideTimeout] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("netbox_hide_timeout_nodes");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });
  const [sortBy, setSortBy] = useState<"default" | "latency-asc" | "name-asc">("default");
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (sourceFilter !== "all") count++;
    if (hideTimeout) count++;
    return count;
  }, [sourceFilter, hideTimeout]);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const handleCopyNodeInfo = async (node: LocalNodeSummary) => {
    const info = `${node.protocol}://${node.server}:${node.port}#${encodeURIComponent(node.name)}`;
    try {
      await navigator.clipboard.writeText(info);
      setCopyNotice(`已复制「${node.name}」配置链接`);
      setTimeout(() => setCopyNotice(null), 2500);
    } catch {
      setCopyNotice("剪贴板写入失败");
      setTimeout(() => setCopyNotice(null), 2000);
    }
  };

  // 自建智能策略组规则
  const [smartRules, setSmartRules] = useState<SmartGroupRule[]>([]);
  const [smartModalOpen, setSmartModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SmartGroupRule | null>(null);
  const smartTrigger = useRef<HTMLButtonElement | null>(null);

  // 节点多选打包
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedNodes), [selectedNodes]);
  const [packModalType, setPackModalType] = useState<"url-test" | "relay" | null>(null);
  const [packName, setPackName] = useState("");
  const [packError, setPackError] = useState("");
  const [packSaving, setPackSaving] = useState(false);
  const packPending = useRef(false);
  const packDialog = useRef<HTMLDialogElement>(null);
  const closePack = () => { if (!packPending.current) setPackModalType(null); };
  useEffect(() => {
    setPackError("");
    if (packModalType) packDialog.current?.showModal();
    else packDialog.current?.close();
  }, [packModalType]);

  // 侧边订阅管理抽屉
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);

  // 核心状态联动
  const { status: coreStatus } = useCoreStatus();

  // A+B 双模视图控制 (方案 A：默认 Table View 紧凑表格，支持切换为 Grid View 自适应微卡)
  const [viewMode, setViewMode] = useState<"table" | "grid">(() => {
    try {
      return (localStorage.getItem("netbox_lines_view_mode") as "table" | "grid") || "table";
    } catch {
      return "table";
    }
  });
  const handleToggleViewMode = (mode: "table" | "grid") => {
    setViewMode(mode);
    try {
      localStorage.setItem("netbox_lines_view_mode", mode);
    } catch {}
  };

  // 浮动右侧：节点全息解锁/风控详情抽屉 (Inspector Drawer)
  const [inspectorNode, setInspectorNode] = useState<ProxyItem | null>(null);
  const [inspectorUnlocks, setInspectorUnlocks] = useState<UnlockItem[]>([]);
  const [testingUnlocks, setTestingUnlocks] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const copyToClipboard = (text: string) => {
    try {
      void navigator.clipboard.writeText(text);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 2000);
    } catch {}
  };

  const openInspector = (node: ProxyItem) => {
    setInspectorNode(node);
    setInspectorUnlocks([]);
  };
  const closeInspector = () => {
    setInspectorNode(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (inspectorNode) closeInspector();
        if (activeFilterDropdown) setActiveFilterDropdown(null);
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inspectorNode, activeFilterDropdown]);

  const handleRetestUnlocks = async () => {
    if (testingUnlocks) return;
    setTestingUnlocks(true);
    try {
      const port = coreStatus.mixedPort || 7890;
      const results = await probeUnlockMatrix(port);
      setInspectorUnlocks(results);
    } catch (err) {
      console.error("探测流媒体/AI 解锁能力失败:", err);
    } finally {
      setTestingUnlocks(false);
    }
  };
  const [subLoading, setSubLoading] = useState(false);
  const [newSubUrl, setNewSubUrl] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [showAddSubModal, setShowAddSubModal] = useState(false);
  const [switchingProfileId, setSwitchingProfileId] = useState<string | null>(null);
  const [subError, setSubError] = useState("");
  const [addSubError, setAddSubError] = useState("");
  const [subNotice, setSubNotice] = useState("");
  const subPending = useRef(false);
  const profileReadVersion = useRef(0);
  const subDrawer = useRef<HTMLDialogElement>(null);
  const addSubDialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (subDrawerOpen && !subDrawer.current?.open) subDrawer.current?.showModal();
    else if (!subDrawerOpen) subDrawer.current?.close();
  }, [subDrawerOpen]);
  useEffect(() => {
    if (showAddSubModal && !addSubDialog.current?.open) addSubDialog.current?.showModal();
    else if (!showAddSubModal) addSubDialog.current?.close();
  }, [showAddSubModal]);

  const closeSubscriptionDialog = (adding: boolean) => {
    if (subPending.current) return;
    if (adding) setShowAddSubModal(false);
    else setSubDrawerOpen(false);
  };
  const closeSubscriptionBackdrop = (event: React.MouseEvent<HTMLDialogElement>, adding: boolean) => {
    if (event.target === event.currentTarget && backdropPressed.current === event.currentTarget) {
      closeSubscriptionDialog(adding);
    }
    backdropPressed.current = null;
  };

  // 节点 IP 纯净度缓存与全量体检状态
  const [healthCache, setHealthCache] = useState<Record<string, IpHealthInfo>>({});
  const [probingNodes, setProbingNodes] = useState<Record<string, boolean>>({});
  const [probingAll, setProbingAll] = useState(false);
  const singleProbeBusy = useRef(false);
  const anySingleProbe = Object.values(probingNodes).some(Boolean);
  const [probeProgress, setProbeProgress] = useState<{ completed: number; total: number } | null>(null);

  // 节点归属国家/地区持久化字典 (nodeName -> "🇯🇵 日本")
  const [persistedNodeRegions, setPersistedNodeRegions] = useState<Record<string, string>>({});

  // 用户主动忽略的节点名称列表 (本地持久化)
  const [ignoredNodes, setIgnoredNodes] = useState<string[]>(() => getIgnoredNodes());
  const ignoredSet = useMemo(() => new Set(ignoredNodes), [ignoredNodes]);
  const [showIgnoredDrawer, setShowIgnoredDrawer] = useState(false);

  // 初始加载
  const loadData = async () => {
    const revision = ++readRevision.current;
    const profileVersion = profileReadVersion.current;
    try {
      const pData = await fetchProxies();
      if (revision !== readRevision.current) return;
      setCatalogOffline(Boolean(pData.offline));
      setCatalogMessage((pData.warnings || []).join("；"));
      setProxies(pData.proxies || {});
      setGroups(pData.groups || []);

      const sRules = await getSmartGroups();
      if (revision !== readRevision.current) return;
      setSmartRules(sRules);

      const savedCache = await getPersistedHealthCache();
      if (revision !== readRevision.current) return;
      const diskCache = mobile ? Object.fromEntries(Object.entries(savedCache).filter(([name, info]) => Boolean(pData.proxies[name]?.catalogKey) && info.catalogKey === pData.proxies[name].catalogKey)) : savedCache;
      if (diskCache) setHealthCache(diskCache);

      const diskRegions = await getPersistedNodeRegions();
      if (revision !== readRevision.current) return;
      const mergedRegions = mobile ? {} as Record<string, string> : { ...diskRegions };
      if (diskCache) {
        Object.entries(diskCache).forEach(([name, info]) => {
          if (info.countryCode && !mergedRegions[name]) {
            mergedRegions[name] = formatCountryRegionTitle(info.countryCode, info.country);
          }
        });
      }
      setPersistedNodeRegions(mergedRegions);
      savePersistedNodeRegions(mergedRegions);

      const savedIgnored = getIgnoredNodes();
      setIgnoredNodes(savedIgnored);

      const profs = await getProfiles();
      if (profileVersion === profileReadVersion.current) setProfiles(profs);
    } catch (err) {
      if (revision === readRevision.current) {
        setCatalogMessage(`读取节点失败：${String(err)}`);
        setCatalogOffline(true);
        setProxies({});
        setGroups([]);
      }
      console.error("加载线路管理大盘数据失败:", err);
    }
  };

  useEffect(() => {
    loadData();
    const handleProfileChange = () => {
      nodeSession.current++;
      pendingJobs.current.forEach(job => job.abort());
      pendingBatches.current.forEach(flush => flush());
      setTestingNodes({});
      setDelayMap({});
      setSelectionGroup("");
      void loadData();
    };
    const handleHealthUpdated = (e: any) => {
      const { node, health } = e.detail || {};
      if (node && health) {
        setHealthCache((prev) => ({ ...prev, [node]: health }));
      }
    };
    window.addEventListener("procweaver-profile-changed", handleProfileChange);
    window.addEventListener("netbox-core-status-changed", handleProfileChange);
    window.addEventListener("netbox-node-health-updated", handleHealthUpdated);
    return () => {
      window.removeEventListener("procweaver-profile-changed", handleProfileChange);
      window.removeEventListener("netbox-core-status-changed", handleProfileChange);
      readRevision.current++;
      nodeSession.current++;
      window.removeEventListener("netbox-node-health-updated", handleHealthUpdated);
    };
  }, []);

  // 提取所有真实出站节点（坚决排除套餐、到期日、剩余流量与 Compatible 占位符）
  const realNodes = useMemo(() => {
    const list: ProxyItem[] = [];
    const specialTypes = new Set(["Selector", "URLTest", "Fallback", "LoadBalance", "Relay", "Direct", "Reject"]);
    Object.values(proxies).forEach((p) => {
      if (
        !specialTypes.has(p.type) &&
        p.name !== "GLOBAL" &&
        p.name !== "DIRECT" &&
        p.name !== "REJECT" &&
        !isInformationalNode(p.name, p.type)
      ) {
        list.push(p);
      }
    });
    for (const node of localNodes.view?.nodes || []) {
      if (!list.some(p => p.name === node.alias)) list.push({ name: node.alias, type: node.protocol, udp: false, history: [] });
    }
    return list;
  }, [proxies, localNodes.view]);

  const realNodeNames = useMemo(() => realNodes.map((n) => n.name), [realNodes]);
  const smartFallbackOptions = useMemo(() => ["DIRECT", "REJECT", ...realNodeNames], [realNodeNames]);
  const smartCounts = useMemo(() => Object.fromEntries(smartRules.map(rule => [rule.id,
    rule.type === "relay" ? (rule.relayEntry && rule.relayExit ? 2 : 0)
      : rule.nodeSelectionMode === "manual" ? rule.manualNodes?.length || 0 : filterAndSortProxies(realNodeNames, rule, healthCache, delayMap).length,
  ])), [smartRules, realNodeNames, healthCache, delayMap]);

  // 从所有节点中提炼账号订阅状态 (剩余流量、套餐到期日、重置倒计时)
  const subMeta = useMemo(() => {
    return extractSubscriptionMeta(Object.values(proxies));
  }, [proxies]);

  // 忽略单个节点
  const handleIgnoreNode = (nodeName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!ignoredNodes.includes(nodeName)) {
      const next = [...ignoredNodes, nodeName];
      setIgnoredNodes(next);
      saveIgnoredNodes(next);
    }
  };

  // 取消忽略单个节点 (恢复)
  const handleUnignoreNode = (nodeName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = ignoredNodes.filter((n) => n !== nodeName);
    setIgnoredNodes(next);
    saveIgnoredNodes(next);
  };

  // 一键忽略全部未体检节点
  const handleIgnoreAllUnprobed = (unprobedNodes: ProxyItem[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    const names = unprobedNodes.map((n) => n.name);
    const next = Array.from(new Set([...ignoredNodes, ...names]));
    setIgnoredNodes(next);
    saveIgnoredNodes(next);
  };

  // 当前激活使用中的主节点名称
  const activeNodeName = useMemo(() => {
    if (mobile) return selectedLeaf(groups, mobileSelectionGroup(groups, coreMode, selectionGroup));
    const publicGroup = groups.find(
      (g) => !g.hidden && !g.name.startsWith("PW-") && (g.name === "PROXY" || g.name === "GLOBAL" || g.name.includes("节点选择"))
    ) || groups.find((g) => !g.hidden && !g.name.startsWith("PW-"));
    return publicGroup?.now || "";
  }, [groups, mobile, coreMode, selectionGroup]);

  // 全量测速
  const handleTestAll = async () => {
    if (catalogOffline || testingAll || realNodes.length === 0) return;
    setTestingAll(true);
    const job = new AbortController(); pendingJobs.current.add(job);
    const targetNodes = realNodes.map((n) => n.name);
    const concurrency = getStoredConcurrency();
    const testEndpoint = getPreferredSpeedTestUrl() || "https://cp.cloudflare.com/generate_204";

    logInfo(
      "批量测速",
      `启动批量并发测速: 待测节点 ${targetNodes.length} 个 | 并发度: ${concurrency} | 端点: ${testEndpoint}`
    );
    const startBatchTime = performance.now();

    let successCount = 0;
    let timeoutCount = 0;
    let totalDelay = 0;
    let fastestNode = "";
    let fastestDelay = Infinity;
    const batch = createBatchUpdates<{ node: string; testing: boolean; delay?: number | null }>(results => {
      const statuses: Record<string, boolean> = {}, delays: Record<string, number | null> = {};
      for (const result of results) {
        statuses[result.node] = result.testing;
        if (result.delay !== undefined) delays[result.node] = result.delay;
      }
      setTestingNodes(previous => ({ ...previous, ...statuses }));
      if (Object.keys(delays).length) setDelayMap(previous => ({ ...previous, ...delays }));
    });
    pendingBatches.current.add(batch.flush);

    // 分批受控并发测速（使用用户设置的并发度，防止 20000ms 超时）
    const queue = [...targetNodes];
    const runWorker = async () => {
      while (queue.length > 0 && !job.signal.aborted) {
        const node = queue.shift();
        if (!node) break;
        batch.add({ node, testing: true });
        try {
          const delay = await testDelay(node, testEndpoint, 3000);
          if (job.signal.aborted) break;
          batch.add({ node, testing: false, delay: delay ?? 0 });
          if (delay !== null && delay > 0) {
            successCount++;
            totalDelay += delay;
            if (delay < fastestDelay) {
              fastestDelay = delay;
              fastestNode = node;
            }
          } else {
            timeoutCount++;
          }
        } catch {
          if (job.signal.aborted) break;
          batch.add({ node, testing: false, delay: 0 });
          timeoutCount++;
        } finally {
          if (!job.signal.aborted) batch.add({ node, testing: false });
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => runWorker());
    await Promise.all(workers);
    batch.flush();
    pendingBatches.current.delete(batch.flush);
    pendingJobs.current.delete(job);
    setTestingAll(false);

    const costBatchMs = Math.round(performance.now() - startBatchTime);
    const avgDelay = successCount > 0 ? Math.round(totalDelay / successCount) : 0;
    const fastestSummary = fastestNode ? `最快: [${fastestNode}] (${fastestDelay}ms)` : "无可用节点";

    logInfo(
      "批量测速",
      `批量测速${job.signal.aborted ? "已停止" : "全部完成"} [总耗时: ${costBatchMs}ms]: 成功 ${successCount} 个, 超时 ${timeoutCount} 个 | ${fastestSummary} | 平均延迟: ${avgDelay}ms`
    );
  };

  // 单节点测速
  const handleTestNode = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (catalogOffline) { setCatalogMessage(mobile ? "延迟测速需要先连接 VPN；IP 体检可以独立运行。" : "延迟测速需要先启动核心，节点配置可继续管理。"); return; }
    if (testingAll || testingNodes[name]) return;
    const revision = nodeSession.current;
    setTestingNodes((prev) => ({ ...prev, [name]: true }));
    const testEndpoint = getPreferredSpeedTestUrl() || "https://cp.cloudflare.com/generate_204";
    logInfo("节点测速", `发起单节点延迟测速: [${name}] -> 目标: ${testEndpoint}`);
    try {
      const delay = await testDelay(name, testEndpoint, 3000);
      if (revision !== nodeSession.current) return;
      setDelayMap((prev) => ({ ...prev, [name]: delay ?? 0 }));
      if (delay !== null && delay > 0) {
        const quality =
          delay <= 100
            ? "极速 · 极佳"
            : delay <= 200
            ? "平稳 · 良好"
            : delay <= 350
            ? "可用 · 一般"
            : "延迟偏高";
        logInfo("节点测速", `节点 [${name}] 测速完成: ${delay}ms (${quality})`);
      } else {
        logWarn("节点测速", `节点 [${name}] 测速超时或无法连通 (>3000ms)`);
      }
    } catch (err: any) {
      if (revision !== nodeSession.current) return;
      setDelayMap((prev) => ({ ...prev, [name]: 0 }));
      logError("节点测速", `节点 [${name}] 测速异常: ${err?.message || String(err)}`);
    } finally {
      if (revision === nodeSession.current) setTestingNodes((prev) => ({ ...prev, [name]: false }));
    }
  };

  // 单节点深度 IP 体检 (体检完成立即将真实出口国家持久化)
  const handleProbeHealth = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (healthUnavailable) { setProbeMessage("IP 体检需要先启动核心，节点配置可继续管理。"); return; }
    if (probingAll || singleProbeBusy.current) return;
    singleProbeBusy.current = true;
    setProbeMessage("");
    setProbeFailures([]);
    setProbeDetailOpen(false);
    const job = new AbortController(); pendingJobs.current.add(job);
    setProbingNodes((prev) => ({ ...prev, [name]: true }));
    logInfo("IP健康", `发起单节点深度体检: [${name}]`);
    try {
      let resultItem: IpHealthInfo | null = null;
      await probeNodeHealthBatch([name], (_node, res, _completed, _total, error) => {
        if (res) resultItem = { ...res, catalogKey: proxies[name]?.catalogKey };
        else {
          const reason = formatFriendlyProbeError(error);
          setProbeFailures([{ node: nodeLabel(name), reason }]);
          setProbeMessage(`${nodeLabel(name)}：${reason}`);
        }
      }, job.signal);
      if (job.signal.aborted) return;
      if (resultItem) {
        const next = { ...healthCache, [name]: resultItem };
        setHealthCache(next);
        await savePersistedHealthCache(next, true);

        // 核心：一旦获得真实出口 IP，即刻根据权威国家归类并持久化锁定！
        const realRegion = formatCountryRegionTitle(
          (resultItem as IpHealthInfo).countryCode,
          (resultItem as IpHealthInfo).country
        );
        const nextRegions = { ...persistedNodeRegions, [name]: realRegion };
        setPersistedNodeRegions(nextRegions);
        savePersistedNodeRegions(nextRegions);

        const rInfo = resultItem as IpHealthInfo;
        const riskScore = rInfo.fraudScore != null ? `${rInfo.fraudScore}分` : "无评分";
        logInfo(
          "IP健康",
          `节点 [${name}] 深度体检就绪: IP: ${rInfo.ip} (${rInfo.country || "未知"}${rInfo.city ? " · " + rInfo.city : ""}) | 运营商: ${rInfo.asOrganization || rInfo.asn || "未知"} | 风控分: ${riskScore} | 类型: ${rInfo.isResidential == null ? "未知" : rInfo.isResidential ? "原生住宅" : "数据中心"}`
        );
      } else {
        logWarn("IP健康", `节点 [${name}] 深度体检未能解析到出口画像数据`);
      }
    } catch (err: any) {
      setProbeMessage(`体检失败：${formatFriendlyProbeError(err?.message || String(err))}`);
      console.error("单节点体检失败:", err);
      logError("IP健康", `节点 [${name}] 深度体检失败: ${err?.message || String(err)}`);
    } finally {
      pendingJobs.current.delete(job);
      singleProbeBusy.current = false;
      setProbingNodes((prev) => ({ ...prev, [name]: false }));
    }
  };

  // 全量 IP 纯净体检与真实地区重排
  const handleProbeAllHealth = async (requestedNames?: string[]) => {
    if (healthUnavailable) { setProbeMessage("IP 体检需要先启动核心，节点配置可继续管理。"); return; }
    const targetNames = realNodes.filter(n => !ignoredSet.has(n.name) && (!requestedNames || requestedNames.includes(n.name))).map(n => n.name);
    if (targetNames.length === 0 || probingAll || singleProbeBusy.current) return;

    setProbingAll(true);
    setProbeMessage("");
    setProbeFailures([]);
    setProbeDetailOpen(false);
    const job = new AbortController(); pendingJobs.current.add(job);
    setProbeProgress({ completed: 0, total: targetNames.length });
    const failures: Array<{ node: string; reason: string }> = [];

    const probeConcurrency = getStoredHealthProbeConcurrency();
    logInfo(
      "IP健康",
      `启动全量节点深度 IP 体检: 共 ${targetNames.length} 个节点，受控分批执行中 (当前并发度: ${probeConcurrency})...`
    );
    const startAllTime = performance.now();
    let successCount = 0;

    const currentCache = { ...healthCache };
    const currentRegions = { ...persistedNodeRegions };
    const batch = createBatchUpdates<{ node: string; result: IpHealthInfo | null; completed: number; total: number }>(results => {
      let changed = false;
      for (const { node, result } of results) if (result) {
        currentCache[node] = result;
        currentRegions[node] = formatCountryRegionTitle(result.countryCode, result.country);
        changed = true;
      }
      const last = results[results.length - 1];
      setProbeProgress({ completed: last.completed, total: last.total });
      if (changed) {
        const cache = { ...currentCache }, regions = { ...currentRegions };
        setHealthCache(cache); setPersistedNodeRegions(regions);
        void savePersistedHealthCache(cache);
        savePersistedNodeRegions(regions);
      }
    });
    pendingBatches.current.add(batch.flush);

    try {
      await probeNodeHealthBatch(targetNames, (node, result, completed, total, error) => {
        if (result) result = { ...result, catalogKey: proxies[node]?.catalogKey };
        else if (failures.length < 12) failures.push({ node: nodeLabel(node), reason: formatFriendlyProbeError(error) });
        if (result) successCount++;
        batch.add({ node, result, completed, total });
      }, job.signal);
      const costMs = Math.round(performance.now() - startAllTime);
      const failCount = targetNames.length - successCount;
      setProbeFailures(failures);
      setProbeMessage(
        job.signal.aborted
          ? "体检已取消"
          : failCount > 0
            ? `体检完成：成功 ${successCount} · 失败 ${failCount}`
            : `体检完成：全部 ${successCount} 个节点正常`
      );
      logInfo(
        "IP健康",
        `全量节点深度体检${job.signal.aborted ? "已停止" : "完成"} [总耗时: ${costMs}ms]: 成功获取画像 ${successCount}/${targetNames.length} 个节点`
      );
    } catch (err: any) {
      console.error("全量 IP 健康体检出错:", err);
      setProbeMessage(`体检未完成：${formatFriendlyProbeError(err?.message || String(err))}`);
      logError("IP健康", `全量 IP 健康体检异常中断: ${err?.message || String(err)}`);
    } finally {
      batch.flush();
      pendingBatches.current.delete(batch.flush);
      pendingJobs.current.delete(job);
      try { if (!job.signal.aborted) await savePersistedHealthCache({ ...currentCache }, true); }
      catch (error) { logError("IP健康", `保存体检结果失败：${String(error)}`); }
      if (!job.signal.aborted) savePersistedNodeRegions({ ...currentRegions }, true);
      setProbingAll(false);
      setProbeProgress(null);
    }
  };

  // Android 只切换当前模式下明确选择的策略组，保留应用独立出口。
  const handleSelectProxy = async (nodeName: string) => {
    if (catalogOffline) { setCatalogMessage(mobile ? "节点已保存，请先连接 VPN 再切换当前出口。" : "节点已保存，请先启动核心再切换当前出口。"); return; }
    if (mobile) {
      if (switchingNode.current) return;
      switchingNode.current = true;
      setSwitchingNodeName(nodeName);
      try {
        const [config, catalog] = await Promise.all([fetchMihomoConfig(), fetchProxies()]);
        const group = mobileSelectionGroup(catalog.groups, config?.mode as MobileCoreMode, selectionGroup);
        if (!group) {
          setMobileToolsOpen(true);
          throw new Error(config?.mode === "direct" ? "直连模式无需切换节点，请先切换为规则或全局模式。" : "请选择要切换的策略组，然后重试。");
        }
        if (!group.all?.includes(nodeName)) {
          setMobileToolsOpen(true);
          throw new Error(`策略组 ${group.name} 不包含此节点，请选择对应策略组。`);
        }
        if (!await switchProxy(group.name, nodeName)) throw new Error("核心未接受节点切换，请重试。");
        setCatalogMessage("");
        window.dispatchEvent(new CustomEvent("netbox-active-node-changed", { detail: { nodeName } }));
        window.dispatchEvent(new Event("netbox-route-changed"));
        await loadData();
      } catch (error) { setCatalogMessage(String(error)); }
      finally {
        switchingNode.current = false;
        setSwitchingNodeName(null);
      }
      return;
    }
    if (switchingNode.current) return;
    switchingNode.current = true;
    setSwitchingNodeName(nodeName);
    try {
      const res = await switchPublicNode(nodeName);
      if (!res.success) {
        alert(`切换公共出口失败：${res.message || "核心拒绝切换"}`);
        return;
      }

      try {
        localStorage.setItem("netbox_active_node_name", nodeName);
      } catch {}

      await loadData();
    } catch (err: any) {
      console.error("切换公共出口失败:", err);
      alert(`切换公共出口异常: ${err?.message || err}`);
    } finally {
      switchingNode.current = false;
      setSwitchingNodeName(null);
    }
  };

  // 节点多选操作
  const toggleSelectNode = (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedNodes((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  // 辅助同步到内核
  const syncRules = async (rules: SmartGroupRule[]) => {
    const specs = rules.map((r) => {
      let candidateNodes: string[] = [];
      if (r.type === "relay") {
        const entry = r.relayEntry?.trim();
        const exit = r.relayExit?.trim();
        candidateNodes = [entry, exit].filter((p): p is string => !!p && p !== "GLOBAL");
      } else if (r.nodeSelectionMode === "manual" && r.manualNodes && r.manualNodes.length > 0) {
        candidateNodes = r.manualNodes.filter((n) => realNodeNames.includes(n));
      } else {
        // 自动圈选模式：实时执行智能匹配与特征排序
        candidateNodes = filterAndSortProxies(realNodeNames, r, healthCache, delayMap);
      }

      // 如果有真实候选节点，使用真实候选节点；若极端情况下为空，使用兜底项，杜绝空组或无效伪组
      const finalProxies =
        candidateNodes.length > 0
          ? candidateNodes
          : r.fallbackChain && r.fallbackChain.length > 0
          ? r.fallbackChain
          : [r.fallbackProxy || "DIRECT"];

      return {
        name: r.name,
        type: r.type,
        proxies: finalProxies,
        tolerance: r.tolerance,
      };
    });
    await syncSmartGroupsToCore(specs, undefined, rules);
  };

  // 打包为优选组或中继
  const handleConfirmPack = async () => {
    if (packPending.current || !packModalType) return;
    setPackError("");
    if (!packName.trim()) { setPackError("请输入新线路名称。"); return; }
    if (selectedNodes.length < 2) { setPackError("请至少选择两个节点。"); return; }
    if (packModalType === "relay" && selectedNodes.length !== 2) { setPackError("链式中继需要正好两个节点。"); return; }
    if (["DIRECT", "REJECT", "GLOBAL", "RULES", "PROXY"].includes(packName.trim()) || groups.some(g => g.name === packName.trim()) || realNodeNames.includes(packName.trim()) || smartRules.some(r => r.name === packName.trim())) {
      setPackError("此名称已被节点、策略组或系统占用，请更换名称。"); return;
    }
    packPending.current = true; setPackSaving(true);
    try {
      const newRule: SmartGroupRule = {
        id: `sg-${Date.now()}`,
        name: packName.trim(),
        type: packModalType === "relay" ? "relay" : "url-test",
        tolerance: 80,
        nodeSelectionMode: "manual",
        manualNodes: selectedNodes,
        relayEntry: packModalType === "relay" ? selectedNodes[0] : undefined,
        relayExit: packModalType === "relay" ? selectedNodes[1] : undefined,
        excludeOffline: true,
        sortByLatency: true,
        fallbackProxy: "DIRECT",
      };

      const updated = [...smartRules, newRule];
      await syncRules(updated);
      setSmartRules(updated);
      setSelectedNodes([]);
      setMobileSelecting(false);
      setPackModalType(null);
      setPackName("");
      loadData();
    } catch (err) {
      setPackError(`创建线路失败：${String(err)}`);
    } finally {
      packPending.current = false; setPackSaving(false);
    }
  };

  // 删除自建线路
  const handleDeleteSmartRule = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = smartRules.filter((r) => r.id !== id);
    await syncRules(updated);
    setSmartRules(updated);
  };

  const runSubscriptionAction = async (action: () => Promise<void>, adding = false) => {
    if (subPending.current) return;
    subPending.current = true;
    ++profileReadVersion.current;
    setSubLoading(true);
    setSubError("");
    setAddSubError("");
    setSubNotice("");
    try {
      await action();
    } catch (error) {
      const message = typeof error === "string" ? error : error instanceof Error ? error.message : "订阅操作失败，请重试";
      (adding ? setAddSubError : setSubError)(message);
    } finally {
      subPending.current = false;
      setSubLoading(false);
      setSwitchingProfileId(null);
    }
  };

  const refreshSubscriptions = async (message: string) => {
    setSubNotice(message);
    window.dispatchEvent(new CustomEvent("procweaver-profile-changed"));
    window.dispatchEvent(new CustomEvent("netbox-profile-changed"));
    try { setProfiles(await getProfiles()); }
    catch { setSubError(`${message}，但订阅列表刷新失败，请重新打开订阅管理。`); }
  };

  // 添加订阅：失败保留表单，成功返回抽屉。
  const handleAddSubscription = async () => {
    if (!newSubUrl.trim()) return;
    await runSubscriptionAction(async () => {
      await addProfile(
        newSubName.trim() || `订阅源 #${profiles.length + 1}`,
        newSubUrl.trim()
      );
      setNewSubUrl("");
      setNewSubName("");
      await refreshSubscriptions("订阅已添加，点击订阅卡片即可使用。");
      setShowAddSubModal(false);
    }, true);
  };

  // 更新订阅
  const handleUpdateSubscription = async (id: string) => {
    await runSubscriptionAction(async () => {
      await updateProfile(id);
      await refreshSubscriptions("订阅已更新。");
    });
  };

  const handleSelectSubscription = async (id: string) => {
    if (profiles.find(profile => profile.id === id)?.isSelected) return;
    await runSubscriptionAction(async () => {
      setSwitchingProfileId(id);
      if (!await profileSwitch.requestSwitch(id)) return;
      // The backend has applied the configuration; never switch this marker optimistically.
      setProfiles(current => current.map(profile => ({ ...profile, isSelected: profile.id === id })));
      setSelectedNodes([]);
      setDelayMap({});
      await refreshSubscriptions("已切换订阅；核心运行时立即应用，未运行时将在启动后使用。已有连接沿用原出口。");
    });
  };

  const handleDeleteSubscription = async (id: string) => {
    if (subPending.current || !window.confirm("确定要删除此订阅配置吗？")) return;
    await runSubscriptionAction(async () => {
      await deleteProfile(id);
      await refreshSubscriptions("订阅已删除。");
    });
  };

  // 节点过滤与排序
  const filteredNodes = useMemo(() => {
    return realNodes
      .filter((n) => {
        const local = localByAlias.get(n.name);
        if (sourceFilter === "local" && !local || sourceFilter === "subscription" && local) return false;
        // 排除用户主动忽略的节点
        if (ignoredSet.has(n.name)) {
          return false;
        }
        const region = persistedNodeRegions[n.name];
        const health = healthCache[n.name];
        const country = health?.countryCode ? formatCountryRegionTitle(health.countryCode, health.country) : "";
        if (search && !`${local?.name || n.name} ${n.type} ${region || ""} ${health?.country || ""} ${health?.countryCode || ""} ${country}`.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        const delay = delayMap[n.name] ?? n.history?.[n.history.length - 1]?.delay ?? null;
        // 仅当明确测速过且失败超时（<= 0）时才隐藏；未测速（delay === null）绝不隐藏
        if (hideTimeout && delay !== null && delay <= 0) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const delayA = delayMap[a.name] ?? a.history?.[a.history.length - 1]?.delay ?? 999999;
        const delayB = delayMap[b.name] ?? b.history?.[b.history.length - 1]?.delay ?? 999999;
        if (sortBy === "latency-asc") return delayA - delayB;
        if (sortBy === "name-asc") return a.name.localeCompare(b.name);
        return 0;
      });
  }, [realNodes, search, hideTimeout, sortBy, delayMap, ignoredSet, sourceFilter, localByAlias, persistedNodeRegions, healthCache]);

  // 按地区自动归类：优先使用基于真实 IP 体检的持久化结果，未体检的归入待确认真实出口
  const { regionGroups, unprobedCount } = useMemo(() => {
    const map: Record<string, ProxyItem[]> = {};
    let unprobed = 0;

    filteredNodes.forEach((node) => {
      // 1. 优先读取持久化归属（来自以往 IP 体检），等待再次体检前绝不变更！
      const persisted = persistedNodeRegions[node.name];
      if (persisted) {
        if (!map[persisted]) map[persisted] = [];
        map[persisted].push(node);
        return;
      }

      // 2. 检查当前内存/磁盘体检缓存是否有真实国家
      const health = healthCache[node.name];
      if (health && health.countryCode) {
        const title = formatCountryRegionTitle(health.countryCode, health.country);
        if (!map[title]) map[title] = [];
        map[title].push(node);
        return;
      }

      // 3. 首次未体检（无 IP 结果）：统一归入待体检确认真实出口分组
      unprobed++;
      const pendingKey = "⏳ 待确认真实出口";
      if (!map[pendingKey]) map[pendingKey] = [];
      map[pendingKey].push(node);
    });

    const entries = Object.entries(map);
    // 排序：先展示待确认组（如果有的话），接着按国家规范展示
    entries.sort(([a], [b]) => {
      if (a.startsWith("⏳")) return -1;
      if (b.startsWith("⏳")) return 1;
      return a.localeCompare(b, "zh-CN");
    });

    return { regionGroups: entries, unprobedCount: unprobed };
  }, [filteredNodes, persistedNodeRegions, healthCache]);

  // 自动将二级真实国家/地区节点及实时延迟同步至系统托盘二级菜单
  useEffect(() => {
    if (!mobile && realNodes.length > 0) {
      const rawNodes: RawNodeForTray[] = realNodes.map((n) => {
        const persisted = persistedNodeRegions[n.name];
        const health = healthCache[n.name];
        return {
          name: n.name,
          type: n.type,
          delay: delayMap[n.name] ?? n.history?.[n.history.length - 1]?.delay ?? null,
          countryCode: health?.countryCode,
          country: persisted || health?.country,
        };
      });

      const groups = buildCategorizedTrayGroups(rawNodes, activeNodeName);
      if (groups.length > 0) {
        setGlobalTrayGroups(groups);
      }
    }
  }, [realNodes, delayMap, activeNodeName, persistedNodeRegions, healthCache]);

  // 监听系统托盘“👉 查看全部该地区节点...”菜单事件，自动定位并过滤该地区
  useEffect(() => {
    if (mobile) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string>("procweaver-filter-region", (event) => {
        const raw = event.payload || "";
        const cleanKeyword = raw.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "").replace(/中国/g, "").trim() || raw;
        setSearchKeyword(cleanKeyword);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 体检结果胶囊提示自动收起（展开详情或正在体检时不自动消失）
  useEffect(() => {
    if (!probeMessage || probingAll || anySingleProbe || probeDetailOpen) return;
    const timer = window.setTimeout(() => {
      setProbeMessage("");
      setProbeFailures([]);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [probeMessage, probingAll, anySingleProbe, probeDetailOpen]);

  return (
    <div className={`${mobile ? "mobile-nodes-page " : ""}flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-[#0a0c10] transition-colors duration-200 relative`}>
      {(catalogMessage || (!mobile && catalogOffline)) && <div role="status" className="mobile-notice mx-3 my-2 shrink-0">
        {!mobile && catalogOffline && <p>当前为本地配置管理，可管理订阅、本地节点和自建线路，保存后在下次启动核心时使用。切换出口、测速和 IP 体检需启动核心。</p>}
        {catalogMessage && <p>{catalogMessage} <button onClick={() => void loadData()}>重新读取</button></p>}
      </div>}
      {((probeMessage && (!mobile || (!probingAll && !anySingleProbe))) || (!mobile && (probingAll || anySingleProbe))) && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col-reverse items-center max-w-[92vw] animate-in fade-in slide-in-from-bottom-3 duration-200" data-no-drag>
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#121316]/95 dark:bg-[#121316]/95 text-zinc-100 text-xs font-medium shadow-[0_20px_40px_-15px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.08)] border hairline-divider backdrop-blur-2xl">
            {(probingAll || anySingleProbe) ? (
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping shrink-0" />
            ) : probeFailures.length > 0 || /失败|未完成|取消|需要先启动/.test(probeMessage) ? (
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            )}
            <span className="truncate max-w-[60vw] font-mono">
              {probeMessage || (probeProgress ? `正在体检 (${probeProgress.completed}/${probeProgress.total})…` : "正在检测节点 IP 画像…")}
            </span>
            {!probingAll && !anySingleProbe && probeFailures.length > 1 && (
              <button
                type="button"
                onClick={() => setProbeDetailOpen(prev => !prev)}
                className="px-2 py-0.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/30 text-[11px] font-semibold transition shrink-0"
              >
                {probeDetailOpen ? "收起详情" : `查看失败 (${probeFailures.length})`}
              </button>
            )}
            {!mobile && (probingAll || anySingleProbe) && (
              <button
                type="button"
                onClick={() => { pendingJobs.current.forEach(job => job.abort()); setProbeMessage("正在取消体检…"); }}
                className="px-2 py-0.5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-400/30 text-[11px] font-semibold transition shrink-0 cursor-pointer"
              >
                取消检测
              </button>
            )}
            {!probingAll && !anySingleProbe && (
              <button
                type="button"
                aria-label="关闭体检提示"
                onClick={() => { setProbeMessage(""); setProbeFailures([]); setProbeDetailOpen(false); }}
                className="ml-0.5 w-4 h-4 rounded-full inline-flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition shrink-0 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
          {probeDetailOpen && probeFailures.length > 0 && (
            <div className="mb-2 w-[380px] max-w-[90vw] rounded-2xl bg-[#121316]/95 text-zinc-200 border hairline-divider shadow-2xl backdrop-blur-2xl p-3.5 text-xs animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 mb-2 border-b hairline-divider">
                <span className="font-semibold text-amber-300">失败节点摘要（可单独点击节点重试）</span>
                <button
                  type="button"
                  onClick={() => setProbeDetailOpen(false)}
                  className="text-zinc-400 hover:text-white text-[11px]"
                >
                  收起
                </button>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 font-mono">
                {probeFailures.map((item, idx) => (
                  <div key={`${item.node}-${idx}`} className="flex items-center justify-between gap-2 py-1 px-2 rounded-lg bg-white/[0.03] border hairline-divider">
                    <span className="truncate text-zinc-200 font-medium">{item.node}</span>
                    <span className="shrink-0 text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">{item.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* 顶栏控制台 */}
      {mobile ? (
        <div className="mobile-node-toolbar px-3 py-2 border-b border-slate-200/90 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/60 backdrop-blur-md flex flex-col gap-2 shrink-0">
          {/* 第一行：搜索 + 排除超时 + 排序 */}
          <div className="flex items-center gap-2 w-full">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="搜索节点"
                placeholder="搜索节点、地区、协议..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="w-full pl-9 pr-9 py-2 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-xl focus:outline-hidden focus:border-indigo-500 transition"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword("")}
                  aria-label="清空搜索"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 w-8 h-8 flex items-center justify-center cursor-pointer active:scale-90 transition-transform"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                const next = !hideTimeout;
                setHideTimeout(next);
                try {
                  localStorage.setItem("netbox_hide_timeout_nodes", String(next));
                } catch {}
              }}
              className={`h-9 px-3 text-xs rounded-xl border font-medium transition cursor-pointer shrink-0 active:scale-95 ${
                hideTimeout
                  ? "bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-600/15 dark:text-indigo-400 dark:border-indigo-500/30"
                  : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
              }`}
              title="过滤测速超时的无效节点"
            >
              排除超时
            </button>

            <select
              aria-label="节点排序"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-9 px-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0 font-medium cursor-pointer"
            >
              <option value="default">默认</option>
              <option value="latency-asc">延迟优先</option>
              <option value="name-asc">名称排序</option>
            </select>
          </div>

          {/* 数量与操作在窄屏下自动分行，避免状态被按钮覆盖。 */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs pt-1 border-t border-slate-100 dark:border-slate-800/60 text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5 min-w-[130px] flex-1 truncate">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {filteredNodes.length < realNodes.length ? `${filteredNodes.length}/${realNodes.length}` : `${filteredNodes.length}`} 个节点
              </span>
              <span>·</span>
              <span className="truncate text-[11px]" title={activeNodeName ? nodeLabel(activeNodeName) : "未连接"}>
                {catalogOffline ? "离线模式" : activeNodeName ? `出口: ${nodeLabel(activeNodeName)}` : "未连接"}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              {unprobedCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleProbeAllHealth(filteredNodes.filter(n => !persistedNodeRegions[n.name] && !healthCache[n.name]?.countryCode).map(n => n.name))}
                  disabled={probingAll || anySingleProbe}
                  className="h-7 px-2.5 text-xs text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1 rounded-lg border border-purple-200/80 dark:border-purple-800/60 bg-purple-50/50 dark:bg-purple-950/30 active:scale-95 transition-transform cursor-pointer"
                  title="一键体检待确认真实出口的节点"
                >
                  <Shield size={12} className={probingAll ? "animate-spin" : ""} />
                  <span>{probingAll ? "体检中" : `${unprobedCount} 待检`}</span>
                </button>
              )}
              <button
                type="button"
                aria-pressed={mobileSelecting}
                onClick={() => { setMobileSelecting(prev => !prev); setSelectedNodes([]); }}
                className={`h-7 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 active:scale-95 transition-transform cursor-pointer ${mobileSelecting ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-700 dark:text-indigo-300 shadow-xs" : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"}`}
              >
                {mobileSelecting ? "完成" : "多选"}
              </button>
              <button
                type="button"
                onClick={() => setMobileToolsOpen(prev => !prev)}
                className={`h-7 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer ${
                  mobileToolsOpen
                    ? "bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400"
                    : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {mobileToolsOpen ? "收起工具" : "高级工具"}
              </button>
              <button
                type="button"
                onClick={openSubscriptions}
                className="h-7 px-2.5 rounded-lg border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/60 dark:bg-indigo-950/40 text-xs text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1 active:scale-95 transition-transform cursor-pointer"
              >
                <Radio size={12} />
                <span>订阅</span>
              </button>
            </div>
          </div>

          {(probingAll || anySingleProbe) && (
            <div role="status" className="flex items-center gap-2 text-[11px] text-purple-700 dark:text-purple-300">
              <Shield size={13} className="animate-spin shrink-0" />
              <span className="truncate flex-1">IP 体检中{probeProgress ? ` ${probeProgress.completed}/${probeProgress.total}` : "…"}</span>
              <button type="button" onClick={() => { pendingJobs.current.forEach(job => job.abort()); setProbeMessage("正在取消体检…"); }} className="font-semibold">取消</button>
            </div>
          )}

          {coreMode === "rule" && groups.some(g => /^(selector|select)$/i.test(g.type)) && !mobileSelectionGroup(groups, coreMode, selectionGroup) && (
            <label className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <span className="shrink-0">切换策略组</span>
              <select aria-label="切换策略组" value={selectionGroup} onChange={event => setSelectionGroup(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2 py-1">
                <option value="">请选择</option>
                {groups.filter(g => g.name !== "GLOBAL" && /^(selector|select)$/i.test(g.type)).map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </label>
          )}

          {/* 高级工具面板（展开时展示） */}
          {mobileToolsOpen && (
            <div className="pt-2 pb-1 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2">
              {coreMode === "rule" && (
                <label className="flex items-center gap-1.5 w-full min-w-0 text-xs text-slate-600 dark:text-slate-300">
                  <span className="shrink-0 font-medium">策略组:</span>
                  <select
                    aria-label="切换策略组"
                    value={mobileSelectionGroup(groups, coreMode, selectionGroup)?.name ?? ""}
                    onChange={event => setSelectionGroup(event.target.value)}
                    className="min-w-0 flex-1 px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
                  >
                    <option value="" disabled>请选择策略组</option>
                    {groups.filter(g => g.name !== "GLOBAL" && /^(selector|select)$/i.test(g.type)).map(g => (
                      <option key={g.name} value={g.name}>{g.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="节点来源"
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 font-medium cursor-pointer"
                >
                  <option value="all">全部来源</option>
                  <option value="subscription">订阅节点</option>
                  <option value="local">本地节点</option>
                </select>
                <button
                  type="button"
                  onClick={handleTestAll}
                  disabled={testingAll || realNodes.length === 0 || catalogOffline}
                  className="w-full flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-semibold disabled:opacity-50 active:scale-95 transition-transform cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingAll ? "animate-spin text-indigo-500" : ""}`} />
                  <span>{testingAll ? "测速中…" : "全量测速"}</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={localNodes.busy || !localNodes.view}
                  onClick={localNodes.openNew}
                  className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 text-xs font-semibold disabled:opacity-50 active:scale-95 transition-transform cursor-pointer"
                >
                  <Plus size={13} />
                  <span>新增节点</span>
                </button>
                <button
                  type="button"
                  disabled={localNodes.busy || !localNodes.view}
                  onClick={localNodes.openImport}
                  className="flex items-center justify-center px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-50 active:scale-95 transition-transform cursor-pointer"
                >
                  导入节点
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleProbeAllHealth()}
                  disabled={probingAll || anySingleProbe || realNodes.length === 0}
                  className="flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-xl bg-purple-50 text-purple-700 dark:bg-purple-600/15 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 text-xs font-semibold disabled:opacity-50 active:scale-95 transition-transform cursor-pointer"
                >
                  <Shield className={`w-3.5 h-3.5 ${probingAll ? "animate-spin text-purple-600 dark:text-purple-400" : "text-purple-500"}`} />
                  <span>{probingAll ? `体检 ${probeProgress?.completed || 0}/${probeProgress?.total || realNodes.length}` : "全量 IP 体检"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("netbox-navigate-tab", { detail: "logs" }));
                  }}
                  className="flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs font-semibold active:scale-95 transition-transform cursor-pointer"
                >
                  <ScrollText size={13} />
                  <span>查看日志</span>
                </button>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  smartTrigger.current = event.currentTarget;
                  setEditingRule(null);
                  setSmartModalOpen(true);
                }}
                className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold active:scale-[0.98] transition-transform cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建自建线路</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-2.5 border-b border-slate-200/80 dark:border-white/[0.06] bg-white/80 dark:bg-[#0a0c10]/90 backdrop-blur-2xl flex items-center justify-between gap-3 shrink-0 relative z-30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
          {/* 左侧：一体化控制台容器 (Linear Obsidian 风格：黑曜石深色内凹下沉底座，极简 2~3 项，绝无叠字重叠) */}
          <div className="flex items-center min-w-0 flex-1">
            <div className="flex items-center rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-100/80 dark:bg-black/45 p-0.5 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3),0_1px_0_0_rgba(255,255,255,0.03)] min-w-0">
              {/* 1. 策略组选择 (冷灰静音指南针) */}
              {groups.some(g => g.name !== "GLOBAL" && /^(selector|select)$/i.test(g.type)) && (
                <>
                  <button
                    ref={groupBtnRef}
                    type="button"
                    onClick={(e) => toggleFilterDropdown("group", e.currentTarget)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-slate-800 dark:text-zinc-200 transition cursor-pointer select-none shrink-0 ${
                      activeFilterDropdown === "group"
                        ? "bg-slate-200/90 dark:bg-white/10 text-slate-950 dark:text-white"
                        : "hover:bg-slate-200/50 dark:hover:bg-white/[0.06]"
                    }`}
                    title="切换当前聚焦的策略组"
                  >
                    <Compass className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate max-w-[100px] font-sans">
                      {selectionGroup || (groups.find(g => g.name !== "GLOBAL" && /^(selector|select)$/i.test(g.type))?.name ?? "PROXY")}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-slate-400 dark:text-zinc-500 transition-transform duration-200 ${activeFilterDropdown === "group" ? "rotate-180" : ""}`} />
                  </button>
                  <div className="h-3.5 w-px bg-slate-200 dark:bg-white/[0.08] shrink-0 mx-0.5" />
                </>
              )}

              {/* 2. 搜索框 (自适应弹性伸缩，绝不挤压右侧) */}
              <div className="relative flex items-center min-w-[90px] max-w-[160px] px-2 py-0.5">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 shrink-0 mr-1.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  aria-label="搜索节点"
                  placeholder="搜索节点..."
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className="w-full bg-transparent border-0 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-hidden"
                />
                <div className="flex items-center gap-1 shrink-0 ml-1">
                  {searchKeyword ? (
                    <button
                      type="button"
                      onClick={() => setSearchKeyword("")}
                      aria-label="清空搜索"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : (
                    <kbd className="hidden sm:inline-flex px-1.5 py-0.2 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 bg-black/5 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 rounded">
                      /
                    </kbd>
                  )}
                </div>
              </div>

              <div className="h-3.5 w-px bg-slate-200 dark:bg-white/[0.08] shrink-0 mx-0.5" />

              {/* 3. 🎛️ 筛选与排序 (彻底合并排序+来源+超时，左侧宽度骤减，杜绝与右侧测速相撞) */}
              <button
                ref={filterBtnRef}
                type="button"
                onClick={(e) => toggleFilterDropdown("filter", e.currentTarget)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-slate-800 dark:text-zinc-200 transition cursor-pointer select-none shrink-0 ${
                  activeFilterCount > 0
                    ? "bg-slate-200 dark:bg-white/10 text-slate-950 dark:text-white font-medium shadow-2xs border border-slate-300 dark:border-white/10"
                    : activeFilterDropdown === "filter"
                    ? "bg-slate-200/90 dark:bg-white/10 text-slate-950 dark:text-white"
                    : "hover:bg-slate-200/50 dark:hover:bg-white/[0.06]"
                }`}
                title="节点来源过滤、测速超时排除与排序选项"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>
                  {sortBy === "latency-asc"
                    ? "延迟优先"
                    : sortBy === "name-asc"
                    ? "名称排序"
                    : sourceFilter === "subscription"
                    ? "仅订阅"
                    : sourceFilter === "local"
                    ? "仅自建"
                    : "筛选与排序"}
                </span>
                {hideTimeout && (
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" title="已过滤测速超时节点" />
                )}
                <ChevronDown className={`w-3 h-3 text-slate-400 dark:text-zinc-500 transition-transform duration-200 ${activeFilterDropdown === "filter" ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>

          {/* 统一过滤器下拉菜单 (Portal 挂载到 body，深空黑曜石背景与冷白微光) */}
          {activeFilterDropdown &&
            createPortal(
              <div
                ref={filterDropdownRef}
                style={{ top: `${filterDropdownPos.top}px`, left: `${filterDropdownPos.left}px` }}
                className="fixed z-[9999] bg-white/95 dark:bg-[#0d1015]/95 backdrop-blur-2xl border border-slate-200/80 dark:border-white/[0.08] rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)] p-1.5 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100 font-sans select-none"
                data-no-drag
              >
                {activeFilterDropdown === "group" && (
                  <div className="w-52">
                    <div className="px-2.5 py-1.5 text-[10px] text-zinc-400 font-mono font-semibold uppercase tracking-wider border-b border-slate-200/60 dark:border-white/[0.06]">
                      策略组 (Policy Group)
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-0.5 py-1">
                      {groups.filter(g => g.name !== "GLOBAL" && /^(selector|select)$/i.test(g.type)).map(g => {
                        const isCurrent = (selectionGroup === g.name || (!selectionGroup && g.name === groups.find(x => x.name !== "GLOBAL" && /^(selector|select)$/i.test(x.type))?.name));
                        return (
                          <button
                            key={g.name}
                            type="button"
                            onClick={() => {
                              setSelectionGroup(g.name);
                              setActiveFilterDropdown(null);
                            }}
                            className={`w-full px-2.5 py-1.5 text-left rounded-lg transition flex items-center justify-between cursor-pointer ${
                              isCurrent
                                ? "bg-white/10 text-white font-semibold"
                                : "hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-zinc-300"
                            }`}
                          >
                            <span className="truncate flex-1">{g.name}</span>
                            <span className="text-[10px] font-mono opacity-50 shrink-0 ml-1.5">{g.all.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeFilterDropdown === "filter" && (
                  <div className="w-52 space-y-2 p-1">
                    {/* 排序模块 */}
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-zinc-400 font-mono font-semibold uppercase tracking-wider border-b border-slate-200/60 dark:border-white/[0.06] mb-1">
                        <ArrowDownUp className="w-3 h-3 text-zinc-400" />
                        <span>排序方式 (Sort By)</span>
                      </div>
                      <div className="space-y-0.5">
                        {[
                          { value: "default", label: "默认排序" },
                          { value: "latency-asc", label: "延迟优先" },
                          { value: "name-asc", label: "名称排序" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setSortBy(opt.value as any);
                              setActiveFilterDropdown(null);
                            }}
                            className={`w-full px-2.5 py-1.5 text-left rounded-lg transition flex items-center justify-between cursor-pointer ${
                              sortBy === opt.value
                                ? "bg-white/10 text-white font-semibold"
                                : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
                            }`}
                          >
                            <span>{opt.label}</span>
                            {sortBy === opt.value && <Check className="w-3 h-3 text-zinc-200" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 来源模块 */}
                    <div>
                      <div className="px-2 py-1 text-[10px] text-zinc-400 font-mono font-semibold uppercase tracking-wider border-b border-slate-200/60 dark:border-white/[0.06] mb-1">
                        节点来源 (Source)
                      </div>
                      <div className="space-y-0.5">
                        {[
                          { value: "all", label: "全部来源" },
                          { value: "subscription", label: "仅订阅节点" },
                          { value: "local", label: "仅本地自建" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setSourceFilter(opt.value);
                              setActiveFilterDropdown(null);
                            }}
                            className={`w-full px-2.5 py-1.5 text-left rounded-lg transition flex items-center justify-between cursor-pointer ${
                              sourceFilter === opt.value
                                ? "bg-white/10 text-white font-semibold"
                                : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
                            }`}
                          >
                            <span>{opt.label}</span>
                            {sourceFilter === opt.value && <Check className="w-3 h-3 text-zinc-200" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 选项模块 */}
                    <div className="pt-1.5 border-t border-slate-200/60 dark:border-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !hideTimeout;
                          setHideTimeout(next);
                          try {
                            localStorage.setItem("netbox_hide_timeout_nodes", String(next));
                          } catch {}
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg transition flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-white/[0.06] text-left select-none text-xs"
                      >
                        <span className="text-slate-800 dark:text-zinc-200">隐藏测速超时节点</span>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                          hideTimeout
                            ? "bg-sky-500 border-sky-400 text-white"
                            : "border-slate-300 dark:border-zinc-600 bg-transparent"
                        }`}>
                          {hideTimeout && <Check className="w-3 h-3 stroke-[3]" />}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>,
              document.body
            )}

          {/* 右侧：诊断运维 + 视图切换 + 订阅入口 + 聚合添加菜单 */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* 诊断运维微按钮组 (冷灰单色系统) */}
            <div className="flex items-center p-0.5 rounded-xl bg-slate-100/80 dark:bg-black/45 border border-slate-200/80 dark:border-white/[0.08] shrink-0 gap-0.5 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.2)]">
              <button
                type="button"
                onClick={handleTestAll}
                disabled={testingAll || realNodes.length === 0 || catalogOffline}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
                title="全量节点往返握手延迟测速"
              >
                <RefreshCw className={`w-3 h-3 ${testingAll ? "animate-spin text-sky-400" : "text-zinc-400"}`} />
                <span>{testingAll ? "测速中" : "测速"}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleProbeAllHealth()}
                disabled={healthUnavailable || probingAll || anySingleProbe || realNodes.length === 0}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
                title={healthUnavailable ? "启动核心后可进行 IP 体检" : "深度体检全部节点的真实出口 IP、风控评分与属性"}
              >
                <Shield className={`w-3 h-3 ${probingAll ? "animate-spin text-purple-400" : "text-zinc-400"}`} />
                <span>{probingAll ? `${probeProgress?.completed || 0}/${probeProgress?.total || realNodes.length}` : "体检"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("netbox-navigate-tab", { detail: "logs" })
                  );
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition cursor-pointer"
                title="查看测速、IP 体检与网络运行日志"
              >
                <ScrollText className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>

            {/* 分隔线 */}
            <div className="h-4 w-px bg-slate-200 dark:bg-white/[0.08] mx-0.5 hidden sm:block" />

            {/* 视图切换：高密度紧凑表格 Table ⇋ 自适应微卡 Grid */}
            <div className="flex items-center p-0.5 rounded-xl bg-slate-100/80 dark:bg-black/45 border border-slate-200/80 dark:border-white/[0.08] shrink-0">
              <button
                type="button"
                onClick={() => handleToggleViewMode("table")}
                title="高密度紧凑数据表格 (方案 A)"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  viewMode === "table"
                    ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-bold"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleViewMode("grid")}
                title="自适应微卡网格"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-bold"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 分隔线 */}
            <div className="h-4 w-px bg-slate-200 dark:bg-white/[0.08] mx-0.5 hidden sm:block" />

            {/* 节点源与自建聚合入口 (Linear 风格发丝高光胶囊，统一管理订阅源与本地自建) */}
            <button
              type="button"
              onClick={() => {
                openSubscriptions("subscriptions");
                if (!mobile) void runSubscriptionAction(async () => { setProfiles(await getProfiles()); });
              }}
              title="统一管理订阅源配置与本地自建节点"
              className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-100/90 dark:bg-white/[0.05] hover:bg-slate-200/90 dark:hover:bg-white/[0.09] text-slate-800 dark:text-zinc-100 border border-slate-200/80 dark:border-white/[0.08] text-xs font-medium transition shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] cursor-pointer shrink-0 select-none active:scale-[0.99]"
            >
              <Radio className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>节点源与自建</span>
              <div className="flex items-center gap-1 font-mono text-[10px]">
                {subMeta.remainingTraffic ? (
                  <span className="px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 font-bold">
                    {subMeta.remainingTraffic}
                  </span>
                ) : profiles.length > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-md bg-black/5 dark:bg-white/10 text-slate-600 dark:text-zinc-300">
                    {profiles.length} 订阅
                  </span>
                ) : null}
                {localNodes.view?.nodes && localNodes.view.nodes.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-bold">
                    {localNodes.view.nodes.length} 自建
                  </span>
                )}
              </div>
            </button>
          </div>
        </div>
      )}

      {/* 主工作区滚动面板 */}
      <VirtualGridScroller className={`${mobile ? "mobile-node-scroller " : ""}flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4`} resetKey={`${search}:${hideTimeout}:${sourceFilter}`}>
        {/* 全局 / 直连模式状态横幅 */}
        {coreMode === "global" && (
          <div className="p-3 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 text-xs text-indigo-800 dark:text-indigo-200 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="font-bold flex items-center gap-1.5">🌐 全局代理模式 (Global)</span>
              <span className="text-[11px] text-indigo-600/90 dark:text-indigo-300">常规全网出站强锁主出口；业务套件优先保留独立专属出口 (选项 A)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="text-slate-500 dark:text-slate-400 font-sans">当前全局出口:</span>
              <span className="font-bold bg-indigo-100 dark:bg-indigo-900/60 px-2.5 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800">{activeNodeName || "未就绪"}</span>
            </div>
          </div>
        )}
        {coreMode === "direct" && (
          <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="font-bold flex items-center gap-1.5">⚡ 直接连接模式 (Direct)</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">所有出站流量均不走代理直接通信</span>
            </div>
          </div>
        )}

        {/* 自建核心线路区 (仅在有自建规则时展示，空规则时完全静默隐藏，不占任何空间) */}
        {smartRules.length > 0 && (
          <div>
            <div className={`${mobile ? "mobile-node-list-heading " : ""}flex items-center justify-between mb-2.5`}>
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-indigo-500" />
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide uppercase">
                  {mobile ? "自建线路" : "自建核心线路 (智能优选 / 双跳中继)"}
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">({smartRules.length})</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {smartRules.map((rule) => {
                const isRelay = rule.type === "relay";
                const isActive = activeNodeName === rule.name;
                const matchedCount = smartCounts[rule.id] || 0;

                return (
                  <div
                    key={rule.id}
                    onClick={() => handleSelectProxy(rule.name)}
                    className={`p-3.5 rounded-xl transition-all cursor-pointer group select-none border hairline-divider relative flex flex-col justify-between ${
                      isActive
                        ? "bg-emerald-500/[0.05] dark:bg-emerald-500/[0.08] ring-1 ring-emerald-500/40 shadow-[inset_0_1px_0_0_rgba(16,185,129,0.15)]"
                        : "bg-white/60 dark:bg-[#121316]/60 hover:dark:bg-[#121316]/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-zinc-400 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2 min-w-0 flex-1">
                          <span
                            className={`p-1.5 rounded-lg text-xs font-mono ${
                              isRelay
                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                : "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                            }`}
                          >
                            {isRelay ? <Link2 className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                          </span>
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={rule.name}>
                            {rule.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0">
                          {isActive ? (
                            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold border border-emerald-500/20">
                              <Check className="w-3 h-3" />
                              <span>使用中</span>
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] text-zinc-400 border hairline-divider opacity-70 group-hover:opacity-100 transition font-mono">
                              {catalogOffline ? "已保存" : "点击启用"}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              smartTrigger.current = e.currentTarget;
                              setEditingRule(rule);
                              setSmartModalOpen(true);
                            }}
                            title="编辑该自建线路"
                            aria-label={`编辑自建线路：${rule.name}`}
                            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSmartRule(rule.id, e);
                            }}
                            title="删除该自建线路"
                            className="p-1 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="text-[11px] text-zinc-400 space-y-1">
                        {isRelay ? (
                          <div className="flex items-center space-x-1.5 text-xs font-mono">
                            <span className="truncate max-w-[110px] text-zinc-300">{rule.relayEntry || "入口"}</span>
                            <span className="text-zinc-500">➔</span>
                            <span className="truncate max-w-[110px] font-semibold text-purple-400">
                              {rule.relayExit || "出口"}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-zinc-400 font-sans">
                              成员节点: <b className="font-mono text-zinc-200">{matchedCount}</b> 个
                            </span>
                            <span className="text-sky-400 font-mono text-[10px] uppercase">
                              {rule.type} 智能优选
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 基础节点池 */}
        <div>
          {regionGroups.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-3">
              <Radio className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs text-slate-500">{realNodes.length > 0 ? "没有符合当前搜索或筛选条件的节点。" : "还没有节点，请前往订阅管理添加订阅。"}</p>
              <button
                type="button"
                onClick={realNodes.length > 0 ? () => { setSearchKeyword(""); setHideTimeout(false); setSourceFilter("all"); } : openSubscriptions}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
              >
                {realNodes.length > 0 ? "清除筛选" : "添加订阅"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 表头 (Sticky Table Header: 精确 CSS Grid 体系，优化列宽权重，杜绝黑洞断层，大幅扩充节点名空间) */}
              {viewMode === "table" && !mobile && (
                <div className="sticky top-0 z-10 grid grid-cols-[minmax(240px,3.5fr)_76px_52px_minmax(180px,1.6fr)_56px_96px_40px] items-center gap-2.5 px-3.5 py-1.5 border-b border-slate-200/80 dark:border-white/[0.06] text-[10.5px] font-mono text-slate-600 dark:text-zinc-400 bg-slate-50/90 dark:bg-[#0a0c10]/95 backdrop-blur-md select-none tracking-wider font-medium">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3.5" />
                    <span className="truncate">节点线路与出口</span>
                  </div>
                  <div className="text-center">协议</div>
                  <div className="text-center">倍率</div>
                  <div className="min-w-0 truncate">落地 IP & 运营商</div>
                  <div className="text-center">风控</div>
                  <div className="text-center">握手延迟</div>
                  <div className="text-right pr-1">操作</div>
                </div>
              )}
              {(mobile ? [["全部节点", filteredNodes] as [string, ProxyItem[]]] : regionGroups).map(([regionTitle, nodes]) => (
                <div key={regionTitle} className="space-y-2">
                  {!mobile && <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-300 pb-1.5 border-b hairline-divider">
                    <div className="flex items-center space-x-2">
                      <span>{regionTitle}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono border hairline-divider ${
                        regionTitle.startsWith("⏳")
                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20 font-bold"
                          : "bg-white/[0.04] text-zinc-400"
                      }`}>
                        {nodes.length}
                      </span>
                      {regionTitle.startsWith("⏳") && (
                        <span className="text-[11px] text-amber-500/80 font-normal hidden sm:inline">
                          节点出口真实地区尚未体检核验
                        </span>
                      )}
                    </div>

                    {/* 待确认真实出口分组提供【一键体检本组】与【一键忽略本组】 */}
                    {regionTitle.startsWith("⏳") && (
                      <div className="flex items-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => void handleProbeAllHealth(nodes.map(n => n.name))}
                          disabled={healthUnavailable || probingAll || anySingleProbe}
                          className="flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition cursor-pointer disabled:opacity-50"
                          title="一键体检确认这批节点的真实出口地区"
                        >
                          <Shield className={`w-3 h-3 ${probingAll ? "animate-spin" : ""}`} />
                          <span>{probingAll ? "体检中..." : "一键体检本组"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleIgnoreAllUnprobed(nodes, e)}
                          className="flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-mono text-zinc-400 hover:text-zinc-200 bg-white/[0.04] hover:bg-white/[0.08] border hairline-divider transition cursor-pointer"
                          title="一键忽略这批尚未确认真实出口的节点，从大盘隐藏且不再提示"
                        >
                          <EyeOff className="w-3 h-3 text-zinc-400" />
                          <span>忽略本组</span>
                        </button>
                      </div>
                    )}
                  </div>}

                  <VirtualGrid
                    items={nodes}
                    itemKey={node => node.name}
                    label={`${regionTitle}节点`}
                    columns={mobile ? 2 : viewMode === "table" ? 1 : undefined}
                    rowHeight={mobile ? 138 : viewMode === "table" ? 42 : 112}
                    renderItem={(node) => {
                      const isSelected = selectedSet.has(node.name);
                      const isActive = activeNodeName === node.name;
                      const delay = delayMap[node.name] ?? node.history?.[node.history.length - 1]?.delay ?? null;
                      const isTesting = testingNodes[node.name];
                      const isProbing = probingNodes[node.name];
                      const health = healthCache[node.name];
                      const mult = parseMultiplier(node.name);
                      const realCountry = persistedNodeRegions[node.name] || (health?.countryCode ? formatCountryRegionTitle(health.countryCode, health.country) : undefined);

                      if (mobile) return <MobileNodeCard name={nodeLabel(node.name)} protocol={node.type} active={isActive && !catalogOffline} selected={isSelected}
                        selectionMode={mobileSelecting}
                        switching={switchingNodeName === node.name}
                        delay={isTesting ? "测速中" : delay === null ? "未测速" : delay <= 0 ? "超时" : `${delay}ms`}
                        delayTone={delay === null ? "text-slate-500" : delay <= 0 || delay >= 500 ? "text-rose-500" : delay < 200 ? "text-emerald-600" : "text-amber-600"}
                        testing={!!isTesting} offline={catalogOffline} region={realCountry} ip={health?.ip} risk={health?.fraudScore}
                        multiplier={mult === null ? "1.0x" : formatMultiplier(mult)} probing={!!isProbing} probeDisabled={!!isProbing || probingAll || anySingleProbe}
                        local={localByAlias.has(node.name)} localBusy={localNodes.busy} onConnect={() => void handleSelectProxy(node.name)}
                        onTest={() => void handleTestNode(node.name)} onProbe={() => void handleProbeHealth(node.name)}
                        onSelect={() => { setMobileSelecting(true); toggleSelectNode(node.name); }} onIgnore={() => handleIgnoreNode(node.name)}
                        onEdit={() => { const local = localByAlias.get(node.name); if (local) void localNodes.edit(local.id); }}
                        onDelete={() => { const local = localByAlias.get(node.name); if (local) localNodes.remove(local); }} />;

                      if (viewMode === "table") {
                        return (
                          <div
                            key={node.name}
                            onClick={() => handleSelectProxy(node.name)}
                            className={`h-full grid grid-cols-[minmax(240px,3.5fr)_76px_52px_minmax(180px,1.6fr)_56px_96px_40px] items-center gap-2.5 px-3.5 transition-colors cursor-pointer relative group select-none text-xs border-b border-slate-200/60 dark:border-white/[0.04] ${
                              isActive
                                ? "bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] text-zinc-900 dark:text-zinc-100 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:bg-emerald-500 before:rounded-r"
                                : isSelected
                                ? "bg-indigo-500/[0.06] dark:bg-indigo-500/[0.1] text-zinc-900 dark:text-zinc-100"
                                : "hover:bg-slate-100/60 dark:hover:bg-white/[0.03] text-zinc-700 dark:text-zinc-300"
                            }`}
                          >
                            {/* 列 1：勾选 + 节点名称 + 当前出口徽标 */}
                            <div className="flex items-center space-x-2.5 min-w-0 truncate pr-1">
                              <button
                                type="button"
                                onClick={(e) => toggleSelectNode(node.name, e)}
                                title={isSelected ? "取消勾选" : "勾选以打包为线路"}
                                className="text-zinc-400 hover:text-sky-400 transition shrink-0"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 opacity-30 group-hover:opacity-80 transition" />
                                )}
                              </button>
                              <div className="flex items-center space-x-2 min-w-0 flex-1 truncate">
                                <span className="font-medium text-zinc-900 dark:text-zinc-200 truncate" title={nodeLabel(node.name)}>
                                  {nodeLabel(node.name)}
                                </span>
                                {isActive && (
                                  <span className="shrink-0 flex items-center space-x-1 px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-bold">
                                    <Check className="w-3 h-3" />
                                    <span>当前出口</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 列 2：协议类型 */}
                            <div className="flex items-center justify-center min-w-0">
                              <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.04] border hairline-divider text-zinc-400 font-mono truncate max-w-full">
                                {node.type}
                              </span>
                            </div>

                            {/* 列 3：倍率与本地 */}
                            <div className="flex items-center justify-center gap-1 min-w-0">
                              {localByAlias.has(node.name) ? (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                                  本地
                                </span>
                              ) : mult !== null ? (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono font-bold">
                                  {formatMultiplier(mult)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-600 font-mono">1.0x</span>
                              )}
                            </div>

                            {/* 列 4：真实落地 IP 与 ASN 运营商 (空间重平衡，支持直接单节点快速体检，消除大面积留白虚无) */}
                            <div className="flex items-center space-x-1.5 min-w-0 truncate text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                              {health?.ip ? (
                                <div className="flex items-center space-x-1.5 min-w-0 truncate w-full">
                                  <span className="text-zinc-300 shrink-0 font-medium">{health.ip}</span>
                                  <span className="text-[10px] text-zinc-500 truncate" title={health.asOrganization || (health.asn ? `AS${health.asn}` : "")}>
                                    {health.asOrganization || (health.asn ? `AS${health.asn}` : "")}
                                  </span>
                                </div>
                              ) : realCountry ? (
                                <div className="flex items-center space-x-1.5 min-w-0 truncate">
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans font-medium truncate">
                                    {realCountry}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleProbeHealth(node.name, e)}
                                    disabled={healthUnavailable || isProbing || probingAll || anySingleProbe}
                                    title="点击测出落地 IP 与风控详情"
                                    className="text-[9.5px] text-zinc-500 hover:text-sky-400 font-mono transition cursor-pointer"
                                  >
                                    [体检]
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => handleProbeHealth(node.name, e)}
                                  disabled={healthUnavailable || isProbing || probingAll || anySingleProbe}
                                  title="该节点真实出口未确认，点击发起深度体检"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/25 text-[10px] font-sans font-medium transition cursor-pointer disabled:opacity-50"
                                >
                                  <Shield className={`w-3 h-3 ${isProbing ? "animate-spin" : "opacity-75"}`} />
                                  <span>{isProbing ? "体检中..." : "出口待核验"}</span>
                                </button>
                              )}
                            </div>

                            {/* 列 5：风控分数 (居中对齐) */}
                            <div className="flex items-center justify-center min-w-0">
                              {health && health.fraudScore != null ? (
                                <span
                                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono border ${
                                    health.fraudScore <= 25
                                      ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
                                      : health.fraudScore <= 60
                                      ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
                                      : "text-rose-500 bg-rose-500/10 border-rose-500/20"
                                  }`}
                                  title={`欺诈风险评分: ${health.fraudScore}`}
                                >
                                  {health.fraudScore}分
                                </span>
                              ) : (
                                <span className="text-zinc-600 font-mono text-[11px]">-</span>
                              )}
                            </div>

                            {/* 列 6：握手延迟与测速 (居中对齐) */}
                            <div className="flex items-center justify-center min-w-0">
                              <button
                                type="button"
                                onClick={(e) => handleTestNode(node.name, e)}
                                disabled={catalogOffline || isTesting}
                                title={catalogOffline ? "启动核心后可测速" : delay === null ? "尚未测速，点击为此节点测速" : "单独为此节点测速"}
                                className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold transition cursor-pointer hover:bg-white/10"
                              >
                                {isTesting ? (
                                  <span className="text-sky-400 animate-pulse flex items-center gap-1">
                                    <Zap className="w-3 h-3 animate-bounce" />
                                    <span>测速中</span>
                                  </span>
                                ) : delay === null ? (
                                  <span className="text-zinc-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 inline-block" />
                                    <span>未测速</span>
                                  </span>
                                ) : delay <= 0 ? (
                                  <span className="text-rose-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                                    <span>超时</span>
                                  </span>
                                ) : delay < 100 ? (
                                  <span className="text-emerald-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                    <span>{delay}ms</span>
                                  </span>
                                ) : delay < 200 ? (
                                  <span className="text-amber-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                                    <span>{delay}ms</span>
                                  </span>
                                ) : (
                                  <span className="text-rose-400 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                                    <span>{delay}ms</span>
                                  </span>
                                )}
                              </button>
                            </div>

                            {/* 列 7：操作与详情 (右对齐) */}
                            <div className="flex items-center justify-end space-x-1 pr-1 min-w-0">
                              {localByAlias.has(node.name) && (
                                <div className="flex items-center gap-0.5">
                                  <button type="button" aria-label={`编辑 ${nodeLabel(node.name)}`} title="编辑本地节点" disabled={localNodes.busy} onClick={e => { e.stopPropagation(); void localNodes.edit(localByAlias.get(node.name)!.id); }} className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"><Pencil size={12} /></button>
                                  <button type="button" aria-label={`删除 ${nodeLabel(node.name)}`} title="删除本地节点" disabled={localNodes.busy} onClick={e => { e.stopPropagation(); localNodes.remove(localByAlias.get(node.name)!); }} className="p-1 text-zinc-400 hover:text-rose-400 cursor-pointer"><Trash2 size={12} /></button>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openInspector(node);
                                }}
                                title="查看全息解锁探针与风控详情"
                                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition cursor-pointer"
                              >
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={node.name}
                          onClick={() => handleSelectProxy(node.name)}
                          className={`h-full p-3 rounded-xl border hairline-divider transition-all cursor-pointer relative group flex flex-col justify-between select-none ${
                            isActive
                              ? "bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] ring-1 ring-emerald-500/40 shadow-[inset_0_1px_0_0_rgba(16,185,129,0.15)]"
                              : isSelected
                              ? "bg-indigo-500/[0.06] dark:bg-indigo-500/[0.1] border-indigo-500/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                              : "bg-white/60 dark:bg-[#121316]/60 hover:dark:bg-[#121316]/90 border hairline-divider shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-zinc-400 dark:hover:border-zinc-700"
                          }`}
                        >
                          {/* 节点第一行：勾选框、名称与活动徽章 */}
                          <div className="flex items-start justify-between space-x-2 mb-2">
                            <div className="flex items-center space-x-2 min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={(e) => toggleSelectNode(node.name, e)}
                                title={isSelected ? "取消勾选" : "勾选以打包为线路"}
                                className="text-zinc-400 hover:text-sky-400 transition shrink-0"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 opacity-30 group-hover:opacity-80 transition" />
                                )}
                              </button>
                              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate flex-1" title={nodeLabel(node.name)}>
                                {nodeLabel(node.name)}
                              </span>
                            </div>
                            {localByAlias.has(node.name) && <div className="flex items-center gap-1 shrink-0">
                              <button type="button" aria-label={`编辑 ${nodeLabel(node.name)}`} title="编辑本地节点" disabled={localNodes.busy} onClick={e => { e.stopPropagation(); void localNodes.edit(localByAlias.get(node.name)!.id); }} className="p-1 text-zinc-400 hover:text-zinc-200"><Pencil size={12} /></button>
                              <button type="button" aria-label={`删除 ${nodeLabel(node.name)}`} title="删除本地节点" disabled={localNodes.busy} onClick={e => { e.stopPropagation(); localNodes.remove(localByAlias.get(node.name)!); }} className="p-1 text-zinc-400 hover:text-rose-400"><Trash2 size={12} /></button>
                            </div>}
                            {isActive && (
                              <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-bold shrink-0">
                                <Check className="w-3 h-3" />
                                <span>使用中</span>
                              </span>
                            )}
                          </div>

                          {/* 节点第二行：协议、倍率、真实出口与体检/测速/忽略 */}
                          <div className="flex items-center justify-between text-[11px] pt-1.5 border-t hairline-divider">
                            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/[0.04] border hairline-divider text-zinc-400 font-mono">
                                {node.type}
                              </span>
                              {localByAlias.has(node.name) && <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">本地</span>}
                              {mult !== null && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono font-bold">
                                  {formatMultiplier(mult)}
                                </span>
                              )}
                              {realCountry ? (
                                <span
                                  className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans font-medium"
                                  title={`真实出口 IP: ${health?.ip || "已验证"} (${realCountry})`}
                                >
                                  {realCountry}
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center space-x-0.5 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-sans font-medium"
                                  title="该节点尚未进行过真实出口 IP 体检"
                                >
                                  <Shield className="w-2.5 h-2.5 opacity-80" />
                                  <span>未体检</span>
                                </span>
                              )}
                              {health && health.fraudScore != null && (
                                <span
                                  className={`text-[10px] px-1 py-0.2 rounded font-mono border ${
                                    health.fraudScore <= 25
                                      ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
                                      : health.fraudScore <= 60
                                      ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
                                      : "text-rose-500 bg-rose-500/10 border-rose-500/20"
                                  }`}
                                  title={`欺诈风险分: ${health.fraudScore}`}
                                >
                                  {health.fraudScore}分
                                </span>
                              )}
                            </div>

                            {/* 操作区：⚡ 单节点测速、🛡️ 单节点体检、ℹ 详情、🙈 忽略本节点 */}
                            <div className="flex items-center space-x-1 shrink-0 ml-1">
                              {/* 延迟数字与单测速 */}
                              <button
                                type="button"
                                onClick={(e) => handleTestNode(node.name, e)}
                                disabled={catalogOffline || isTesting}
                                title={catalogOffline ? "启动核心后可测速" : delay === null ? "尚未测速，点击为此节点测速" : "单独为此节点测速"}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono font-semibold transition cursor-pointer hover:bg-white/10"
                              >
                                {isTesting ? (
                                  <span className="text-sky-400 animate-pulse flex items-center gap-0.5">
                                    <Zap className="w-3 h-3 animate-bounce" />
                                    <span>测速中</span>
                                  </span>
                                ) : delay === null ? (
                                  <span className="text-zinc-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 inline-block" />
                                    <span>未测速</span>
                                  </span>
                                ) : delay <= 0 ? (
                                  <span className="text-rose-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                                    <span>超时</span>
                                  </span>
                                ) : delay < 100 ? (
                                  <span className="text-emerald-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                    <span>{delay}ms</span>
                                  </span>
                                ) : delay < 200 ? (
                                  <span className="text-amber-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                                    <span>{delay}ms</span>
                                  </span>
                                ) : (
                                  <span className="text-rose-400 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                                    <span>{delay}ms</span>
                                  </span>
                                )}
                              </button>

                              {/* 单节点 IP 体检入口 */}
                              <button
                                type="button"
                                onClick={(e) => handleProbeHealth(node.name, e)}
                                disabled={healthUnavailable || isProbing || probingAll || anySingleProbe}
                                title={healthUnavailable ? "启动核心后可进行 IP 体检" : "单节点 IP 深度体检并锁定真实出口国家"}
                                className="p-1 rounded-md text-zinc-400 hover:text-purple-400 hover:bg-white/10 transition cursor-pointer"
                              >
                                <Shield className={`w-3.5 h-3.5 ${isProbing ? "animate-spin text-purple-400" : ""}`} />
                              </button>

                              {/* 全息详情抽屉按键 */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openInspector(node);
                                }}
                                title="查看全息解锁探针与风控详情"
                                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition cursor-pointer"
                              >
                                <Info className="w-3.5 h-3.5" />
                              </button>

                              {/* 忽略节点按钮 */}
                              <button
                                type="button"
                                onClick={(e) => handleIgnoreNode(node.name, e)}
                                title="忽略此节点（大盘隐藏且不再警告）"
                                className="p-1 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-white/10 transition cursor-pointer opacity-30 group-hover:opacity-100"
                              >
                                <EyeOff className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }} />
                </div>
              ))}
            </div>
          )}

          {/* 底部已忽略节点折叠查看栏 */}
          {ignoredNodes.length > 0 && (
            <div className="mt-6 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/40 backdrop-blur-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <EyeOff className="w-4 h-4 text-slate-400" />
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    已忽略的节点 ({ignoredNodes.length})
                  </h4>
                  <span className="text-[10px] text-slate-400">已从大盘与体检提示中隐藏</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIgnoredNodes([]);
                      saveIgnoredNodes([]);
                    }}
                    className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    全部恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowIgnoredDrawer(!showIgnoredDrawer)}
                    className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                  >
                    {showIgnoredDrawer ? "收起" : "展开查看"}
                  </button>
                </div>
              </div>

              {showIgnoredDrawer && (
                <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800/60 flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                  {ignoredNodes.map((name) => (
                    <div
                      key={name}
                      className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60"
                    >
                      <span className="truncate max-w-[200px]" title={name}>{name}</span>
                      <button
                        type="button"
                        onClick={(e) => handleUnignoreNode(name, e)}
                        title="恢复显示到大盘"
                        className="text-slate-400 hover:text-emerald-500 cursor-pointer p-0.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </VirtualGridScroller>

      {/* 底部悬浮操作栏：当勾选多节点时出现 */}
      {selectedNodes.length >= (mobile ? 1 : 2) && (
        <div className={`${mobile ? "mobile-node-selection " : ""}absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white dark:bg-slate-800/95 border border-slate-700 rounded-2xl px-5 py-3 shadow-2xl backdrop-blur-md flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-4 duration-200`}>
          <div className="flex items-center space-x-2 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>已选中 <strong className="text-indigo-400 font-mono">{selectedNodes.length}</strong> 个节点</span>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          {/* 打包为优选组 */}
          <button
            type="button"
            disabled={selectedNodes.length < 2}
            onClick={() => {
              setPackModalType("url-test");
              setPackName("自动优选线路");
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold shadow transition"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{mobile ? "自动优选" : "打包为自动优选线路"}</span>
          </button>

          {/* 打包为中继 */}
          <button
            type="button"
            disabled={selectedNodes.length !== 2}
            onClick={() => {
              setPackModalType("relay");
              setPackName("链式双跳中继");
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold shadow transition"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{mobile ? "链式中继" : "打包为链式中继"}</span>
          </button>

          <button
            type="button"
            onClick={() => { setSelectedNodes([]); setMobileSelecting(false); }}
            className="text-xs text-slate-400 hover:text-white transition"
          >
            取消选择
          </button>
        </div>
      )}

      {/* 快速打包起名弹窗 */}
      <dialog ref={packDialog} aria-label="打包创建线路" aria-busy={packSaving} onCancel={event => { event.preventDefault(); closePack(); }} className="m-auto w-[calc(100%-32px)] max-w-sm max-h-[85dvh] p-0 bg-transparent rounded-2xl backdrop:bg-slate-900/60">
      {packModalType && (
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {packModalType === "relay" ? <Link2 className="w-4 h-4 text-purple-500" /> : <Zap className="w-4 h-4 text-indigo-500" />}
              <span>{packModalType === "relay" ? "打包创建中继线路" : "打包创建自动优选线路"}</span>
            </h4>
            <div className="space-y-2">
              <label className="text-xs text-slate-500">为新线路命名：</label>
              <input
                type="text"
                aria-label="新线路名称"
                disabled={packSaving}
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                placeholder="例如：香港超快优选"
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
              <p className="text-[11px] text-slate-400">
                {packModalType === "relay"
                  ? `将以【${selectedNodes[0]}】为入口前置，以【${selectedNodes[1]}】为落地出口。`
                  : `系统将在所选的 ${selectedNodes.length} 个节点中自动秒选延迟最低的节点。`}
              </p>
              {packModalType === "relay" && selectedNodes.length === 2 && (
                <button type="button" disabled={packSaving} onClick={() => setSelectedNodes(([first, second]) => [second, first])} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">交换入口与出口</button>
              )}
            </div>
            {packError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 break-words">{packError}</p>}
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={closePack}
                disabled={packSaving}
                className="px-3.5 py-1.5 rounded-xl text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmPack}
                disabled={packSaving}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                {packSaving ? "正在创建…" : "确认创建"}
              </button>
            </div>
          </div>
      )}
      </dialog>

      {/* 节点与源管理抽屉 (Resource & Sources Drawer: Linear / Raycast 极简冷黑悬浮质感) */}
        <dialog
          ref={subDrawer}
          aria-labelledby="resource-drawer-title"
          aria-busy={subLoading}
          data-no-drag
          onCancel={event => { event.preventDefault(); closeSubscriptionDialog(false); }}
          onPointerDown={event => { backdropPressed.current = event.target; }}
          onClick={event => closeSubscriptionBackdrop(event, false)}
          className="fixed inset-0 z-[9999] m-0 ml-auto h-[100dvh] max-h-none w-full max-w-[480px] p-0 overflow-hidden bg-transparent text-slate-800 dark:text-zinc-100 backdrop:bg-black/60 backdrop:backdrop-blur-xs font-sans"
        >
          <div className="w-full max-w-[480px] bg-white/95 dark:bg-[#08090a]/95 backdrop-blur-2xl h-full shadow-[-30px_0_60px_-15px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.08)] flex flex-col justify-between border-l border-slate-200/80 dark:border-white/10 animate-in slide-in-from-right duration-200">
            {/* 抽屉顶部标题栏 */}
            <div className="p-4 border-b border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2.5">
                <Layers className="w-4 h-4 text-indigo-400" />
                <div>
                  <h3 id="resource-drawer-title" className="text-sm font-bold text-slate-900 dark:text-white">
                    节点与源管理
                  </h3>
                  <p className="text-[10px] text-zinc-400 font-sans">
                    统一调度外部订阅配置与本机自建节点
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-black/5 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded">
                  ESC
                </kbd>
                <button
                  type="button"
                  aria-label="关闭节点源管理"
                  autoFocus
                  disabled={subLoading}
                  onClick={() => closeSubscriptionDialog(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition disabled:opacity-40 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Linear 级无缝分段切换 (Segmented Control) */}
            <div className="px-4 py-2.5 border-b border-slate-200/60 dark:border-white/[0.06] shrink-0">
              <div className="flex items-center p-0.5 rounded-xl bg-slate-100/90 dark:bg-black/45 border border-slate-200/80 dark:border-white/[0.08] shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3)]">
                <button
                  type="button"
                  onClick={() => setSubDrawerTab("subscriptions")}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer select-none ${
                    subDrawerTab === "subscriptions"
                      ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-semibold"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Radio className="w-3.5 h-3.5 text-indigo-400" />
                  <span>订阅源</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-black/5 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 font-bold">
                    {profiles.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubDrawerTab("custom")}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 cursor-pointer select-none ${
                    subDrawerTab === "custom"
                      ? "bg-white dark:bg-white/[0.12] text-zinc-900 dark:text-white shadow-2xs font-semibold"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5 text-sky-400" />
                  <span>本地自建节点</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-black/5 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 font-bold">
                    {localNodes.view?.nodes.length || 0}
                  </span>
                </button>
              </div>
            </div>

            {/* 抽屉可滚动内容区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {copyNotice && (
                <div role="status" className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in duration-150">
                  <Check className="w-3.5 h-3.5" />
                  <span>{copyNotice}</span>
                </div>
              )}

              {subDrawerTab === "subscriptions" ? (
                <>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                    {mobile ? "切换当前订阅，节点大盘会立即同步更新。" : "切换订阅将热重载底层节点池与规则集；业务包若指定了专属出口将自动平滑迁移。"}
                  </p>
                  {subError && <p role="alert" className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 p-2 rounded-xl break-words">{subError}</p>}
                  {subNotice && <p role="status" className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl break-words">{subNotice}</p>}

                  {profiles.length === 0 ? (
                    <div className="text-center py-12 text-xs text-zinc-500 space-y-2 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl p-6">
                      <Radio className="w-8 h-8 text-zinc-600 mx-auto" />
                      <p>您尚未添加任何订阅源。</p>
                      <p className="text-[11px] text-zinc-600">点击下方按钮录入订阅链接或批量导入。</p>
                    </div>
                  ) : (
                    profiles.map((prof) => (
                      <div
                        key={prof.id}
                        className={`relative p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] ${
                          prof.isSelected
                            ? "border-emerald-500/40 bg-emerald-500/[0.04] shadow-[inset_0_1px_0_0_rgba(16,185,129,0.15)]"
                            : "border-slate-200/80 dark:border-white/10 bg-slate-50/70 dark:bg-[#121316]/60 hover:bg-slate-100/80 dark:hover:bg-[#18191e]/80"
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={`使用订阅：${prof.name}`}
                          aria-pressed={prof.isSelected}
                          aria-busy={switchingProfileId === prof.id}
                          disabled={subLoading}
                          onClick={() => void handleSelectSubscription(prof.id)}
                          className="absolute inset-0 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait"
                        />
                        <div className="relative pointer-events-none flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-slate-800 dark:text-zinc-100 truncate max-w-[200px]">
                              {prof.name}
                            </span>
                            {prof.isSelected && (
                              <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-[10px] font-mono font-bold">
                                <Check className="w-2.5 h-2.5" />
                                <span>使用中</span>
                              </span>
                            )}
                          </div>
                          <div className="pointer-events-auto flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateSubscription(prof.id)}
                              disabled={subLoading}
                              aria-label={`更新订阅：${prof.name}`}
                              title="一键更新该订阅"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition cursor-pointer"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${subLoading && switchingProfileId === prof.id ? "animate-spin text-sky-400" : ""}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteSubscription(prof.id)}
                              disabled={subLoading}
                              aria-label={`删除订阅：${prof.name}`}
                              title="删除订阅"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="relative pointer-events-none flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                          <span>节点数: <b className="text-slate-700 dark:text-zinc-200 font-semibold">{prof.nodeCount || 0}</b></span>
                          {prof.upload !== undefined && (
                            <span>已用: <b className="text-slate-700 dark:text-zinc-300">{formatBytes((prof.upload || 0) + (prof.download || 0))}</b></span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                    本地手动维护的单节点或私有协议服务，不随订阅拉取被覆盖，持久安全固化于本机。
                  </p>
                  {localNodes.error && <p role="alert" className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 p-2 rounded-xl break-words">{localNodes.error}</p>}
                  {localNodes.notice && <p role="status" className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl break-words">{localNodes.notice}</p>}

                  {(!localNodes.view?.nodes || localNodes.view.nodes.length === 0) ? (
                    <div className="text-center py-12 text-xs text-zinc-500 space-y-2 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl p-6">
                      <Cpu className="w-8 h-8 text-zinc-600 mx-auto" />
                      <p>尚未添加任何自建节点。</p>
                      <p className="text-[11px] text-zinc-600">支持 AnyTLS, Reality, Hysteria2, VLESS, SS 等各类协议单节点。</p>
                    </div>
                  ) : (
                    localNodes.view.nodes.map((node) => (
                      <div
                        key={node.id}
                        className="relative p-3.5 rounded-xl border border-slate-200/80 dark:border-white/10 bg-slate-50/70 dark:bg-[#121316]/60 hover:bg-slate-100/80 dark:hover:bg-[#18191e]/80 transition-all flex flex-col gap-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-slate-900 dark:text-zinc-100 truncate" title={node.name}>
                                {node.name}
                              </span>
                              <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] font-mono uppercase font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                                {node.protocol}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 truncate mt-1">
                              {node.server}:{node.port}
                            </div>
                          </div>

                          {/* 快速操作组 */}
                          <div className="flex items-center space-x-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleCopyNodeInfo(node)}
                              title="复制节点连接配置/地址"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void localNodes.edit(node.id)}
                              disabled={localNodes.busy}
                              title="编辑此自建节点"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => localNodes.remove(node)}
                              disabled={localNodes.busy}
                              title="删除此自建节点"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>

            {/* 抽屉底部操作栏 (根据当前 Tab 呈现对应操作) */}
            <div className="p-4 border-t border-slate-200/80 dark:border-white/[0.08] bg-slate-50/90 dark:bg-black/45 backdrop-blur-md shrink-0">
              {subDrawerTab === "subscriptions" ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setAddSubError(""); setShowAddSubModal(true); }}
                    disabled={subLoading}
                    className="flex-1 py-2 px-3.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] transition-all flex items-center justify-center space-x-1.5 disabled:opacity-40 cursor-pointer active:scale-[0.98]"
                  >
                    <Plus className="w-4 h-4 text-zinc-950" />
                    <span>添加新订阅源</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={localNodes.busy || !localNodes.view}
                      onClick={() => localNodes.openNew()}
                      className="flex-1 py-2 px-3.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] transition-all flex items-center justify-center space-x-1.5 disabled:opacity-40 cursor-pointer active:scale-[0.98]"
                    >
                      <Plus className="w-4 h-4 text-zinc-950" />
                      <span>新建自建节点</span>
                    </button>

                    <button
                      type="button"
                      disabled={localNodes.busy || !localNodes.view}
                      onClick={() => localNodes.openImport()}
                      className="py-2 px-3.5 rounded-xl bg-slate-200/80 dark:bg-white/[0.06] hover:bg-slate-300 dark:hover:bg-white/10 text-slate-800 dark:text-zinc-200 border border-slate-300 dark:border-white/10 text-xs font-medium transition flex items-center justify-center space-x-1.5 disabled:opacity-40 cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>导入配置链接</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={(event) => {
                      setSubDrawerOpen(false);
                      smartTrigger.current = event.currentTarget;
                      setEditingRule(null);
                      setSmartModalOpen(true);
                    }}
                    className="w-full py-1.5 px-3 rounded-lg text-center text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition flex items-center justify-center gap-1.5 cursor-pointer font-sans"
                  >
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>组建智能线路 (轮询 / 负载均衡) ➔</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </dialog>

      {/* 添加订阅小弹窗 */}
        <dialog
          ref={addSubDialog}
          aria-labelledby="add-subscription-title"
          aria-busy={subLoading}
          onCancel={event => { event.preventDefault(); closeSubscriptionDialog(true); }}
          onPointerDown={event => { backdropPressed.current = event.target; }}
          onClick={event => closeSubscriptionBackdrop(event, true)}
          className="w-[min(420px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto p-0 rounded-2xl bg-white/95 dark:bg-[#0d1015]/95 text-slate-800 dark:text-zinc-100 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)] border border-slate-200/80 dark:border-white/10 backdrop:bg-black/60 backdrop:backdrop-blur-xs font-sans"
        >
          <form onSubmit={event => { event.preventDefault(); void handleAddSubscription(); }} className="w-full p-5 space-y-4">
            <h4 id="add-subscription-title" className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-indigo-400" />
              <span>添加订阅链接</span>
            </h4>
            {addSubError && <p role="alert" className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 p-2 rounded-xl break-words">{addSubError}</p>}
            <div className="space-y-3">
              <div>
                <label htmlFor="add-subscription-name" className="text-xs text-zinc-400 block mb-1">订阅名称 (选填):</label>
                <input
                  id="add-subscription-name"
                  autoFocus
                  disabled={subLoading}
                  type="text"
                  placeholder="例如：极速专线"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-100 dark:bg-black/40 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden focus:border-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="add-subscription-url" className="text-xs text-zinc-400 block mb-1">订阅链接 (URL):</label>
                <input
                  id="add-subscription-url"
                  disabled={subLoading}
                  type="text"
                  placeholder="https://..."
                  value={newSubUrl}
                  onChange={(e) => setNewSubUrl(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-100 dark:bg-black/40 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                disabled={subLoading}
                onClick={() => closeSubscriptionDialog(true)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={subLoading || !newSubUrl.trim()}
                className="px-4 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow transition disabled:opacity-50 cursor-pointer"
              >
                {subLoading ? "下载中..." : "保存并导入"}
              </button>
            </div>
          </form>
        </dialog>

      {/* 新建/编辑智能线路高级弹窗 */}
      <SmartGroupModal
        isOpen={smartModalOpen}
        onClose={() => { setSmartModalOpen(false); smartTrigger.current?.focus(); }}
        editingRule={editingRule}
        allProxyNames={realNodeNames}
        proxyLabels={Object.fromEntries([...localByAlias].map(([alias, node]) => [alias, `${node.name} · 本地`]))}
        fallbackOptions={smartFallbackOptions}
        otherSmartGroupNames={smartRules.filter(rule => rule.id !== editingRule?.id).map(rule => rule.name)}
        onSave={async (savedRule) => {
          const exists = smartRules.some((r) => r.id === savedRule.id);
          const next = exists
            ? smartRules.map((r) => (r.id === savedRule.id ? savedRule : r))
            : [...smartRules, savedRule];
          await syncRules(next);
          setSmartRules(next);
          void loadData();
        }}
      />
      <ProfileSwitchDialog state={profileSwitch.state} actions={profileSwitch.actions} />
      <LocalNodeDialog dialog={localNodes.dialog} busy={localNodes.busy} error={localNodes.error} preview={localNodes.preview}
        onClose={localNodes.close} onSave={localNodes.save} onDelete={localNodes.confirmDelete} onPreview={localNodes.previewText} onImport={localNodes.importPreview} onClearPreview={localNodes.clearPreview} />
      {!localNodes.dialog && (localNodes.error || localNodes.notice) && <div role="status" className="absolute bottom-4 left-4 right-4 rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 shadow-md flex items-center justify-between gap-2"><span>{localNodes.error || localNodes.notice}</span>{localNodes.error ? <button type="button" className="text-indigo-600 shrink-0" onClick={() => void localNodes.refresh()}>重新读取</button> : <button type="button" aria-label="关闭节点提示" onClick={localNodes.dismissNotice} className="shrink-0 p-1"><X size={14} /></button>}</div>}

      {/* 浮动右侧：全息详情与解锁风控抽屉 (Inspector Drawer) */}
      {inspectorNode && (
        <div
          className="absolute top-0 right-0 bottom-0 w-[360px] sm:w-[390px] bg-white/95 dark:bg-[#08090a]/95 backdrop-blur-2xl border-l hairline-divider shadow-[-25px_0_50px_-15px_rgba(0,0,0,0.8)] z-40 flex flex-col justify-between animate-in slide-in-from-right duration-200"
          data-no-drag
        >
          {/* 抽屉头部 */}
          <div className="p-4 border-b hairline-divider flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xl shrink-0">
                {(persistedNodeRegions[inspectorNode.name] || healthCache[inspectorNode.name]?.countryCode)
                  ? (persistedNodeRegions[inspectorNode.name] || formatCountryRegionTitle(healthCache[inspectorNode.name]?.countryCode || "", healthCache[inspectorNode.name]?.country)).split(" ")[0]
                  : "🌐"}
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate" title={nodeLabel(inspectorNode.name)}>
                  {nodeLabel(inspectorNode.name)}
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-zinc-400">
                  <span className="font-mono uppercase px-1.5 py-0.2 rounded bg-white/[0.04] border hairline-divider text-zinc-400">
                    {inspectorNode.type}
                  </span>
                  {activeNodeName === inspectorNode.name && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-500/15 border border-emerald-500/20 px-1.5 py-0.2 rounded font-mono">
                      ✓ 当前活动出口
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeInspector}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition cursor-pointer"
              title="关闭详情 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 抽屉可滚动主体 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            {/* 卡片 1：链路质量与往返握手 */}
            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#121316]/60 border hairline-divider shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>链路往返握手延迟</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => handleTestNode(inspectorNode.name, e)}
                  disabled={catalogOffline || testingNodes[inspectorNode.name]}
                  className="text-[10px] text-sky-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50 font-mono"
                >
                  <RefreshCw className={`w-3 h-3 ${testingNodes[inspectorNode.name] ? "animate-spin" : ""}`} />
                  <span>{testingNodes[inspectorNode.name] ? "测速中" : "重新测速"}</span>
                </button>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
                  {testingNodes[inspectorNode.name]
                    ? "测速中..."
                    : (delayMap[inspectorNode.name] ?? inspectorNode.history?.[inspectorNode.history.length - 1]?.delay ?? null) === null
                    ? "未测速"
                    : (delayMap[inspectorNode.name] ?? inspectorNode.history?.[inspectorNode.history.length - 1]?.delay ?? 0) <= 0
                    ? "超时"
                    : `${delayMap[inspectorNode.name] ?? inspectorNode.history?.[inspectorNode.history.length - 1]?.delay} ms`}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {(delayMap[inspectorNode.name] ?? inspectorNode.history?.[inspectorNode.history.length - 1]?.delay ?? 999) < 100
                    ? "⚡ 极速响应 · 游戏与语音极佳"
                    : (delayMap[inspectorNode.name] ?? inspectorNode.history?.[inspectorNode.history.length - 1]?.delay ?? 999) < 200
                    ? "✓ 表现良好 · 网页流媒体流畅"
                    : "高延迟链路"}
                </span>
              </div>
            </div>

            {/* 卡片 2：Scamalytics 真实风控雷达与网络属性 */}
            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#121316]/60 border hairline-divider shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  <span>Scamalytics 欺诈风控雷达</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => handleProbeHealth(inspectorNode.name, e)}
                  disabled={healthUnavailable || probingNodes[inspectorNode.name] || probingAll}
                  className="text-[10px] text-purple-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50 font-mono"
                >
                  <RefreshCw className={`w-3 h-3 ${probingNodes[inspectorNode.name] ? "animate-spin" : ""}`} />
                  <span>{probingNodes[inspectorNode.name] ? "体检中" : "深度体检"}</span>
                </button>
              </div>

              {healthCache[inspectorNode.name]?.fraudScore != null ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      风险评分: <span className="font-mono">{healthCache[inspectorNode.name].fraudScore} / 100</span>
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border ${
                        healthCache[inspectorNode.name].fraudScore! <= 25
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : healthCache[inspectorNode.name].fraudScore! <= 60
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      }`}
                    >
                      {healthCache[inspectorNode.name].fraudScore! <= 25
                        ? "极佳 · 低风控纯净 IP"
                        : healthCache[inspectorNode.name].fraudScore! <= 60
                        ? "中度风控 · 存在拦截风险"
                        : "高危节点 · 机房封禁高发"}
                    </span>
                  </div>
                  {/* 风险条 */}
                  <div className="w-full h-1.5 rounded-full bg-white/10 dark:bg-white/[0.08] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        healthCache[inspectorNode.name].fraudScore! <= 25
                          ? "bg-emerald-500"
                          : healthCache[inspectorNode.name].fraudScore! <= 60
                          ? "bg-amber-500"
                          : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(5, healthCache[inspectorNode.name].fraudScore!))}%` }}
                    />
                  </div>
                  {/* 属性微标 */}
                  <div className="flex items-center gap-1.5 pt-1 text-[10px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-white/[0.04] border hairline-divider text-zinc-400">
                      {healthCache[inspectorNode.name].isResidential ? "🏡 原生家庭住宅宽带" : "🏢 机房数据中心 (DC)"}
                    </span>
                    {healthCache[inspectorNode.name].isBroadcast && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        广播 IP
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-3 space-y-1.5">
                  <p className="text-[11px] text-zinc-400">尚未为此节点检测出口 IP 纯净度与欺诈风险评分</p>
                  <button
                    type="button"
                    onClick={(e) => handleProbeHealth(inspectorNode.name, e)}
                    disabled={healthUnavailable || probingNodes[inspectorNode.name] || probingAll}
                    className="px-3 py-1 text-xs rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/30 font-semibold hover:bg-purple-500/25 transition cursor-pointer"
                  >
                    即刻体检此节点
                  </button>
                </div>
              )}
            </div>

            {/* 卡片 3：落地真实公网 IP 与 ASN 运营商 */}
            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#121316]/60 border hairline-divider shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] space-y-2">
              <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-sky-400" />
                <span>落地真实公网 IP 与运营商</span>
              </span>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between bg-black/5 dark:bg-white/[0.02] p-2 rounded-lg border hairline-divider">
                  <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    {healthCache[inspectorNode.name]?.ip || "未探测到出口 IP"}
                  </span>
                  {healthCache[inspectorNode.name]?.ip && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(healthCache[inspectorNode.name].ip)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition cursor-pointer"
                      title="复制 IP 地址"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copiedIp ? "已复制" : "复制"}</span>
                    </button>
                  )}
                </div>
                {healthCache[inspectorNode.name]?.asOrganization && (
                  <div className="text-[11px] text-zinc-400 flex items-center justify-between font-mono">
                    <span>运营商 / ASN:</span>
                    <span className="text-zinc-300 truncate max-w-[200px]" title={healthCache[inspectorNode.name].asOrganization}>
                      {healthCache[inspectorNode.name].asOrganization}
                      {healthCache[inspectorNode.name].asn ? ` (AS${healthCache[inspectorNode.name].asn})` : ""}
                    </span>
                  </div>
                )}
                {(healthCache[inspectorNode.name]?.city || healthCache[inspectorNode.name]?.country) && (
                  <div className="text-[11px] text-zinc-400 flex items-center justify-between font-mono">
                    <span>物理定位:</span>
                    <span className="text-zinc-300">
                      {[healthCache[inspectorNode.name].city, healthCache[inspectorNode.name].region, healthCache[inspectorNode.name].country].filter(Boolean).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 卡片 4：AI 与流媒体全息解锁探针矩阵 */}
            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#121316]/60 border hairline-divider shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>AI 与流媒体全息解锁探针</span>
                </span>
                <button
                  type="button"
                  onClick={handleRetestUnlocks}
                  disabled={testingUnlocks}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-sky-400 text-[10px] font-semibold border hairline-divider transition cursor-pointer disabled:opacity-50"
                  title="实时穿透检测当前节点对主流 AI 和流媒体服务的解锁能力"
                >
                  <RefreshCw className={`w-3 h-3 ${testingUnlocks ? "animate-spin" : ""}`} />
                  <span>{testingUnlocks ? "探测中..." : "重测探针"}</span>
                </button>
              </div>

              {testingUnlocks ? (
                <div className="py-6 text-center space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-sky-400 mx-auto" />
                  <p className="text-[11px] text-zinc-400">
                    正在穿透测试 OpenAI、Claude、YouTube、Netflix、Disney+ 等服务…
                  </p>
                </div>
              ) : inspectorUnlocks.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {inspectorUnlocks.map((item) => {
                    const isUnlocked = item.status === "unlocked";
                    const isRestricted = item.status === "restricted";
                    const isBlocked = item.status === "blocked";

                    return (
                      <div
                        key={item.id}
                        className="p-2 rounded-lg bg-black/5 dark:bg-white/[0.02] border hairline-divider flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-[11px]">
                              {item.name}
                            </span>
                            <span className="text-[9px] px-1 py-0.2 rounded font-mono text-zinc-400 bg-white/[0.04] border hairline-divider">
                              {item.category}
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-400 truncate mt-0.5" title={item.info}>
                            {item.info}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                              isUnlocked
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : isRestricted
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : isBlocked
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                : "bg-white/[0.04] text-zinc-400 border hairline-divider"
                            }`}
                          >
                            {isUnlocked ? "✓ 已解锁" : isRestricted ? "⚠ 受限" : isBlocked ? "✕ 阻断" : "失败"}
                          </span>
                          {item.latency_ms && (
                            <div className="text-[9px] font-mono text-zinc-400 mt-0.5">
                              {item.latency_ms}ms
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 rounded-xl border border-dashed hairline-divider space-y-2">
                  <p className="text-[11px] text-zinc-400">
                    点击右上角“重测探针”测试本节点对 OpenAI、Claude、YouTube、Netflix 等服务的真实解锁状态
                  </p>
                  <button
                    type="button"
                    onClick={handleRetestUnlocks}
                    className="px-3 py-1 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] transition cursor-pointer"
                  >
                    立即测试解锁能力
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 抽屉底部固定操作栏 */}
          <div className="p-4 border-t hairline-divider bg-white/80 dark:bg-[#08090a]/90 backdrop-blur-xl flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={activeNodeName === inspectorNode.name}
              onClick={() => {
                void handleSelectProxy(inspectorNode.name);
              }}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] ${
                activeNodeName === inspectorNode.name
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 cursor-default"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
              }`}
            >
              <Check className="w-4 h-4" />
              <span>{activeNodeName === inspectorNode.name ? "当前已是出站出口" : "设为当前活动出口"}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                handleIgnoreNode(inspectorNode.name, e);
                closeInspector();
              }}
              className="p-2.5 rounded-xl border hairline-divider bg-white/[0.04] hover:bg-rose-500/10 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
              title="忽略该节点并从大盘隐藏"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
