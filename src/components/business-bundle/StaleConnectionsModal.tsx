import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Zap,
  Clock,
  ShieldAlert,
  X,
  ChevronDown,
  ChevronRight,
  Globe,
  CheckSquare,
  Square,
  HelpCircle,
} from "lucide-react";
import type { BundleLocalInstance } from "../../types/businessBundle";

export interface StaleTcpConnectionItem {
  pid: number;
  processName: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  isTarget?: boolean;
  targetCategory?: string;
  destinationLabel?: string;
}

interface Props {
  isOpen: boolean;
  instance: BundleLocalInstance | null;
  connections: StaleTcpConnectionItem[];
  onConfirmReset: (selectedConnections: StaleTcpConnectionItem[], rememberChoice: boolean) => void;
  onIgnore: () => void;
  onClose: () => void;
}

function getConnKey(c: StaleTcpConnectionItem): string {
  return `${c.pid}:${c.localPort}->${c.remoteAddress}:${c.remotePort}`;
}

export const StaleConnectionsModal: React.FC<Props> = ({
  isOpen,
  instance,
  connections,
  onConfirmReset,
  onIgnore,
  onClose,
}) => {
  const [remember, setRemember] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [expandedPids, setExpandedPids] = useState<Set<number>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // 弹窗打开或连接列表变化时，执行智能预选
  useEffect(() => {
    if (!isOpen || connections.length === 0) {
      setSelectedKeys(new Set());
      setExpandedPids(new Set());
      return;
    }

    // 默认智能策略：优先勾选海外/Fake-IP 业务目标 (isTarget !== false)
    const targetKeys = connections
      .filter((c) => c.isTarget !== false)
      .map(getConnKey);

    if (targetKeys.length > 0) {
      setSelectedKeys(new Set(targetKeys));
    } else {
      // 若均为非目标连接，默认全部勾选供用户自主选择
      setSelectedKeys(new Set(connections.map(getConnKey)));
    }

    // 默认展开所有存在连接的进程
    const initialPids = new Set(connections.map((c) => c.pid));
    setExpandedPids(initialPids);
  }, [isOpen, connections]);

  if (!isOpen || !instance) return null;

  const def = instance.definition;

  // 聚合进程与连接明细
  const processGroupMap = useMemo(() => {
    const map = new Map<
      number,
      {
        pid: number;
        name: string;
        conns: StaleTcpConnectionItem[];
        targetCount: number;
        domesticCount: number;
      }
    >();

    for (const c of connections) {
      let group = map.get(c.pid);
      if (!group) {
        group = {
          pid: c.pid,
          name: c.processName,
          conns: [],
          targetCount: 0,
          domesticCount: 0,
        };
        map.set(c.pid, group);
      }
      group.conns.push(c);
      if (c.isTarget !== false) {
        group.targetCount += 1;
      } else {
        group.domesticCount += 1;
      }
    }
    return Array.from(map.values());
  }, [connections]);

  const totalCount = connections.length;
  const targetCount = connections.filter((c) => c.isTarget !== false).length;
  const domesticCount = totalCount - targetCount;
  const selectedCount = selectedKeys.size;

  const togglePidExpand = (pid: number) => {
    setExpandedPids((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedKeys.size === totalCount) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(connections.map(getConnKey)));
    }
  };

  const selectOnlyTargets = () => {
    const targetKeys = connections
      .filter((c) => c.isTarget !== false)
      .map(getConnKey);
    setSelectedKeys(new Set(targetKeys));
  };

  const toggleConnectionKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleProcessAllConnections = (conns: StaleTcpConnectionItem[]) => {
    const keys = conns.map(getConnKey);
    const allSelected = keys.every((k) => selectedKeys.has(k));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        keys.forEach((k) => next.delete(k));
      } else {
        keys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const selectedConns = connections.filter((c) => selectedKeys.has(getConnKey(c)));
      await onConfirmReset(selectedConns, remember);
    } finally {
      setIsResetting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans animate-in fade-in duration-150"
      data-no-drag
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[88vh] overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/70">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>存量长连接热刷新与目标感知</span>
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full bg-slate-200/60 dark:bg-slate-800">
                  {def.packageName}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                检测到管辖应用存在开启前已建立的直连长连接
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 统计提示条与预选切换 */}
        <div className="px-5 py-2.5 bg-slate-100/60 dark:bg-slate-800/40 border-b border-slate-200/50 dark:border-slate-800/50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span>发现 <strong>{totalCount}</strong> 条存量连接：</span>
            {targetCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
                {targetCount} 海外业务目标
              </span>
            )}
            {domesticCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                {domesticCount} 国内直连保留
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={selectOnlyTargets}
              className="text-[11px] px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
              title="仅勾选海外和代理相关连接，保留国内大文件下载等连接"
            >
              仅选海外目标
            </button>
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-[11px] px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              {selectedKeys.size === totalCount ? "取消全选" : "全选"}
            </button>
          </div>
        </div>

        {/* 进程与连接列表区域 (支持滚动与折叠) */}
        <div className="p-5 overflow-y-auto space-y-3.5 flex-1">
          <div className="space-y-2">
            {processGroupMap.map((group) => {
              const isExpanded = expandedPids.has(group.pid);
              const groupKeys = group.conns.map(getConnKey);
              const isAllGroupSelected = groupKeys.every((k) => selectedKeys.has(k));
              const isSomeGroupSelected =
                !isAllGroupSelected && groupKeys.some((k) => selectedKeys.has(k));

              return (
                <div
                  key={group.pid}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 overflow-hidden"
                >
                  {/* 进程主条目 */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-white dark:bg-slate-800/70 select-none">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleProcessAllConnections(group.conns)}
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer shrink-0"
                      >
                        {isAllGroupSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        ) : isSomeGroupSelected ? (
                          <div className="w-4 h-4 rounded bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                            -
                          </div>
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>

                      <div className="flex items-center gap-2 font-mono text-xs text-slate-800 dark:text-slate-200 truncate">
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {group.name}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          (PID: {group.pid})
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-[10px] font-mono">
                        {group.targetCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                            {group.targetCount} 海外
                          </span>
                        )}
                        {group.domesticCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400">
                            {group.domesticCount} 国内
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => togglePidExpand(group.pid)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        title={isExpanded ? "收起连接明细" : "展开连接明细"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 展开的连接明细列表 */}
                  {isExpanded && (
                    <div className="p-2 pt-1 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                      {group.conns.map((conn) => {
                        const key = getConnKey(conn);
                        const isSelected = selectedKeys.has(key);
                        const isTarget = conn.isTarget !== false;

                        return (
                          <div
                            key={key}
                            onClick={() => toggleConnectionKey(key)}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40"
                                : "bg-white/80 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 hover:bg-slate-100/50 dark:hover:bg-slate-800/60"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleConnectionKey(key)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 shrink-0"
                              />

                              <div className="flex items-center gap-1.5 truncate text-slate-700 dark:text-slate-300">
                                <span className="text-slate-400 dark:text-slate-500">
                                  :{conn.localPort}
                                </span>
                                <span className="text-slate-400">→</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {conn.remoteAddress}:{conn.remotePort}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                              {isTarget ? (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-sans">
                                  <Globe className="w-2.5 h-2.5" />
                                  <span>{conn.destinationLabel || "海外业务目标"}</span>
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-sans">
                                  {conn.destinationLabel || "国内直连通道"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-200 font-semibold mb-0.5">
              <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
              <span>目标感知原理解析：</span>
            </div>
            已通过智能启发式网络目标分类，自动将 <strong>海外业务连接</strong> 与 <strong>国内直连下载</strong> 区分。
            执行微秒热刷新仅重置所选连接，<strong>无须关闭应用</strong>，应用将在 0.1 秒内自动重连切入代理，同时国内下载任务不受影响。
          </div>

          {/* 记住选择 */}
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600"
            />
            <span>记住此规则包选择，下次切换出口时按选定模式自动热刷新</span>
          </label>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            已勾选 <strong className="text-indigo-600 dark:text-indigo-400">{selectedCount}</strong> / {totalCount} 条连接
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onIgnore}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>稍后处理 (仅新连接生效)</span>
            </button>
            <button
              type="button"
              disabled={isResetting || selectedCount === 0}
              onClick={handleReset}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>
                {isResetting
                  ? "正在重置..."
                  : `立即微秒热刷新 (${selectedCount} 条)`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
