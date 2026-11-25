// ==========================================================================
// ProcWeaver src-next 出口代理节点大盘主容器
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 特性: 接入 IPpure 深度体检、订阅源切换、自建节点管理、测速端点自定义与隐藏管理
// ==========================================================================

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { EyeOff, Globe, Plus } from "lucide-react";
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
  switchGroupProxy,
  testSingleDelay,
  testGroupBatchDelay,
  getHealthCache,
  saveHealthCache,
  probeNodesHealthBatch,
  getIgnoredNodes,
  toggleIgnoreNode,
} from "../../services/proxyService";
import { PROFILE_CHANGED_EVENT } from "../../services/profileService";
import { parseNodeMeta, isAdOrInfoNode, isRealProxyNode } from "../../utils/nodeParser";
import { ProxiesToolbar } from "./ProxiesToolbar";
import { ProxyGroupHeader } from "./ProxyGroupHeader";
import { ProxyNodeCard } from "./ProxyNodeCard";

import { LocalNodeModal } from "./LocalNodeModal";
import { IgnoredNodesModal } from "./IgnoredNodesModal";

interface ProxiesViewProps {
  routingMode?: string;
  onShowNotice?: (msg: string) => void;
  onNavigateTab?: (tab: string) => void;
}

export const ProxiesView: React.FC<ProxiesViewProps> = ({ routingMode = "rule", onShowNotice, onNavigateTab }) => {
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

  // 1. 初始化拉取节点大盘数据
  const proxyLoad = useRef(0);
  const loadedGroupNames = useRef(new Set<string>());
  const loadData = useCallback(async () => {
    const request = ++proxyLoad.current;
    setIsLoading(true);
    try {
      const snap = await fetchProxiesData();
      if (request !== proxyLoad.current) return;
      setGroups(snap.groups);
      setProxies(snap.proxies);

      // 智能默认折叠策略：仅展开 Proxy / 手动选择 / 节点选择，其余专项分流策略组默认折叠保持清爽
      const previousGroupNames = loadedGroupNames.current;
      loadedGroupNames.current = new Set(snap.groups.map(({ name }) => name));
      setCollapsedGroups((previouslyCollapsed) => {
        const nextCollapsed = new Set<string>();
        for (const { name } of snap.groups) {
          const isMain = name === "PROXY" || name.includes("手动选择")
            || name.includes("节点选择") || name.includes("Proxy");
          const collapsed = previousGroupNames.has(name) ? previouslyCollapsed.has(name) : !isMain;
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
    return () => {
      ++proxyLoad.current;
      window.removeEventListener("netbox-profile-changed", handleProfileChange);
      window.removeEventListener(PROFILE_CHANGED_EVENT, handleProfileChange);
    };
  }, [loadData]);

  // 2. 预计算每个节点的富元数据 (地区、协议、倍率、延迟、是否广告)
  const parsedMetas = useMemo(() => {
    const map: Record<string, ParsedNodeMeta> = {};
    for (const [name, item] of Object.entries(proxies)) {
      map[name] = parseNodeMeta(item);
    }
    return map;
  }, [proxies]);

  // 3. 切换活动出站节点
  const handleSelectNode = async (groupName: string, nodeName: string) => {
    // 乐观即时更新当前 UI 选中态
    setGroups((prev) =>
      prev.map((g) => (g.name === groupName ? { ...g, now: nodeName } : g))
    );

    const ok = await switchGroupProxy(groupName, nodeName);
    if (ok) {
      if (onShowNotice) onShowNotice(`[${groupName}] 已切换出站节点: ${nodeName}`);
    } else {
      if (onShowNotice) onShowNotice(`切换出站节点失败: ${nodeName}`);
      loadData();
    }
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

  const allCollapsed = useMemo(() => {
    return groups.length > 0 && groups.every((g) => collapsedGroups.has(g.name));
  }, [groups, collapsedGroups]);

  const handleToggleAllCollapsed = () => {
    if (allCollapsed) {
      setCollapsedGroups(new Set());
    } else {
      setCollapsedGroups(new Set(groups.map((g) => g.name)));
    }
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

  // 辅助判断策略组是否为主手动出站选择组 (节点选择 / PROXY / PROXIES / 手动选择 等)
  const isMasterSelectorGroup = useCallback(
    (group: ProxyGroupItem): boolean => {
      const gType = (group.type || "").toLowerCase();
      if (gType !== "select" && gType !== "selector") {
        return false;
      }
      const name = group.name.trim();
      const nameUpper = name.toUpperCase();

      // 必须包含足够数量的真实出站代理节点，代表主力出站
      const realCount = group.all.filter((n) => {
        const p = proxies[n];
        return isRealProxyNode(p) && !ignoredNodes.has(n);
      }).length;

      const isBroad =
        totalAvailableNodes > 0 &&
        (realCount >= totalAvailableNodes * 0.4 || realCount >= Math.min(totalAvailableNodes, 5));

      if (!isBroad && totalAvailableNodes > 0) {
        return false;
      }

      // 名称命中主控特征词
      if (
        nameUpper === "PROXY" ||
        nameUpper === "PROXIES" ||
        nameUpper === "DEFAULT" ||
        name === "节点选择" ||
        name === "手动选择" ||
        name.includes("节点选择") ||
        name.includes("手动选择") ||
        name.includes("主节点") ||
        name.includes("主力节点") ||
        name.includes("核心节点")
      ) {
        return true;
      }

      return false;
    },
    [proxies, ignoredNodes, totalAvailableNodes]
  );

  // 仅保留面向用户且包含真实出站代理节点的策略组（排除内部自动化分流锚点 PW-*、本地方案*与无真实节点空组）
  // 方案 A 实施:
  // 1. 规则模式/直连模式下过滤隐藏内核保留的 GLOBAL 组
  // 2. 原生主组（如“节点选择”/“手动选择”）存在时，过滤隐藏系统底层注入的同构 PROXY 镜像组
  // 3. 用户硬性约束: 手动选择/proxy/PROXIES/节点选择 需要排第一位 (权重 100)
  const visibleGroups = useMemo(() => {
    if (totalAvailableNodes === 0) return [];

    // 1. 初步过滤：排除内部特定自动化组、无真实节点空组
    const baseCandidates = groups.filter((g) => {
      if (g.name.startsWith("PW-") || g.name.startsWith("本地方案")) {
        return false;
      }
      const realCount = g.all.filter((name) => {
        const item = proxies[name];
        return isRealProxyNode(item) && !ignoredNodes.has(name);
      }).length;
      return realCount > 0;
    });

    // 2. 识别原生业务主选择组 (排除系统注入的 PROXY 和内核 GLOBAL)
    const nativeMasterGroup = baseCandidates.find((g) => {
      const u = g.name.trim().toUpperCase();
      if (u === "PROXY" || u === "GLOBAL") return false;
      return isMasterSelectorGroup(g);
    });

    // 3. 模式与同构去重过滤
    const isGlobalMode = (currentMode || "").toLowerCase() === "global";
    const filtered = baseCandidates.filter((g) => {
      const u = g.name.trim().toUpperCase();

      // 在非全局模式下，隐藏内核保留的 GLOBAL 组
      if (u === "GLOBAL" && !isGlobalMode) {
        return false;
      }

      // 若原订阅中已存在原生业务主选择组（如“节点选择”），则隐藏底层注入的同构 PROXY 镜像组
      if (u === "PROXY" && nativeMasterGroup) {
        return false;
      }

      return true;
    });

    // 4. 严格排序权重：手动选择/proxy/PROXIES/节点选择 必须排第一 (权重 100)
    const getGroupWeight = (g: ProxyGroupItem): number => {
      const u = g.name.trim().toUpperCase();
      const name = g.name.trim();

      // 识别是否为主手动选择组
      let isMaster = false;
      if (nativeMasterGroup) {
        isMaster = g.name === nativeMasterGroup.name;
      } else {
        isMaster = u === "PROXY" || isMasterSelectorGroup(g);
      }

      // 核心要求: 手动选择/proxy/PROXIES/节点选择 需要排第一
      if (isMaster) {
        return 100;
      }

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
  }, [groups, proxies, ignoredNodes, totalAvailableNodes, currentMode, isMasterSelectorGroup]);

  const displayedGroups = visibleGroups
    .map((group) => ({ group, nodes: filterAndSortNodes(group.all) }))
    .filter(({ nodes }) => !searchQuery || nodes.length > 0);
  const hasNodes = totalAvailableNodes > 0 && visibleGroups.length > 0;

  return (
    <div className="workbench-view workbench-proxies">
      {hasNodes && (
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
          onOpenLocalNodeModal={() => setShowLocalNodeModal(true)}
          ignoredCount={ignoredNodes.size}
          onOpenIgnoredModal={() => setShowIgnoredModal(true)}
        />
      )}

      {isLoading ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)]" role="status">正在加载出口节点…</div>
      ) : !hasNodes ? (
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
          {displayedGroups.map(({ group, nodes }) => {
            const isCollapsed = collapsedGroups.has(group.name);
            const isTestingGroup = testingGroups.has(group.name);
            return (
              <section key={group.name} className="workbench-panel grid gap-3 p-3.5" aria-label={group.name}>
                <ProxyGroupHeader
                  group={group}
                  nodeCount={nodes.length}
                  isCollapsed={isCollapsed}
                  isTestingGroup={isTestingGroup}
                  isTestingGroupHealth={testingHealthGroups.has(group.name)}
                  onToggleCollapse={() => handleToggleCollapse(group.name)}
                  onTestGroup={(event) => handleTestGroup(group, event)}
                  onTestGroupHealth={(event) => handleTestGroupHealth(group, event)}
                />

                {!isCollapsed && (nodes.length === 0 ? (
                  <p className="p-4 text-center text-xs text-[var(--text-muted)]">未找到符合过滤条件的可用节点</p>
                ) : (
                  <div className="workbench-node-list" data-layout={viewMode}>
                    {viewMode === "list" && (
                      <div className="workbench-node-columns" aria-hidden="true">
                        <span>节点</span><span>协议</span><span>地区</span><span>健康与风控</span><span>延迟</span><span>状态</span><span />
                      </div>
                    )}
                    <div className="workbench-node-grid">
                      {nodes.map((nodeName) => {
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
                        return (
                          <ProxyNodeCard
                            key={nodeName}
                            meta={meta}
                            health={nodeHealthMap[nodeName]}
                            isSelected={group.now === nodeName}
                            isTesting={testingNodes.has(nodeName) || isTestingGroup || isTestingAll}
                            onSelect={() => handleSelectNode(group.name, nodeName)}
                            onTest={(event) => handleTestSingle(nodeName, event)}
                            onToggleIgnore={(event) => handleToggleIgnoreNode(nodeName, event)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <LocalNodeModal
        isOpen={showLocalNodeModal}
        onClose={() => setShowLocalNodeModal(false)}
        onNodesUpdated={loadData}
        onShowNotice={onShowNotice}
      />
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
