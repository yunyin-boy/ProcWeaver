// ==========================================================================
// ProcWeaver src-next 实时内核日志主盘视图 (Logs View - 方案 A 一级独立视口)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill / impeccable-design
// 风格约束: 严禁任何 Emoji，全量内联细线 SVG，沉浸式极客终端等宽排版，无断字折行
// ==========================================================================

import React, { useState, useEffect, useMemo, useRef } from "react";
import { LogEntry, LogLevel } from "../../types/logs";
import {
  getSnapshotLogs,
  subscribeLogs,
  initLogsStream,
  clearLogs,
  exportLogsText,
  MAX_LOG_BUFFER_SIZE,
} from "../../services/logsService";
import { isTauriEnvironment } from "../../services/client";

interface LogsViewProps {
  controllerPort?: number;
  onShowNotice?: (msg: string) => void;
}

export const LogsView: React.FC<LogsViewProps> = ({
  controllerPort = 9090,
  onShowNotice,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>(() => getSnapshotLogs());
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [selectedLevel, setSelectedLevel] = useState<LogLevel>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  // 初始化订阅与 WebSocket 管道
  useEffect(() => {
    const unsubStream = initLogsStream(controllerPort, undefined, (status) => {
      setWsStatus(status);
    });

    const unsubLogs = subscribeLogs(() => {
      if (!isPaused) {
        setLogs(getSnapshotLogs());
      }
    });

    return () => {
      unsubStream();
      unsubLogs();
    };
  }, [controllerPort, isPaused]);

  // 自动滚动到底部逻辑
  useEffect(() => {
    if (autoScroll && terminalRef.current && !isUserScrollingRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 统计指标
  const { errorCount, warnCount, infoCount, debugCount } = useMemo(() => {
    let err = 0;
    let warn = 0;
    let inf = 0;
    let deb = 0;
    for (const l of logs) {
      if (l.level === "error") err++;
      else if (l.level === "warning") warn++;
      else if (l.level === "info") inf++;
      else if (l.level === "debug") deb++;
    }
    return { errorCount: err, warnCount: warn, infoCount: inf, debugCount: deb };
  }, [logs]);

  // 过滤后的日志列表
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (selectedLevel !== "all") {
      result = result.filter((l) => l.level === selectedLevel);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((l) => l.payload.toLowerCase().includes(q));
    }

    return result;
  }, [logs, selectedLevel, searchQuery]);

  // 复制单行日志
  const handleCopyLine = (entry: LogEntry) => {
    const text = `[${entry.time}] [${entry.level.toUpperCase()}] ${entry.payload}`;
    navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    if (onShowNotice) {
      onShowNotice("已复制该行日志到剪贴板");
    }
    setTimeout(() => {
      setCopiedId((prev) => (prev === entry.id ? null : prev));
    }, 1500);
  };

  // 导出全部过滤后日志
  const handleExport = () => {
    if (filteredLogs.length === 0) return;
    exportLogsText(filteredLogs);
    if (onShowNotice) {
      onShowNotice(`已导出 ${filteredLogs.length} 条日志到文本文件`);
    }
  };

  // 清空日志池
  const handleClear = () => {
    clearLogs();
    setLogs([]);
    if (onShowNotice) {
      onShowNotice("已清空全局日志记录");
    }
  };

  // 手动滚动事件监听
  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  };

  // 等级色彩渲染辅助
  const renderLevelBadge = (level: string) => {
    switch (level) {
      case "error":
        return (
          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-500 border border-rose-500/25 shrink-0 uppercase">
            ERR
          </span>
        );
      case "warning":
        return (
          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-500 border border-amber-500/25 shrink-0 uppercase">
            WARN
          </span>
        );
      case "debug":
        return (
          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-zinc-500/15 text-zinc-400 border border-zinc-500/25 shrink-0 uppercase">
            DBG
          </span>
        );
      case "info":
      default:
        return (
          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-blue-500/15 text-blue-500 border border-blue-500/25 shrink-0 uppercase">
            INFO
          </span>
        );
    }
  };

  const isTauri = isTauriEnvironment();

  return (
    <div className="space-y-4 pb-12">
      {/* ============================================================== */}
      {/* 区域 1: 顶栏状态与指标概览 (Logs Header Cards)                  */}
      {/* ============================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* 日志流通道状态 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>日志管道状态</span>
            <span
              className={`h-2 w-2 rounded-full ${
                wsStatus === "connected"
                  ? "bg-emerald-500 animate-pulse"
                  : wsStatus === "connecting"
                  ? "bg-amber-500 animate-spin"
                  : "bg-rose-500"
              }`}
            />
          </div>
          <div className="text-sm font-bold font-mono text-[var(--text-primary)]">
            {wsStatus === "connected"
              ? "实时连接中 (Live)"
              : wsStatus === "connecting"
              ? "正在握手连接..."
              : "通道已断开"}
          </div>
        </div>

        {/* 捕获总条数 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="text-[11px] text-[var(--text-muted)]">累计捕获日志</div>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] tabular-nums">
            {logs.length}
            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">条</span>
          </div>
        </div>

        {/* 告警计数 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>告警事件</span>
            <span className="text-[10px] font-mono text-amber-500">WARN</span>
          </div>
          <div className="text-xl font-bold font-mono text-amber-500 tabular-nums">
            {warnCount}
            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">次</span>
          </div>
        </div>

        {/* 异常错误计数 */}
        <div className="p-3.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>异常与错误</span>
            <span className="text-[10px] font-mono text-rose-500">ERROR</span>
          </div>
          <div className="text-xl font-bold font-mono text-rose-500 tabular-nums">
            {errorCount}
            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">次</span>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 区域 2: 控制工具栏 (搜索 + 等级胶囊 + 滚动/暂停/清空/导出)     */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-2 rounded-2xl glass-surface border border-[var(--glass-border-subtle)]">
        {/* 宽幅搜索框 */}
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
            placeholder="搜索日志关键字 (如 IP、域名、WinDivert、Rule-Set)..."
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

        {/* 控制组: 等级胶囊 + 动作按钮 (严谨防挤压) */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* 等级筛选胶囊 */}
          <div className="flex items-center p-0.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[11px] font-mono">
            {(
              [
                { id: "all", label: "全部", count: logs.length },
                { id: "info", label: "INFO", count: infoCount },
                { id: "warning", label: "WARN", count: warnCount },
                { id: "error", label: "ERR", count: errorCount },
                { id: "debug", label: "DEBUG", count: debugCount },
              ] as { id: LogLevel; label: string; count: number }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedLevel(item.id)}
                className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                  selectedLevel === item.id
                    ? "bg-blue-500 text-white font-semibold shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span>{item.label}</span>
                <span className="text-[9px] opacity-70 tabular-nums">({item.count})</span>
              </button>
            ))}
          </div>

          {/* 自动滚屏开关 */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-xl border transition-all cursor-pointer whitespace-nowrap ${
              autoScroll
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 text-[var(--text-muted)]"
            }`}
            title={autoScroll ? "已启用自动滚屏 (新日志跟随)" : "已暂停自动滚屏"}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>滚屏跟随</span>
          </button>

          {/* 暂停/继续流开关 */}
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-xl border transition-all cursor-pointer whitespace-nowrap ${
              isPaused
                ? "border-amber-500/30 bg-amber-500/10 text-amber-500 font-semibold"
                : "border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title={isPaused ? "已暂停日志接收，点击恢复" : "暂停日志流"}
          >
            {isPaused ? (
              <>
                <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>已暂停</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>暂停</span>
              </>
            )}
          </button>

          {/* 导出 .txt 按钮 */}
          <button
            type="button"
            disabled={filteredLogs.length === 0}
            onClick={handleExport}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-xl border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-black/5 dark:bg-white/5 transition-all active:scale-95 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            title="导出当前过滤后的所有日志"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>导出</span>
          </button>

          {/* 清空按钮 */}
          <button
            type="button"
            disabled={logs.length === 0}
            onClick={handleClear}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl text-rose-500 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all active:scale-95 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            title="清空当前所有日志缓冲"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>清空</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 区域 3: 沉浸式极客终端控制台视口 (Terminal Viewport)            */}
      {/* ============================================================== */}
      <div
        ref={terminalRef}
        onScroll={handleScroll}
        className="h-[520px] rounded-2xl glass-surface border border-[var(--glass-border-subtle)] bg-black/40 dark:bg-black/60 p-3 sm:p-4 overflow-y-auto font-mono text-xs leading-relaxed space-y-1 select-text scroll-smooth"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] space-y-2 select-none">
            <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div className="text-xs">暂无符合条件的日志记录</div>
            <p className="text-[10px] opacity-70">
              {searchQuery ? "请尝试清空关键字或切换过滤等级" : "等待核心发出新的路由与网络事件..."}
            </p>
          </div>
        ) : (
          filteredLogs.map((entry) => {
            const isCopied = copiedId === entry.id;

            return (
              <div
                key={entry.id}
                onClick={() => handleCopyLine(entry)}
                className="flex items-start gap-2.5 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
                title="点击一键复制整行日志"
              >
                {/* 毫秒时间戳 */}
                <span className="text-[10px] text-[var(--text-muted)] select-none tabular-nums shrink-0 pt-0.5">
                  {entry.time}
                </span>

                {/* 等级徽标 */}
                <div className="shrink-0 pt-0.5">
                  {renderLevelBadge(entry.level)}
                </div>

                {/* 日志内容主体 (自动着色) */}
                <div className="flex-1 text-[var(--text-primary)] break-all font-mono selection:bg-blue-500 selection:text-white">
                  <span
                    className={
                      entry.level === "error"
                        ? "text-rose-400 font-semibold"
                        : entry.level === "warning"
                        ? "text-amber-400"
                        : entry.level === "debug"
                        ? "text-zinc-400"
                        : "text-zinc-200"
                    }
                  >
                    {entry.payload}
                  </span>
                </div>

                {/* 右侧复制反馈指示 */}
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-[var(--text-muted)] select-none">
                  {isCopied ? (
                    <span className="text-emerald-500 font-sans font-semibold">已复制</span>
                  ) : (
                    <span>复制</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部数据源与连接说明 */}
      <div className="flex items-center justify-between px-1 pt-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--glass-border-subtle)] font-mono select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>终端模式: 最大驻留 {MAX_LOG_BUFFER_SIZE} 条</span>
        </div>

        <div>
          {isTauri ? (
            <span className="text-emerald-500 font-semibold">
              ● Tauri 原生核心 WebSocket (Port {controllerPort})
            </span>
          ) : (
            <span className="text-amber-500/80">○ 浏览器前端仿真模拟事件流</span>
          )}
        </div>
      </div>
    </div>
  );
};
