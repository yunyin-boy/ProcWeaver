// ==========================================================================
// ProcWeaver src-next 链接追踪主盘视图 (Connections View - 活跃连接 & 历史连接)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill / impeccable-design
// 风格约束: 严禁任何 Emoji，全量内联细线 SVG，双模切片 (活跃连接 vs 历史连接)，等宽数字消除光渗
// ==========================================================================

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ConnectionItem,
  ConnectionProtocolFilter,
  ConnectionSortField,
  ConnectionViewMode,
} from "../../types/connections";
import {
  fetchActiveConnections,
  getClosedConnections,
  clearClosedConnections,
  killConnection,
  killAllConnections,
  formatBytes,
  formatSpeed,
  formatDuration,
  formatDurationMs,
} from "../../services/connectionsService";
import { isTauriEnvironment } from "../../services/client";
import { CustomSelect } from "../../primitives/CustomSelect";
import { fetchBundles } from "../../services/processRoutingService";

interface ConnectionsViewProps {
  onShowNotice?: (msg: string) => void;
}

export const ConnectionsView: React.FC<ConnectionsViewProps> = ({ onShowNotice }) => {
  // 核心视口模式: 活跃连接 vs 历史连接
  const [viewMode, setViewMode] = useState<ConnectionViewMode>("active");

  const [activeConnections, setActiveConnections] = useState<ConnectionItem[]>([]);
  const [closedConnections, setClosedConnections] = useState<ConnectionItem[]>([]);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [refreshIntervalMs] = useState(1500);

  // 搜索与过滤
  const [searchQuery, setSearchQuery] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ConnectionProtocolFilter>("all");
  const [sortField, setSortField] = useState<ConnectionSortField>("downSpeed");

  // 单项操作状态与详情抽屉
  const [closingIdMap, setClosingIdMap] = useState<Record<string, boolean>>({});
  const [selectedConnection, setSelectedConnection] = useState<ConnectionItem | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [isClosingAll, setIsClosingAll] = useState(false);

  // 业务规则包映射字典 (将底层 PW-{hex}-main 解密映射为友好中文业务包名称)
  const [bundleNameMap, setBundleNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchBundles()
      .then((bundles) => {
        const map: Record<string, string> = {};
        for (const b of bundles) {
          map[b.id] = b.name;
        }
        setBundleNameMap(map);
      })
      .catch(() => {});
  }, []);

  const formatChainNode = (node: string): string => {
    if (!node) return "DIRECT";
    if (node.startsWith("PW-")) {
      try {
        const hex = node.replace(/^PW-/, "").replace(/-(?:main|dns|entry)$/, "");
        let rawId = "";
        for (let i = 0; i < hex.length; i += 2) {
          rawId += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        if (bundleNameMap[rawId]) {
          return `业务包: ${bundleNameMap[rawId]}`;
        }
        return "业务包专属插槽";
      } catch {
        return "业务包专属插槽";
      }
    }
    return node;
  };

  // 轮询句柄
  const timerRef = useRef<any>(null);

  const loadData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const snap = await fetchActiveConnections();
      setActiveConnections(snap.connections);
      setClosedConnections(getClosedConnections());
      setDownloadTotal(snap.downloadTotal);
      setUploadTotal(snap.uploadTotal);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(false);
  }, []);

  // 自动轮询调度
  useEffect(() => {
    if (!isAutoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      loadData(true);
    }, refreshIntervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isAutoRefresh, refreshIntervalMs]);

  // 计算实时总下载速率与总上传速率
  const { currentDownSpeed, currentUpSpeed } = useMemo(() => {
    const down = activeConnections.reduce((acc, c) => acc + (c.downloadSpeed || 0), 0);
    const up = activeConnections.reduce((acc, c) => acc + (c.uploadSpeed || 0), 0);
    return { currentDownSpeed: down, currentUpSpeed: up };
  }, [activeConnections]);

  // 当前激活的数据源列表 (活跃连接 vs 历史连接)
  const sourceConnections = viewMode === "active" ? activeConnections : closedConnections;

  // 列表过滤与排序
  const filteredConnections = useMemo(() => {
    let result = sourceConnections;

    // 协议过滤
    if (protocolFilter !== "all") {
      result = result.filter(
        (c) => c.metadata.network.toLowerCase() === protocolFilter.toLowerCase()
      );
    }

    // 关键字搜索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((c) => {
        const host = c.metadata.host?.toLowerCase() || "";
        const proc = c.metadata.process?.toLowerCase() || "";
        const dstIp = c.metadata.destinationIP?.toLowerCase() || "";
        const rule = c.rulePayload?.toLowerCase() || "";
        const chains = c.chains.join(" ").toLowerCase();
        return (
          host.includes(q) ||
          proc.includes(q) ||
          dstIp.includes(q) ||
          rule.includes(q) ||
          chains.includes(q)
        );
      });
    }

    // 字段排序
    return [...result].sort((a, b) => {
      if (sortField === "download") return b.download - a.download;
      if (sortField === "upload") return b.upload - a.upload;
      if (sortField === "downSpeed") return (b.downloadSpeed || 0) - (a.downloadSpeed || 0);
      if (sortField === "upSpeed") return (b.uploadSpeed || 0) - (a.uploadSpeed || 0);
      if (sortField === "time") {
        return new Date(b.start).getTime() - new Date(a.start).getTime();
      }
      return 0;
    });
  }, [sourceConnections, protocolFilter, searchQuery, sortField]);

  // 切断单条连接
  const handleKillSingle = async (e: React.MouseEvent, conn: ConnectionItem) => {
    e.stopPropagation();
    setClosingIdMap((prev) => ({ ...prev, [conn.id]: true }));
    try {
      await killConnection(conn.id);
      setActiveConnections((prev) => prev.filter((c) => c.id !== conn.id));
      setClosedConnections(getClosedConnections());
      if (selectedConnection?.id === conn.id) {
        setSelectedConnection(null);
      }
      if (onShowNotice) {
        onShowNotice(`已切断来自 [${conn.metadata.process || conn.metadata.host}] 的连接`);
      }
    } finally {
      setClosingIdMap((prev) => ({ ...prev, [conn.id]: false }));
    }
  };

  // 切断全部活跃连接
  const handleKillAll = async () => {
    setIsClosingAll(true);
    try {
      await killAllConnections();
      setActiveConnections([]);
      setClosedConnections(getClosedConnections());
      setSelectedConnection(null);
      setShowCloseAllConfirm(false);
      if (onShowNotice) {
        onShowNotice("已切断当前所有活动网络连接");
      }
    } finally {
      setIsClosingAll(false);
    }
  };

  // 清空历史连接缓冲池
  const handleClearHistory = () => {
    clearClosedConnections();
    setClosedConnections([]);
    if (selectedConnection && viewMode === "history") {
      setSelectedConnection(null);
    }
    if (onShowNotice) {
      onShowNotice("已清空历史连接记录");
    }
  };

  const isTauri = isTauriEnvironment();

  return (
    <div className="space-y-4 pb-12">
      {/* ============================================================== */}
      {/* 区域 1: 顶栏遥测大盘与双模切片控制 (Telemetry & Segmented Bar) */}
      {/* ============================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* 活跃连接数卡片 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>活跃长连接</span>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
            {activeConnections.length}
            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">条</span>
          </div>
        </div>

        {/* 历史连接数卡片 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>历史已完成连接</span>
            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-xl font-bold font-mono text-blue-500 tabular-nums">
            {closedConnections.length}
            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">条</span>
          </div>
        </div>

        {/* 实时下行/上行速率 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>实时速率 (下/上)</span>
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <svg className="w-3 h-3 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </div>
          </div>
          <div className="text-sm sm:text-base font-bold font-mono tabular-nums flex items-baseline gap-1.5 truncate">
            <span className="text-emerald-500">{formatSpeed(currentDownSpeed)}</span>
            <span className="text-[var(--text-muted)] text-xs">/</span>
            <span className="text-sky-500 text-xs sm:text-sm">{formatSpeed(currentUpSpeed)}</span>
          </div>
        </div>

        {/* 累计传输流量 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="text-[11px] text-[var(--text-muted)]">累计吞吐量</div>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
            {formatBytes(downloadTotal + uploadTotal)}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 区域 2: 动作总控栏 (双模胶囊 + 搜索 + 过滤 + 排序 + 动作)     */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-2 rounded-2xl glass-surface border border-[var(--glass-border-subtle)]">
        {/* 左侧: 双模切换胶囊 (活跃连接 vs 历史连接) */}
        <div className="flex items-center p-1 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] shrink-0 select-none">
          <button
            type="button"
            onClick={() => setViewMode("active")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              viewMode === "active"
                ? "bg-blue-500 text-white shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${viewMode === "active" ? "bg-white" : "bg-emerald-500"}`} />
            <span>活跃连接</span>
            <span className="text-[10px] font-mono opacity-80 tabular-nums">
              ({activeConnections.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("history")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              viewMode === "history"
                ? "bg-blue-500 text-white shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>历史连接</span>
            <span className="text-[10px] font-mono opacity-80 tabular-nums">
              ({closedConnections.length})
            </span>
          </button>
        </div>

        {/* 中间: 宽幅搜索框 */}
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              viewMode === "active"
                ? "搜索活跃连接 (进程、目标域名、出口专线)..."
                : "搜索历史连接 (已关闭请求流水、耗时、规则)..."
            }
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-transparent focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
            >
              ×
            </button>
          )}
        </div>

        {/* 右侧控制组: 协议、排序、模式专属动作 (防折行挤压) */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* 协议筛选胶囊 */}
          <div className="flex items-center p-0.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[11px] font-mono">
            {(["all", "tcp", "udp"] as ConnectionProtocolFilter[]).map((proto) => (
              <button
                key={proto}
                type="button"
                onClick={() => setProtocolFilter(proto)}
                className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer uppercase ${
                  protocolFilter === proto
                    ? "bg-blue-500 text-white font-semibold shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {proto}
              </button>
            ))}
          </div>

          {/* 排序下拉 */}
          <div className="w-32">
            <CustomSelect
              value={sortField}
              onChange={(val) => setSortField(val as ConnectionSortField)}
              options={
                viewMode === "active"
                  ? [
                      { value: "downSpeed", label: "按下载速率" },
                      { value: "upSpeed", label: "按上传速率" },
                      { value: "download", label: "按总下载量" },
                      { value: "time", label: "按连接时长" },
                    ]
                  : [
                      { value: "time", label: "按完成时间" },
                      { value: "download", label: "按下载数据量" },
                      { value: "upload", label: "按上传数据量" },
                    ]
              }
              size="sm"
            />
          </div>

          {/* 活跃模式特有动作: 自动刷新 + 断开全部 */}
          {viewMode === "active" && (
            <>
              <button
                type="button"
                onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-xl border transition-all cursor-pointer whitespace-nowrap ${
                  isAutoRefresh
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 text-[var(--text-muted)]"
                }`}
                title={isAutoRefresh ? "实时跟踪中 (每1.5秒刷新)" : "已暂停更新"}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isAutoRefresh ? "bg-emerald-500" : "bg-zinc-400"}`} />
                <span>{isAutoRefresh ? "实时跟踪" : "已暂停"}</span>
              </button>

              <button
                type="button"
                disabled={activeConnections.length === 0}
                onClick={() => setShowCloseAllConfirm(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/20 hover:border-rose-500 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer whitespace-nowrap"
                title="一键切断当前全部连接"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>断开全部</span>
              </button>
            </>
          )}

          {/* 历史模式特有动作: 清空历史 */}
          {viewMode === "history" && (
            <button
              type="button"
              disabled={closedConnections.length === 0}
              onClick={handleClearHistory}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-xl border border-[var(--glass-border-subtle)] hover:border-rose-500/40 text-[var(--text-secondary)] hover:text-rose-500 bg-black/5 dark:bg-white/5 transition-all active:scale-95 disabled:opacity-40 cursor-pointer whitespace-nowrap"
              title="清空当前已记录的历史连接"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>清空历史</span>
            </button>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 区域 3: 高密度连接列表流 (活跃连接 / 历史连接)                 */}
      {/* ============================================================== */}
      <div className="space-y-1.5 min-h-[360px]">
        {isLoading && viewMode === "active" ? (
          <div className="p-12 text-center text-xs text-[var(--text-muted)] animate-pulse">
            正在从核心抓取活动网络连接与进程绑定状态...
          </div>
        ) : filteredConnections.length === 0 ? (
          <div className="p-12 text-center rounded-2xl glass-surface border border-dashed border-[var(--glass-border-subtle)] space-y-2">
            <svg className="w-8 h-8 mx-auto text-[var(--text-muted)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {viewMode === "active" ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              {viewMode === "active"
                ? "暂无符合条件的活跃连接"
                : "暂无历史连接记录"}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              {searchQuery
                ? "请尝试清空搜索条件或切换协议分类"
                : viewMode === "active"
                ? "当前系统网络空闲，发起网络请求后将在此实时跳动"
                : "当活跃连接传输完毕并关闭后，将自动在此沉淀流水，保留最多 500 条从容复盘"}
            </p>
          </div>
        ) : (
          filteredConnections.map((conn, index) => {
            const isClosing = closingIdMap[conn.id];
            const isSelected = selectedConnection?.id === conn.id;
            const proc = conn.metadata.process || "System";
            const host = conn.metadata.host || conn.metadata.destinationIP;
            const rulePayload = conn.rulePayload ? `[${conn.rulePayload}]` : "";
            // 核心修复：Mihomo 内核规范中 chains[0] 为实际发射流量的最终出站物理节点，chains[N-1] 为顶层策略组
            let chainStr =
              conn.chains && conn.chains.length > 0
                ? conn.chains[0]
                : "DIRECT";
            if (chainStr.startsWith("PW-")) {
              chainStr = formatChainNode(chainStr);
            }
            const hookTier = conn.metadata.hookTier || "Direct";

            return (
              <div
                key={conn.id}
                onClick={() => setSelectedConnection(conn)}
                className={`flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 p-2.5 px-3 rounded-2xl glass-surface border transition-all cursor-pointer group ${
                  isSelected
                    ? "border-blue-500/50 bg-blue-500/5 dark:bg-blue-950/20 shadow-md"
                    : "border-[var(--glass-border-subtle)] hover:border-blue-500/30"
                }`}
              >
                {/* 左列: 序号 + 协议 + 进程标识 + 目标域名/IP + 规则链路 */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] w-6 text-right shrink-0 tabular-nums">
                    #{index + 1}
                  </span>

                  {/* 协议与Hook标记 */}
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] uppercase">
                      {conn.metadata.network}
                    </span>
                    {hookTier !== "Direct" && (
                      <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-blue-500/10 text-blue-500 border border-blue-500/20">
                        {hookTier}
                      </span>
                    )}
                  </div>

                  {/* 核心信息行: 进程名 + 目标 + 出口 */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                        {proc}
                      </span>
                      <span className="text-[var(--text-muted)] text-[10px]">→</span>
                      <span
                        className="text-xs font-mono font-semibold text-blue-500 truncate"
                        title={`${host}:${conn.metadata.destinationPort}`}
                      >
                        {host}:{conn.metadata.destinationPort}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-muted)] truncate">
                      <span>规则: {conn.rule} {rulePayload}</span>
                      <span>·</span>
                      <span className="text-[var(--text-secondary)] font-medium">出口: {chainStr}</span>
                      <span>·</span>
                      {viewMode === "active" ? (
                        <span>已连接 {formatDuration(conn.start)}</span>
                      ) : (
                        <span className="text-zinc-400">
                          断开于 {conn.closedAt || "刚刚"} · 会话耗时 {formatDurationMs(conn.durationMs)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 右列: 传输指标 + 操作 (感知 viewMode) */}
                <div className="flex items-center gap-4 shrink-0 self-end md:self-auto">
                  {viewMode === "active" ? (
                    <>
                      {/* 活跃模式: 实时瞬时速率 */}
                      <div className="text-right font-mono text-[11px] tabular-nums min-w-[90px]">
                        <div className="text-emerald-500 font-bold flex items-center justify-end gap-1">
                          <span>↓</span>
                          <span>{formatSpeed(conn.downloadSpeed)}</span>
                        </div>
                        <div className="text-blue-500 text-[10px] flex items-center justify-end gap-1">
                          <span>↑</span>
                          <span>{formatSpeed(conn.uploadSpeed)}</span>
                        </div>
                      </div>

                      {/* 累计数据量 */}
                      <div className="text-right font-mono text-[10px] text-[var(--text-muted)] tabular-nums hidden sm:block min-w-[70px]">
                        <div>{formatBytes(conn.download)}</div>
                        <div>{formatBytes(conn.upload)}</div>
                      </div>

                      {/* 切断连接动作 */}
                      <button
                        type="button"
                        disabled={isClosing}
                        onClick={(e) => handleKillSingle(e, conn)}
                        className="p-1.5 rounded-xl hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-500 transition-colors disabled:opacity-50 cursor-pointer"
                        title="立即切断此网络连接"
                      >
                        <svg className={`w-3.5 h-3.5 ${isClosing ? "animate-spin text-rose-500" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* 历史模式: 传输总体积 + 会话耗时 */}
                      <div className="text-right font-mono text-[11px] tabular-nums min-w-[100px]">
                        <div className="text-[var(--text-primary)] font-semibold">
                          总计 {formatBytes(conn.download + conn.upload)}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          耗时 {formatDurationMs(conn.durationMs)}
                        </div>
                      </div>

                      {/* 历史连接查看详情指示徽标 */}
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-black/5 dark:bg-white/10 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:bg-blue-500/10 group-hover:text-blue-500 transition-colors">
                        查看详情 →
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ============================================================== */}
      {/* 区域 4: 连接详情侧边浮层抽屉 (Detail Drawer - 双模通用)        */}
      {/* ============================================================== */}
      {selectedConnection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedConnection(null)}
        >
          <div
            className="w-full max-w-md h-full glass-surface border-l border-[var(--glass-border-medium)] p-5 overflow-y-auto space-y-4 shadow-2xl animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶栏: 标题与关闭 */}
            <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-xl bg-blue-500/10 text-blue-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <div>
                  <h4 className="text-xs font-bold text-[var(--text-primary)]">
                    {viewMode === "active" ? "活动网络连接详情" : "历史连接审计详情"}
                  </h4>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    ID: {selectedConnection.id}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedConnection(null)}
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 核心元数据条目 */}
            <div className="space-y-3 text-xs">
              {/* 发起进程与路径 */}
              <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[10px] font-semibold text-[var(--text-muted)]">发起进程</div>
                <div className="font-mono font-bold text-[var(--text-primary)]">
                  {selectedConnection.metadata.process || "未知进程"}
                </div>
                {selectedConnection.metadata.processPath && (
                  <div className="text-[10px] font-mono text-[var(--text-muted)] break-all">
                    {selectedConnection.metadata.processPath}
                  </div>
                )}
              </div>

              {/* 源与目标地址 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1">
                  <div className="text-[10px] font-semibold text-[var(--text-muted)]">本地源地址</div>
                  <div className="font-mono text-[11px] text-[var(--text-primary)]">
                    {selectedConnection.metadata.sourceIP}:{selectedConnection.metadata.sourcePort}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1">
                  <div className="text-[10px] font-semibold text-[var(--text-muted)]">目标地址</div>
                  <div className="font-mono text-[11px] text-blue-500 break-all">
                    {selectedConnection.metadata.host || selectedConnection.metadata.destinationIP}:
                    {selectedConnection.metadata.destinationPort}
                  </div>
                </div>
              </div>

              {/* 路由分流链 */}
              <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1.5">
                <div className="text-[10px] font-semibold text-[var(--text-muted)]">出站路由策略链</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[...selectedConnection.chains].reverse().map((node, i, arr) => (
                    <React.Fragment key={`${node}-${i}`}>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-blue-500/10 text-blue-500 border border-blue-500/20 font-semibold">
                        {formatChainNode(node)}
                      </span>
                      {i < arr.length - 1 && (
                        <span className="text-[var(--text-muted)] text-[10px]">→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* 流量与速率 */}
              <div className="grid grid-cols-2 gap-2 text-center font-mono">
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1">
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">下行下载总量</div>
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatBytes(selectedConnection.download)}
                  </div>
                  {viewMode === "active" && (
                    <div className="text-[10px] text-[var(--text-muted)]">
                      实时: {formatSpeed(selectedConnection.downloadSpeed)}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 space-y-1">
                  <div className="text-[10px] text-blue-500">上行上传总量</div>
                  <div className="text-sm font-bold text-blue-500">
                    {formatBytes(selectedConnection.upload)}
                  </div>
                  {viewMode === "active" && (
                    <div className="text-[10px] text-[var(--text-muted)]">
                      实时: {formatSpeed(selectedConnection.uploadSpeed)}
                    </div>
                  )}
                </div>
              </div>

              {/* 连接时间与附加属性 */}
              <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1 text-[10px] font-mono text-[var(--text-muted)]">
                <div>建立时间: {new Date(selectedConnection.start).toLocaleString()}</div>
                {selectedConnection.closedAt && (
                  <div>结束时间: {selectedConnection.closedAt}</div>
                )}
                <div>
                  持续时长:{" "}
                  {selectedConnection.durationMs
                    ? formatDurationMs(selectedConnection.durationMs)
                    : formatDuration(selectedConnection.start)}
                </div>
                <div>入站通道: {selectedConnection.metadata.inboundName || "windivert"}</div>
                {selectedConnection.metadata.dnsMode && (
                  <div>DNS 策略: {selectedConnection.metadata.dnsMode}</div>
                )}
              </div>
            </div>

            {/* 底部操作: 仅活跃模式支持切断 */}
            {viewMode === "active" && (
              <div className="pt-2 border-t border-[var(--glass-border-subtle)]">
                <button
                  type="button"
                  onClick={(e) => handleKillSingle(e, selectedConnection)}
                  className="w-full py-2 rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white text-xs font-semibold shadow-md shadow-rose-500/20 transition-all cursor-pointer"
                >
                  切断此连接
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 确认切断全部连接模态弹窗                                      */}
      {/* ============================================================== */}
      {showCloseAllConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setShowCloseAllConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl glass-surface border border-[var(--glass-border-medium)] p-5 space-y-3 shadow-2xl text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 text-rose-500">
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">
                切断当前全部连接？
              </h4>
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              此操作将向核心发送指令，强制切断当前全部 {activeConnections.length} 条活动网络会话。正在进行的短请求或长连接将被断开重连。
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border-subtle)]">
              <button
                type="button"
                onClick={() => setShowCloseAllConfirm(false)}
                className="px-3.5 py-1 text-xs font-semibold rounded-xl border border-[var(--glass-border-subtle)] text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isClosingAll}
                onClick={handleKillAll}
                className="px-4 py-1 text-xs font-semibold rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white shadow-md shadow-rose-500/20 transition-all cursor-pointer"
              >
                {isClosingAll ? "切断中..." : "确认切断全部"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部数据源状态指示 */}
      <div className="flex items-center justify-between px-1 pt-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--glass-border-subtle)] font-mono select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>
            {viewMode === "active"
              ? `活跃追踪: 轮询采样间隔 ${refreshIntervalMs}ms`
              : "历史连接: 会话闭环 Diff 自动沉淀 (最大保留 500 条)"}
          </span>
        </div>

        <div>
          {isTauri ? (
            <span className="text-emerald-500 font-semibold">● Tauri 原生内核实时抓取</span>
          ) : (
            <span className="text-amber-500/80">○ 浏览器前端仿真模拟模式</span>
          )}
        </div>
      </div>
    </div>
  );
};
