import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Unplug } from "lucide-react";
import { Button } from "../../primitives/Button";
import { ConfirmModal } from "../../primitives/ConfirmModal";
import { isTauriEnvironment } from "../../services/client";
import {
  MAX_CLOSED_CONNECTIONS,
  clearClosedConnections,
  fetchActiveConnections,
  formatBytes,
  formatConnectionRule,
  formatConnectionTarget,
  formatDuration,
  formatDurationMs,
  formatSpeed,
  getClosedConnections,
  getConnectionProcess,
  killAllConnections,
  killConnection,
} from "../../services/connectionsService";
import { fetchBundles } from "../../services/processRoutingService";
import type {
  ConnectionItem,
  ConnectionProtocolFilter,
  ConnectionSortField,
  ConnectionsSnapshot,
  ConnectionViewMode,
} from "../../types/connections";
import { ConnectionDetails } from "./ConnectionDetails";
import { ConnectionsToolbar } from "./ConnectionsToolbar";

const REFRESH_INTERVAL_MS = 1500;
const PAGE_SIZE = 40;
const EMPTY_CONNECTIONS: ConnectionItem[] = [];

interface ConnectionsViewProps {
  onShowNotice?: (msg: string) => void;
}

export const ConnectionsView: React.FC<ConnectionsViewProps> = ({ onShowNotice }) => {
  const [viewMode, setViewMode] = useState<ConnectionViewMode>("active");
  const [snapshot, setSnapshot] = useState<ConnectionsSnapshot>();
  const [history, setHistory] = useState(getClosedConnections);
  const [readFailed, setReadFailed] = useState(false);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [protocol, setProtocol] = useState<ConnectionProtocolFilter>("all");
  const [sortFields, setSortFields] = useState<Record<ConnectionViewMode, ConnectionSortField>>({ active: "downSpeed", history: "time" });
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null);
  const [bundleNames, setBundleNames] = useState<Map<string, string>>(() => new Map());
  const readInFlight = useRef<Promise<void> | null>(null);
  const disconnectInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    fetchBundles().then((bundles) => {
      if (!active) return;
      const encoder = new TextEncoder();
      setBundleNames(new Map(bundles.map(({ id, name }) => [
        Array.from(encoder.encode(id), (byte) => byte.toString(16).padStart(2, "0")).join(""),
        name,
      ])));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const chainLabel = useCallback((node: string) => {
    if (node.toUpperCase() === "DIRECT") return "DIRECT 直连";
    const match = /^PW-([0-9a-f]+)-(?:main|dns|entry)$/i.exec(node);
    if (!match) return node;
    const name = bundleNames.get(match[1].toLowerCase());
    return name ? "业务包 · " + name : "业务包专属插槽";
  }, [bundleNames]);

  const refreshConnections = useCallback(() => {
    if (disconnectInFlight.current) return Promise.resolve();
    if (readInFlight.current) return readInFlight.current;
    const request = fetchActiveConnections().then((next) => {
      setSnapshot(next);
      setHistory(getClosedConnections());
      setReadFailed(false);
    }).catch(() => {
      setReadFailed(true);
    }).finally(() => {
      readInFlight.current = null;
    });
    readInFlight.current = request;
    return request;
  }, []);

  useEffect(() => { void refreshConnections(); }, [refreshConnections]);

  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = window.setInterval(() => void refreshConnections(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAutoRefresh, refreshConnections]);

  const refreshNow = async () => {
    setIsRefreshing(true);
    try {
      await refreshConnections();
    } finally {
      setIsRefreshing(false);
    }
  };

  const activeConnections = snapshot?.connections ?? EMPTY_CONNECTIONS;
  const isActiveView = viewMode === "active";
  const source = isActiveView ? activeConnections : history;
  const sortField = sortFields[viewMode];
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const result = source.filter((connection) => {
      const { metadata, rulePayload, rule, chains } = connection;
      if (protocol !== "all" && metadata.network.toLowerCase() !== protocol) return false;
      return !keyword || [
        metadata.host, metadata.sourceIP, metadata.destinationIP, formatConnectionTarget(connection),
        getConnectionProcess(connection), metadata.processPath, rule, rulePayload, ...chains, ...chains.map(chainLabel),
      ].some((value) => value?.toLowerCase().includes(keyword));
    });

    if (sortField === "time") {
      return isActiveView
        ? result.sort((a, b) => (Date.parse(a.start) || Number.MAX_SAFE_INTEGER) - (Date.parse(b.start) || Number.MAX_SAFE_INTEGER))
        : result.sort((a, b) => (Date.parse(b.closedAt || b.start) || 0) - (Date.parse(a.closedAt || a.start) || 0));
    }
    const field = sortField === "downSpeed" ? "downloadSpeed" : sortField === "upSpeed" ? "uploadSpeed" : sortField;
    return result.sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1));
  }, [source, query, protocol, sortField, isActiveView, chainLabel]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(pageNumber, pages);
  const first = (currentPage - 1) * PAGE_SIZE;
  const listed = filtered.slice(first, first + PAGE_SIZE);
  const selected = selectedId && (source.find((connection) => connection.id === selectedId) || history.find((connection) => connection.id === selectedId));
  const hasFilter = Boolean(query.trim()) || protocol !== "all";
  const canDisconnect = !readFailed && pendingDisconnect === null;

  const disconnect = async (connection?: ConnectionItem) => {
    if (disconnectInFlight.current) return;
    disconnectInFlight.current = true;
    setPendingDisconnect(connection?.id ?? "all");
    try {
      const success = connection ? await killConnection(connection.id) : await killAllConnections();
      if (!success) throw new Error("connection close rejected");
      setSnapshot((previous) => previous && {
        ...previous,
        connections: connection ? previous.connections.filter(({ id }) => id !== connection.id) : [],
      });
      setHistory(getClosedConnections());
      setSelectedId((id) => connection && id !== connection.id ? id : null);
      if (!connection) setShowCloseAllConfirm(false);
      onShowNotice?.(connection ? "已断开连接 " + formatConnectionTarget(connection) : "已断开当前活跃连接");
    } catch {
      onShowNotice?.("断开连接失败，请刷新后重试。");
    } finally {
      disconnectInFlight.current = false;
      setPendingDisconnect(null);
    }
  };

  return (
    <div className="workbench-view workbench-connections">
      <ConnectionsToolbar
        viewMode={viewMode}
        onViewModeChange={(mode) => { setViewMode(mode); setPageNumber(1); setSelectedId(null); }}
        snapshot={snapshot}
        historyCount={history.length}
        isPreview={!isTauriEnvironment()}
        isAutoRefresh={isAutoRefresh}
        onAutoRefreshChange={(checked) => {
          setIsAutoRefresh(checked);
          if (checked) void refreshConnections();
        }}
        isRefreshing={isRefreshing}
        onRefresh={refreshNow}
        hasPendingDisconnect={pendingDisconnect !== null}
        canDisconnectAll={canDisconnect && activeConnections.length > 0}
        onDisconnectAll={() => setShowCloseAllConfirm(true)}
        onClearHistory={() => {
          clearClosedConnections();
          setHistory([]);
          setSelectedId(null);
          setPageNumber(1);
          onShowNotice?.("已清空历史连接");
        }}
        query={query}
        onQueryChange={(value) => { setQuery(value); setPageNumber(1); }}
        protocol={protocol}
        onProtocolChange={(value) => { setProtocol(value); setPageNumber(1); }}
        sortField={sortField}
        onSortChange={(field) => { setSortFields((current) => ({ ...current, [viewMode]: field })); setPageNumber(1); }}
      />

      {readFailed && (
        <p className="rounded-xl bg-[var(--workbench-warning-bg)] px-4 py-3 text-xs text-[var(--workbench-warning)]" role="status">
          {snapshot ? "连接刷新失败，当前显示上次采样。" : "读取连接失败，可手动刷新重试。"}
        </p>
      )}

      <section className="workbench-panel grid min-w-0 gap-2 p-3 sm:p-4" aria-label={isActiveView ? "活跃连接列表" : "历史连接列表"}>
        {isActiveView && !snapshot && !readFailed ? (
          <p className="workbench-connection-empty" role="status">正在读取活跃连接…</p>
        ) : listed.length === 0 ? (
          <div className="workbench-connection-empty">
            <p className="font-medium text-[var(--text-primary)]">
              {hasFilter ? "没有匹配的连接" : isActiveView
                ? readFailed && !snapshot ? "连接数据暂不可用" : "暂无活跃连接"
                : "暂无历史连接"}
            </p>
            {hasFilter && <p className="mt-1 text-xs">可清除搜索或切换协议。</p>}
            {!hasFilter && !isActiveView && <p className="mt-1 text-xs">采样检出的断开记录最多保留 {MAX_CLOSED_CONNECTIONS} 条。</p>}
          </div>
        ) : (
          <>
            {(hasFilter || pages > 1) && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 text-xs text-[var(--text-muted)]">
                <span>显示 {(first + 1).toLocaleString()}–{(first + listed.length).toLocaleString()} / {filtered.length.toLocaleString()} 条</span>
                {pages > 1 && (
                  <div className="flex items-center gap-2" role="group" aria-label="连接分页">
                    <Button type="button" size="sm" disabled={currentPage <= 1} onClick={() => setPageNumber(currentPage - 1)}>上一页</Button>
                    <span className="tabular-nums">{currentPage} / {pages}</span>
                    <Button type="button" size="sm" disabled={currentPage >= pages} onClick={() => setPageNumber(currentPage + 1)}>下一页</Button>
                  </div>
                )}
              </div>
            )}
            <div className="grid min-w-0 gap-1" role="table" aria-label={isActiveView ? "活跃连接" : "历史连接"}>
              <div className="workbench-connection-row workbench-connection-heading" role="row">
                <span role="columnheader">目标地址</span>
                <span role="columnheader">进程</span>
                <span role="columnheader">路由出口</span>
                <span role="columnheader">{isActiveView ? "传输速率" : "传输量"}</span>
                <span role="columnheader" className="sr-only">操作</span>
              </div>
              {listed.map((connection) => {
                const { id, metadata, start, closedAt } = connection;
                const target = formatConnectionTarget(connection);
                const process = getConnectionProcess(connection);
                const outlet = connection.chains[0] ? chainLabel(connection.chains[0]) : "—";
                const rule = formatConnectionRule(connection);
                const isClosing = pendingDisconnect === id;
                const time = isActiveView
                  ? "已连接 " + formatDuration(start)
                  : [closedAt ? new Date(closedAt).toLocaleTimeString() : "", formatDurationMs(connection.durationMs)].filter(Boolean).join(" · ");
                return (
                  <div className="workbench-connection-row" role="row" key={id} onClick={() => setSelectedId(id)}>
                    <div role="cell" className="workbench-connection-target min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedId(id)}
                        className="block min-w-0 max-w-full truncate rounded-sm text-left font-mono text-[13px] font-semibold"
                        aria-label={"查看 " + target + " 的连接详情"}
                        title={target}
                      >
                        {target}
                      </button>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                        {metadata.network && <span className="workbench-tag font-mono uppercase">{metadata.network}</span>}
                        <span className="truncate tabular-nums">{time}</span>
                      </div>
                    </div>
                    <div role="cell" className="workbench-connection-process grid min-w-0 gap-0.5">
                      <span className="truncate font-medium" title={metadata.processPath || process}>{process}</span>
                      {metadata.hookTier && metadata.hookTier !== "Direct" && (
                        <span className="truncate text-[11px] text-[var(--text-muted)]">Hook {metadata.hookTier === "Failed" ? "失败" : metadata.hookTier}</span>
                      )}
                    </div>
                    <div role="cell" className="workbench-connection-route grid min-w-0 gap-0.5">
                      <span className="truncate font-medium" title={outlet}>{outlet}</span>
                      {rule && <span className="truncate text-[11px] text-[var(--text-muted)]" title={rule}>{rule}</span>}
                    </div>
                    <div role="cell" className="workbench-connection-rates grid min-w-0 gap-0.5 font-mono text-[11px] tabular-nums">
                      <span className="flex min-w-0 items-center gap-1.5" aria-label={isActiveView ? "下载速率" : "下载量"}>
                        <ArrowDown size={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                        <span className="truncate">{isActiveView ? formatSpeed(connection.downloadSpeed) : formatBytes(connection.download)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[var(--text-muted)]" aria-label={isActiveView ? "上传速率" : "上传量"}>
                        <ArrowUp size={12} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{isActiveView ? formatSpeed(connection.uploadSpeed) : formatBytes(connection.upload)}</span>
                      </span>
                    </div>
                    <div role="cell" className="workbench-connection-action flex justify-end">
                      {isActiveView ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="!min-w-8 !px-2 hover:!bg-[var(--workbench-danger-bg)] hover:!text-[var(--workbench-danger)]"
                          onClick={(event) => { event.stopPropagation(); void disconnect(connection); }}
                          loading={isClosing}
                          disabled={!canDisconnect}
                          aria-label={"断开 " + target + " 的连接"}
                          title="断开连接"
                        >
                          {!isClosing && <Unplug size={14} aria-hidden="true" />}
                        </Button>
                      ) : <ChevronRight size={15} className="text-[var(--text-muted)]" aria-hidden="true" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {selected && (
        <ConnectionDetails
          connection={selected}
          chainLabels={[...selected.chains].reverse().map(chainLabel)}
          isDisconnecting={pendingDisconnect === selected.id}
          canDisconnect={canDisconnect}
          onClose={() => setSelectedId(null)}
          onDisconnect={() => void disconnect(selected)}
        />
      )}

      <ConfirmModal
        isOpen={showCloseAllConfirm}
        title="断开全部活跃连接？"
        description="核心当前处理的所有连接都将断开，正在进行的传输会中断。"
        confirmText="断开全部"
        isLoading={pendingDisconnect === "all"}
        onConfirm={() => disconnect()}
        onCancel={() => { if (!disconnectInFlight.current) setShowCloseAllConfirm(false); }}
      />
    </div>
  );
};
