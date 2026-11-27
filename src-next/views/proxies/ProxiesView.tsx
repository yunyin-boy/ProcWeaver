// ==========================================================================
// ProcWeaver src-next 出口代理节点大盘主容器
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 特性: 接入 IPpure 深度体检、订阅源切换、自建节点管理、测速端点自定义与隐藏管理
// ==========================================================================

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChevronRight, EyeOff, Globe, Plus } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  ProxyGroupItem,
  ProxyItem,
  ParsedNodeMeta,
  NodeHealthResult,
  ProxySortMode,
  ProxyViewMode,
} from "../../types/proxy";
import {
  fetchProxiesData,
  selectGroupMember,
  testSingleDelay,
  testGroupBatchDelay,
  getHealthCache,
  saveHealthCache,
  probeNodesHealthBatch,
  getIgnoredNodes,
  toggleIgnoreNode,
} from "../../services/proxyService";
import { PROFILE_CHANGED_EVENT, notifyProfileChanged } from "../../services/profileService";
import { isTauriEnvironment } from "../../services/client";
import { fetchPolicyGroups, isManualGroup, savePolicyGroup, type PolicyGroup, type PolicyGroupChange,
  type PolicyGroupRow, type PolicyGroupWorkbench } from "../../services/policyGroupsService";
import { parseNodeMeta, isAdOrInfoNode, isRealProxyNode } from "../../utils/nodeParser";
import { ConfirmModal } from "../../primitives/ConfirmModal";
import { ProxiesToolbar } from "./ProxiesToolbar";
import { ProxyGroupHeader } from "./ProxyGroupHeader";
import { ProxyNodeCard } from "./ProxyNodeCard";

import { LocalNodeModal } from "./LocalNodeModal";
import { IgnoredNodesModal } from "./IgnoredNodesModal";
import { SpeedtestEndpointModal } from "./SpeedtestEndpointModal";
import { PolicyGroupEditor } from "./PolicyGroupEditor";
import { PolicyMemberCard, POLICY_ACTIONS, resolveGroupMember } from "./PolicyMemberCard";

interface ProxiesViewProps {
  routingMode?: string;
  coreRunning: boolean;
  onShowNotice?: (msg: string) => void;
  onNavigateTab?: (tab: string) => void;
}

const isNamedMainSelector = (group: ProxyGroupItem) => isManualGroup(group.type)
  && (/^(PROXY|PROXIES|DEFAULT|SELECT|MANUAL)$/i.test(group.name.trim())
    || /节点选择|手动选择|主节点|主力节点|核心节点/.test(group.name));

export const ProxiesView: React.FC<ProxiesViewProps> = ({ routingMode = "rule", coreRunning, onShowNotice, onNavigateTab }) => {
  const [currentMode, setCurrentMode] = useState<string>(routingMode);

  useEffect(() => {
    if (routingMode) {
      setCurrentMode(routingMode);
    }
  }, [routingMode]);

  useEffect(() => {
    const handleModeChanged = (e: any) => {
      if (e?.detail?.mode) {
        setCurrentMode(e.detail.mode);
      }
    };
    window.addEventListener("netbox-mode-changed", handleModeChanged);
    return () => window.removeEventListener("netbox-mode-changed", handleModeChanged);
  }, []);

  const [groups, setGroups] = useState<ProxyGroupItem[]>([]);
  const [proxies, setProxies] = useState<Record<string, ProxyItem>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [policy, setPolicy] = useState<PolicyGroupWorkbench | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [editingGroup, setEditingGroup] = useState<{ context: PolicyGroupWorkbench; group?: PolicyGroupRow } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<{ context: PolicyGroupWorkbench; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const selectingRef = useRef(false);
  const groupSections = useRef(new Map<string, HTMLElement>());
  const advancedGroupSection = useRef<HTMLDetailsElement>(null);

  // 搜索与排版过滤状态
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<ProxySortMode>("default");
  const [viewMode, setViewMode] = useState<ProxyViewMode>("grid");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // 测速状态集合 (Set 防抖互锁)
  const [testingNodes, setTestingNodes] = useState<Set<string>>(new Set());
  const [testingGroups, setTestingGroups] = useState<Set<string>>(new Set());
  const [isTestingAll, setIsTestingAll] = useState(false);

  // 健康体检状态 (IPpure: 测订阅源所有节点)
  const [nodeHealthMap, setNodeHealthMap] = useState<Record<string, NodeHealthResult>>(() => getHealthCache());
  const [isTestingHealth, setIsTestingHealth] = useState(false);
  const [healthProgress, setHealthProgress] = useState<{ current: number; total: number } | undefined>();
  const [testingHealthGroups, setTestingHealthGroups] = useState<Set<string>>(new Set());

  // 节点隐藏名单与本地自建弹窗
  const [ignoredNodes, setIgnoredNodes] = useState<Set<string>>(() => getIgnoredNodes());

  // 模态弹窗显隐控制
  const [showLocalNodeModal, setShowLocalNodeModal] = useState(false);
  const [showIgnoredModal, setShowIgnoredModal] = useState(false);
  const [showSpeedtestSettings, setShowSpeedtestSettings] = useState(false);

  // 1. 初始化拉取节点大盘数据
  const proxyLoad = useRef(0);
  const loadedGroups = useRef<{ profileId?: string; names: Set<string> }>({ names: new Set() });
  const loadData = useCallback(async (showLoading = true) => {
    const request = ++proxyLoad.current;
    if (showLoading) setIsLoading(true);
    try {
      const [snap, saved] = await Promise.all([fetchProxiesData(), fetchPolicyGroups().then(
        value => ({ value, error: "" }),
        reason => ({ value: null, error: reason instanceof Error ? reason.message : String(reason) }),
      )]);
      if (request !== proxyLoad.current) return;
      setGroups(snap.groups);
      setProxies(snap.proxies);
      setPolicy(saved.value);
      if (saved.error) setPolicyError(saved.error);

      const profileId = saved.value?.profileId ?? snap.activeProfile?.id;
      const previous = loadedGroups.current;
      loadedGroups.current = { profileId, names: new Set(snap.groups.map(({ name }) => name)) };
      setCollapsedGroups((previouslyCollapsed) => {
        const nextCollapsed = new Set<string>();
        for (const group of snap.groups) {
          const { name } = group;
          const isMain = name === "PROXY" || name === saved.value?.primarySelector
            || (!saved.value && isNamedMainSelector(group));
          const alreadyLoaded = previous.profileId === profileId && previous.names.has(name);
          const collapsed = alreadyLoaded ? previouslyCollapsed.has(name) : !isMain;
          if (collapsed) nextCollapsed.add(name);
        }
        return nextCollapsed;
      });

      setIgnoredNodes(getIgnoredNodes());
      setNodeHealthMap(getHealthCache());
    } finally {
      if (request === proxyLoad.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const handleProfileChange = () => {
      loadData();
    };
    window.addEventListener("netbox-profile-changed", handleProfileChange);
    window.addEventListener(PROFILE_CHANGED_EVENT, handleProfileChange);
    const subscription = isTauriEnvironment()
      ? listen("procweaver-policy-groups-changed", () => { void loadData(false); }).catch(() => undefined) : undefined;
    return () => {
      ++proxyLoad.current;
      window.removeEventListener("netbox-profile-changed", handleProfileChange);
      window.removeEventListener(PROFILE_CHANGED_EVENT, handleProfileChange);
      void subscription?.then(unlisten => unlisten?.());
    };
  }, [coreRunning, loadData]);

  // 2. 预计算每个节点的富元数据 (地区、协议、倍率、延迟、是否广告)
  const parsedMetas = useMemo(() => {
    const map: Record<string, ParsedNodeMeta> = {};
    for (const [name, item] of Object.entries(proxies)) {
      map[name] = parseNodeMeta(item);
    }
    return map;
  }, [proxies]);

  const handleSelectNode = async (groupName: string, nodeName: string) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setSelecting(true);
    setPolicyError("");
    try {
      await selectGroupMember(groupName, nodeName, policy?.profileId);
      await loadData(false);
      onShowNotice?.("「" + groupName + "」已选择「" + nodeName + "」");
    } catch (reason) {
      setPolicyError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      selectingRef.current = false;
      setSelecting(false);
    }
  };

  const saveGroup = async (context: PolicyGroupWorkbench, change: PolicyGroupChange) => {
    setPolicyError("");
    const saved = await savePolicyGroup(context, change);
    setPolicy(saved);
    notifyProfileChanged();
    window.dispatchEvent(new Event("netbox-route-changed"));
    onShowNotice?.(change.kind === "delete" ? "策略组已删除" : "策略组已保存");
  };

  const removeGroup = async () => {
    if (!deletingGroup || deleting) return;
    setDeleting(true);
    try {
      await saveGroup(deletingGroup.context, { kind: "delete", name: deletingGroup.name });
    } catch (reason) {
      setPolicyError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingGroup(null);
      setDeleting(false);
    }
  };

  const revealGroup = (name: string) => {
    setSearchQuery("");
    setCollapsedGroups(previous => {
      const next = new Set(previous);
      next.delete(name);
      return next;
    });
    requestAnimationFrame(() => {
      if (name === "PROXY" && advancedGroupSection.current) advancedGroupSection.current.open = true;
      groupSections.current.get(name)?.scrollIntoView({ block: "nearest" });
    });
  };

  // 4. 单节点测速
  const handleTestSingle = async (nodeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (testingNodes.has(nodeName)) return;

    setTestingNodes((prev) => new Set(prev).add(nodeName));
    try {
      const delay = await testSingleDelay(nodeName);
      setProxies((prev) => {
        const item = prev[nodeName];
        if (!item) return prev;
        const newHistory = [...(item.history || []), { time: new Date().toISOString(), delay }];
        return { ...prev, [nodeName]: { ...item, history: newHistory } };
      });
    } finally {
      setTestingNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeName);
        return next;
      });
    }
  };

  // 5. 策略组批量测速
  const handleTestGroup = async (group: ProxyGroupItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (testingGroups.has(group.name)) return;

    setTestingGroups((prev) => new Set(prev).add(group.name));
    try {
      const validNodes = group.all.filter((name) => {
        if (isAdOrInfoNode(name) || ignoredNodes.has(name)) return false;
        return isRealProxyNode(proxies[name]);
      });
      const results = await testGroupBatchDelay(group.name, validNodes, (node, delay) => {
        setProxies((prev) => {
          const item = prev[node];
          if (!item) return prev;
          const newHistory = [...(item.history || []), { time: new Date().toISOString(), delay }];
          return { ...prev, [node]: { ...item, history: newHistory } };
        });
      });

      const validCounts = Object.values(results).filter((d) => d > 0 && d < 2000).length;
      if (onShowNotice) {
        onShowNotice(`[${group.name}] 组测速完成: ${validCounts}/${validNodes.length} 个节点可用`);
      }
    } finally {
      setTestingGroups((prev) => {
        const next = new Set(prev);
        next.delete(group.name);
        return next;
      });
    }
  };

  // 6. 全量并发测速
  const handleTestAll = async () => {
    if (isTestingAll) return;
    setIsTestingAll(true);

    try {
      const allUniqueNodes = Array.from(new Set(groups.flatMap((g) => g.all))).filter(
        (name) => {
          if (isAdOrInfoNode(name) || ignoredNodes.has(name)) return false;
          return isRealProxyNode(proxies[name]);
        }
      );

      await testGroupBatchDelay("GLOBAL_ALL", allUniqueNodes, (node, delay) => {
        setProxies((prev) => {
          const item = prev[node];
          if (!item) return prev;
          const newHistory = [...(item.history || []), { time: new Date().toISOString(), delay }];
          return { ...prev, [node]: { ...item, history: newHistory } };
        });
      });
      if (onShowNotice) onShowNotice(`全量 ${allUniqueNodes.length} 个节点并发测速完成`);
    } finally {
      setIsTestingAll(false);
    }
  };

  // 7. 测健康功能：针对订阅源的所有节点批量并发体检 (IPpure 接口)
  const handleTestAllHealth = async () => {
    if (isTestingHealth) return;
    setIsTestingHealth(true);

    try {
      // 提取全订阅唯一出站真实代理节点 (严格排除信息广告、策略组与已隐藏节点)
      const allUniqueNodes = Array.from(new Set(groups.flatMap((g) => g.all))).filter(
        (name) => {
          if (isAdOrInfoNode(name) || ignoredNodes.has(name)) return false;
          return isRealProxyNode(proxies[name]);
        }
      );

      setHealthProgress({ current: 0, total: allUniqueNodes.length });

      const updated = await probeNodesHealthBatch(
        allUniqueNodes,
        (_node, health, completed, total) => {
          setHealthProgress({ current: completed, total });
          setNodeHealthMap((prev) => ({
            ...prev,
            [_node]: health,
          }));
        }
      );

      setNodeHealthMap(updated);
      saveHealthCache(updated);
      if (onShowNotice) {
        onShowNotice(`订阅源共 ${allUniqueNodes.length} 个节点 IPpure 深度体检已完成`);
      }
    } finally {
      setIsTestingHealth(false);
      setHealthProgress(undefined);
    }
  };

  // 8. 策略组单组测健康
  const handleTestGroupHealth = async (group: ProxyGroupItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (testingHealthGroups.has(group.name)) return;

    setTestingHealthGroups((prev) => new Set(prev).add(group.name));
    try {
      const targetNodes = group.all.filter((name) => {
        if (isAdOrInfoNode(name) || ignoredNodes.has(name)) return false;
        return isRealProxyNode(proxies[name]);
      });
      const updated = await probeNodesHealthBatch(targetNodes, (_node, health) => {
        setNodeHealthMap((prev) => ({
          ...prev,
          [_node]: health,
        }));
      });

      setNodeHealthMap((prev) => ({ ...prev, ...updated }));
      saveHealthCache({ ...getHealthCache(), ...updated });
      if (onShowNotice) {
        onShowNotice(`[${group.name}] 组已完成 ${targetNodes.length} 个节点体检`);
      }
    } finally {
      setTestingHealthGroups((prev) => {
        const next = new Set(prev);
        next.delete(group.name);
        return next;
      });
    }
  };

  // 9. 隐藏/忽略节点操作
  const handleToggleIgnoreNode = (nodeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isNowIgnored = toggleIgnoreNode(nodeName);
    setIgnoredNodes(getIgnoredNodes());
    if (onShowNotice) {
      onShowNotice(isNowIgnored ? `已隐藏节点: ${nodeName}` : `已恢复节点: ${nodeName}`);
    }
  };

  // 10. 折叠与展开控制
  const handleToggleCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };

  // 11. 节点智能过滤与排序算法 (广告、策略组、非真实节点直接过滤不显示)
  const filterAndSortNodes = useCallback(
    (nodeNames: string[]) => {
      // 1) 彻底过滤广告/信息节点、非真实出站节点与已隐藏节点
      let filtered = nodeNames.filter((name) => {
        if (isAdOrInfoNode(name)) return false;
        if (ignoredNodes.has(name)) return false;
        const item = proxies[name];
        if (!isRealProxyNode(item)) return false;
        return true;
      });

      // 2) 关键词多维度实时检索
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter((name) => {
          const meta = parsedMetas[name];
          if (!meta) return name.toLowerCase().includes(q);
          return (
            meta.rawName.toLowerCase().includes(q) ||
            meta.cleanName.toLowerCase().includes(q) ||
            meta.regionCode.toLowerCase().includes(q) ||
            meta.regionName.includes(q) ||
            meta.protocolBadge.toLowerCase().includes(q)
          );
        });
      }

      // 3) 多模态排序 (包含评估风控分升序)
      const sorted = [...filtered];
      if (sortMode === "delay-asc") {
        sorted.sort((a, b) => {
          const delayA = parsedMetas[a]?.latestDelay ?? 99999;
          const delayB = parsedMetas[b]?.latestDelay ?? 99999;
          const effA = delayA <= 0 ? 99999 : delayA;
          const effB = delayB <= 0 ? 99999 : delayB;
          return effA - effB;
        });
      } else if (sortMode === "fraud-asc") {
        // 按评估风控分由低到高 (0~100 越低越纯净，未探测排在末尾)
        sorted.sort((a, b) => {
          const scoreA = nodeHealthMap[a]?.fraudScore ?? 999;
          const scoreB = nodeHealthMap[b]?.fraudScore ?? 999;
          return scoreA - scoreB;
        });
      } else if (sortMode === "multiplier-asc") {
        sorted.sort((a, b) => {
          const multA = parsedMetas[a]?.multiplier ?? 1.0;
          const multB = parsedMetas[b]?.multiplier ?? 1.0;
          return multA - multB;
        });
      } else if (sortMode === "name-asc") {
        sorted.sort((a, b) => a.localeCompare(b, "zh-CN"));
      }

      return sorted;
    },
    [searchQuery, sortMode, parsedMetas, ignoredNodes, nodeHealthMap, proxies]
  );

  // 计算当前有效可用真实出站代理节点总数 (严格排除广告、内部策略组、内置直连/拒绝与已隐藏)
  const totalAvailableNodes = useMemo(() => {
    return Object.values(proxies).filter(
      (item) => isRealProxyNode(item) && !ignoredNodes.has(item.name)
    ).length;
  }, [proxies, ignoredNodes]);

  const definitions = useMemo(() => new Map(policy?.groups.map(group => [group.name, group])), [policy?.groups]);
  const entryLabels = useMemo(() => new Map(policy?.entries.map(entry => [entry.name, entry.label])), [policy?.entries]);
  const allGroups = useMemo(() => {
    const live = new Set(groups.map(group => group.name));
    const offline: ProxyGroupItem[] = (policy?.groups ?? []).filter(group => !live.has(group.name)).map(group => ({
      name: group.name,
      type: group.strategy === "select" ? "Selector" : "URLTest",
      now: "",
      all: [...group.members.filter(member => !group.missingMembers.includes(member)), ...group.automaticMembers],
    }));
    return [...groups, ...offline];
  }, [groups, policy?.groups]);
  const groupDetails = useMemo(() => new Map(allGroups.map(group => [group.name, group])), [allGroups]);
  const primaryName = policy ? policy.primarySelector : allGroups.find(group =>
    !group.hidden && !group.name.startsWith("PW-") && !group.name.startsWith("本地方案")
    && group.name !== "PROXY" && isNamedMainSelector(group))?.name
    ?? (groupDetails.has("PROXY") ? "PROXY" : null);
  const proxySelection = groupDetails.get("PROXY")?.now;
  const proxyFollowsMain = Boolean(primaryName && primaryName !== "PROXY" && proxySelection === primaryName);
  const proxyTitle = primaryName === "PROXY" ? "节点选择"
    : primaryName && proxySelection && !proxyFollowsMain ? "公共出口" : "PROXY";
  const displayName = (name: string) => name === "PROXY" ? proxyTitle : name;
  const label = (name: string) => POLICY_ACTIONS.get(name) ?? (name === "PROXY" ? proxyTitle : entryLabels.get(name)) ?? name;

  const visibleGroups = useMemo(() => {
    const isGlobalMode = currentMode.toLowerCase() === "global";
    const filtered = allGroups.filter(group =>
      !group.hidden && !group.name.startsWith("PW-") && !group.name.startsWith("本地方案")
      && (group.name !== "GLOBAL" || isGlobalMode));
    const getGroupWeight = (g: ProxyGroupItem): number => {
      const u = g.name.trim().toUpperCase();
      const name = g.name.trim();

      if (g.name === primaryName) return 100;
      if (g.name === "PROXY") return proxyFollowsMain ? 0 : 95;

      // 本地自建节点排第二
      if (name.includes("自建") || u.includes("CUSTOM") || u.includes("LOCAL")) {
        return 90;
      }

      // 自动优选 / 全量延迟测速主组
      if (
        name === "自动选择" ||
        name.includes("自动选择") ||
        name.includes("自动优选") ||
        u === "AUTO" ||
        u.includes("URLTEST") ||
        u.includes("FALLBACK")
      ) {
        return 80;
      }

      // 地区优选组 (香港、日本、台湾、美国、狮城、新加坡、韩国等)
      if (
        name.includes("香港") ||
        name.includes("日本") ||
        name.includes("台湾") ||
        name.includes("美国") ||
        name.includes("狮城") ||
        name.includes("新加坡") ||
        name.includes("韩国") ||
        name.includes("HK") ||
        name.includes("JP") ||
        name.includes("TW") ||
        name.includes("US") ||
        name.includes("SG") ||
        name.includes("KR")
      ) {
        return 70;
      }

      // 业务应用分流组 (电报通讯、OpenAI、YouTube、Netflix 等)
      if (
        name.includes("电报") ||
        name.includes("通讯") ||
        name.includes("Telegram") ||
        name.includes("OpenAI") ||
        name.includes("ChatGPT") ||
        name.includes("YouTube") ||
        name.includes("Netflix") ||
        name.includes("流媒体") ||
        name.includes("国外媒体") ||
        name.includes("微软") ||
        name.includes("苹果")
      ) {
        return 60;
      }

      // GLOBAL 全局组 (仅在全局模式下才会出现)
      if (u === "GLOBAL") {
        return 10;
      }

      return 50;
    };

    return [...filtered].sort((a, b) => getGroupWeight(b) - getGroupWeight(a));
  }, [allGroups, currentMode, primaryName, proxyFollowsMain]);

  const allCollapsed = visibleGroups.length > 0 && visibleGroups.every(group => collapsedGroups.has(group.name));
  const handleToggleAllCollapsed = () => {
    setCollapsedGroups(new Set(allCollapsed ? [] : visibleGroups.map(group => group.name)));
    if (advancedGroupSection.current) advancedGroupSection.current.open = allCollapsed;
  };

  const term = searchQuery.trim().toLowerCase();
  const displayedGroups = visibleGroups.map(group => ({
    group,
    nodes: filterAndSortNodes(group.all),
    choices: group.all.filter(name => !isRealProxyNode(proxies[name])
      && (groupDetails.has(name) || POLICY_ACTIONS.has(name))
      && !name.startsWith("PW-")
      && (!term || name.toLowerCase().includes(term) || label(name).toLowerCase().includes(term))),
  })).filter(({ group, nodes, choices }) => !term || nodes.length > 0 || choices.length > 0
    || group.name.toLowerCase().includes(term) || displayName(group.name).toLowerCase().includes(term));
  const hasGroups = visibleGroups.some(group => group.name !== "PROXY" || policy?.profileId !== "default"
    || policy.primarySelector === "PROXY" || totalAvailableNodes > 0 || definitions.size > 0);
  const groupVisible = new Set(visibleGroups.map(group => group.name));
  return (
    <div className="workbench-view workbench-proxies">
      {hasGroups && (
        <ProxiesToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          allCollapsed={allCollapsed}
          onToggleAllCollapsed={handleToggleAllCollapsed}
          isTestingAll={isTestingAll}
          onTestAll={handleTestAll}
          isTestingHealth={isTestingHealth}
          healthProgress={healthProgress}
          onTestAllHealth={handleTestAllHealth}
          totalNodes={totalAvailableNodes}
          onNewGroup={policy ? () => setEditingGroup({ context: policy }) : undefined}
          onSpeedtestSettings={() => setShowSpeedtestSettings(true)}
          onOpenLocalNodeModal={() => setShowLocalNodeModal(true)}
          ignoredCount={ignoredNodes.size}
          onOpenIgnoredModal={() => setShowIgnoredModal(true)}
        />
      )}

      {policyError && (
        <p role="alert" className="rounded-xl bg-[var(--workbench-danger-bg)] px-4 py-3 text-xs text-[var(--workbench-danger)]">{policyError}</p>
      )}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)]" role="status">正在加载出口节点…</div>
      ) : !hasGroups ? (
        <section className="workbench-panel flex flex-wrap items-start gap-4 px-5 py-6" aria-labelledby="proxy-empty-title">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--workbench-selected)] text-[var(--workbench-accent)]">
            <Globe size={21} aria-hidden="true" />
          </span>
          <div className="grid min-w-0 flex-1 gap-2">
            <h2 id="proxy-empty-title" className="workbench-panel-title">还没有可用的出口节点</h2>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">添加订阅源可以一次导入多个节点，也可以单独添加自建节点。</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                className="workbench-action workbench-action-primary"
                data-size="md"
                onClick={() => {
                  if (onNavigateTab) onNavigateTab("profiles");
                  else window.dispatchEvent(new CustomEvent("netbox-navigate-tab", { detail: "profiles" }));
                }}
              >
                前往订阅源管理
              </button>
              <button type="button" className="workbench-action workbench-action-ghost" data-size="md" onClick={() => setShowLocalNodeModal(true)}>
                <Plus size={15} aria-hidden="true" /> 添加自建节点
              </button>
              {policy && <button type="button" className="workbench-action" data-size="md" onClick={() => setEditingGroup({ context: policy })}>
                <Plus size={15} aria-hidden="true" /> 新建策略组
              </button>}
              {ignoredNodes.size > 0 && (
                <button type="button" className="workbench-action workbench-action-ghost" data-size="md" onClick={() => setShowIgnoredModal(true)}>
                  <EyeOff size={15} aria-hidden="true" /> 已隐藏 <span className="tabular-nums">{ignoredNodes.size}</span>
                </button>
              )}
            </div>
          </div>
        </section>
      ) : displayedGroups.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)]" role="status">没有匹配的出口节点</div>
      ) : (
        <div className="grid gap-5">
          {displayedGroups.map(({ group, nodes, choices }) => {
            const isCollapsed = collapsedGroups.has(group.name);
            const isTestingGroup = testingGroups.has(group.name);
            const definition = definitions.get(group.name);
            const selectable = !selecting && (policy?.running ?? true) && isManualGroup(group.type);
            const selected = group.now && resolveGroupMember(group.now, proxies);
            const currentLabel = group.now ? (isManualGroup(group.type) ? "已选 " : "当前 ") + label(group.now)
              + (selected !== group.now ? " · 当前 " + label(selected) : "") : undefined;
            const title = displayName(group.name);
            const nodeCards = isCollapsed ? [] : nodes.map(nodeName => {
              const meta = parsedMetas[nodeName] || {
                rawName: nodeName,
                cleanName: nodeName,
                regionCode: "GLB",
                regionName: "通用节点",
                multiplier: 1,
                protocolBadge: "PROXY",
                protocolColor: "text-[var(--text-muted)]",
                isAdOrInfo: false,
              };
              const localName = nodeName.startsWith("PW-L-") ? entryLabels.get(nodeName) : undefined;
              return (
                <ProxyNodeCard key={nodeName} layout={viewMode} meta={localName ? { ...meta, cleanName: localName } : meta}
                  health={nodeHealthMap[nodeName]} isSelected={group.now === nodeName}
                  isTesting={testingNodes.has(nodeName) || isTestingGroup || isTestingAll}
                  onSelect={selectable ? () => { void handleSelectNode(group.name, nodeName); } : undefined}
                  onTest={event => handleTestSingle(nodeName, event)}
                  onToggleIgnore={event => handleToggleIgnoreNode(nodeName, event)} />
              );
            });
            const panel = (
              <section key={group.name} className="workbench-panel grid gap-3 p-3.5" aria-label={title}
                ref={element => { if (element) groupSections.current.set(group.name, element); else groupSections.current.delete(group.name); }}>
                <ProxyGroupHeader
                  group={group}
                  displayName={title}
                  nodeCount={nodes.length + choices.length}
                  isCollapsed={isCollapsed}
                  isTestingGroup={isTestingGroup}
                  isTestingGroupHealth={testingHealthGroups.has(group.name)}
                  currentLabel={currentLabel}
                  custom={Boolean(definition)}
                  automaticCount={definition?.automatic ? definition.automaticMembers.length : undefined}
                  onEdit={definition && policy ? () => setEditingGroup({ context: policy, group: definition }) : undefined}
                  onDelete={definition && policy ? () => setDeletingGroup({ context: policy, name: group.name }) : undefined}
                  onToggleCollapse={() => handleToggleCollapse(group.name)}
                  onTestGroup={(event) => handleTestGroup(group, event)}
                  onTestGroupHealth={(event) => handleTestGroupHealth(group, event)}
                />

                {!isCollapsed && definition && (definition.missingMembers.length > 0 || definition.missingParents.length > 0) && (
                  <p role="status" className="break-all px-1 text-xs text-[var(--workbench-warning)]">
                    失效成员或上级组 · {[...definition.missingMembers, ...definition.missingParents].join("、")}
                  </p>
                )}
                {!isCollapsed && choices.length > 0 && (
                  <div className="workbench-policy-choices workbench-node-grid" role="group" aria-label="策略组与内置动作">
                    {choices.map(name => {
                      const child = groupDetails.get(name);
                      const physical = child?.now ? resolveGroupMember(child.now, proxies) : "";
                      return <PolicyMemberCard key={name} name={name} group={child} label={label(name)}
                        physical={physical ? label(physical) : undefined} delay={parsedMetas[physical]?.latestDelay}
                        selected={group.now === name} onSelect={selectable ? () => { void handleSelectNode(group.name, name); } : undefined}
                        onReveal={child && groupVisible.has(name) ? () => revealGroup(name) : undefined} />;
                    })}
                  </div>
                )}
                {!isCollapsed && nodes.length === 0 && choices.length === 0 && (
                  <p className="p-4 text-center text-xs text-[var(--text-muted)]">未找到符合过滤条件的可用成员</p>
                )}
                {nodeCards.length > 0 && (
                  <div className="workbench-node-results" data-layout={viewMode}>
                    {viewMode === "list" ? (
                      <table className="workbench-node-table" aria-label="出口节点">
                        <thead>
                          <tr>
                            <th scope="col">节点名称</th>
                            <th scope="col" className="workbench-node-table-protocol">协议</th>
                            <th scope="col" className="workbench-node-table-region">地区</th>
                            <th scope="col" className="workbench-node-table-health">健康与风控</th>
                            <th scope="col" className="workbench-node-table-latency">延迟</th>
                            <th scope="col" className="workbench-node-table-actions">操作</th>
                          </tr>
                        </thead>
                        <tbody>{nodeCards}</tbody>
                      </table>
                    ) : <div className="workbench-node-grid">{nodeCards}</div>}
                  </div>
                )}
              </section>
            );
            if (group.name !== "PROXY" || !proxyFollowsMain) return panel;
            return (
              <details key={"advanced:" + (policy?.profileId ?? group.name)} ref={advancedGroupSection}
                className="group/advanced" open={term ? true : undefined}>
                <summary className="workbench-panel flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={15} aria-hidden="true" className="group-open/advanced:rotate-90" />
                  高级策略组
                </summary>
                <div className="mt-3">{panel}</div>
              </details>
            );
          })}
        </div>
      )}

      {editingGroup && <PolicyGroupEditor context={editingGroup.context} liveContext={policy} current={editingGroup.group}
        onClose={() => setEditingGroup(null)} onSave={async (group: PolicyGroup) => {
          await saveGroup(editingGroup.context, { kind: editingGroup.group ? "update" : "create", group });
          setEditingGroup(null);
        }} />}
      {deletingGroup && <ConfirmModal isOpen title="删除策略组" description={deletingGroup.name}
        confirmText="删除策略组" isLoading={deleting} onConfirm={removeGroup}
        onCancel={() => { if (!deleting) setDeletingGroup(null); }} />}

      <LocalNodeModal
        isOpen={showLocalNodeModal}
        onClose={() => setShowLocalNodeModal(false)}
        onNodesUpdated={loadData}
        onShowNotice={onShowNotice}
      />
      <SpeedtestEndpointModal isOpen={showSpeedtestSettings} onClose={() => setShowSpeedtestSettings(false)}
        onEndpointChanged={() => { void loadData(false); }} onShowNotice={onShowNotice} />
      <IgnoredNodesModal
        isOpen={showIgnoredModal}
        onClose={() => setShowIgnoredModal(false)}
        onIgnoredUpdated={() => {
          setIgnoredNodes(getIgnoredNodes());
        }}
        onShowNotice={onShowNotice}
      />
    </div>
  );
};
