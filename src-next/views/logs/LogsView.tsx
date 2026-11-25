import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Copy, Download, Pause, Play, Search, Trash2, X } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { isTauriEnvironment } from "../../services/client";
import {
  clearLogs,
  exportLogsText,
  formatLogLine,
  getSnapshotLogs,
  initLogsStream,
  MAX_LOG_BUFFER_SIZE,
  subscribeLogs,
} from "../../services/logsService";
import type { LogEntry, LogLevel } from "../../types/logs";

const levels = [
  { id: "all", label: "全部" },
  { id: "error", label: "错误" },
  { id: "warning", label: "警告" },
  { id: "info", label: "信息" },
  { id: "debug", label: "调试" },
] as const;

const levelBadges = {
  error: ["ERROR", "workbench-log-error"],
  warning: ["WARN", "workbench-tag-warning"],
  info: ["INFO", "workbench-tag-accent"],
  debug: ["DEBUG", ""],
} as const;

interface LogsViewProps {
  controllerPort?: number;
  visible: boolean;
  onShowNotice?: (msg: string) => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ controllerPort, visible, onShowNotice }) => {
  const [logs, setLogs] = useState(getSnapshotLogs);
  const [pausedLogs, setPausedLogs] = useState<LogEntry[] | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [level, setLevel] = useState<LogLevel>("all");
  const [query, setQuery] = useState("");
  const [followLatest, setFollowLatest] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const isPreview = !isTauriEnvironment();
  const paused = pausedLogs !== null;
  const displayed = pausedLogs ?? logs;

  useEffect(() => {
    let frame: number | undefined;
    const readLogs = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setLogs(getSnapshotLogs());
      });
    };
    const unsubscribe = subscribeLogs(readLogs);
    readLogs();
    return () => {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!isPreview && !controllerPort) {
      setStatus("disconnected");
      return;
    }
    return initLogsStream(controllerPort, undefined, setStatus);
  }, [controllerPort, isPreview]);

  const { counts, filtered } = useMemo(() => {
    const counts = { all: displayed.length, error: 0, warning: 0, info: 0, debug: 0 };
    const keyword = query.trim().toLowerCase();
    const filtered = displayed.filter((entry) => {
      counts[entry.level]++;
      return (level === "all" || level === entry.level)
        && (!keyword || entry.payload.toLowerCase().includes(keyword) || entry.time.includes(keyword));
    });
    return { counts, filtered };
  }, [displayed, level, query]);

  const scrollToEnd = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  };

  useLayoutEffect(() => {
    if (visible && followLatest) scrollToEnd();
  }, [visible, followLatest, filtered]);

  const copyLog = async (entry: LogEntry) => {
    try {
      await navigator.clipboard.writeText(formatLogLine(entry));
      onShowNotice?.("已复制日志");
    } catch {
      onShowNotice?.("复制日志失败");
    }
  };

  const exportFiltered = () => {
    try {
      exportLogsText(filtered);
      onShowNotice?.("已发起导出 " + filtered.length.toLocaleString() + " 条日志");
    } catch {
      onShowNotice?.("导出日志失败");
    }
  };

  const clearHistory = () => {
    clearLogs();
    setLogs([]);
    if (paused) setPausedLogs([]);
    onShowNotice?.("已清空本次会话的日志");
  };

  const streamLabel = isPreview ? "模拟数据" : { connecting: "正在连接核心", connected: "已连接核心", disconnected: "核心日志未连接" }[status];

  return (
    <div className="workbench-view workbench-logs">
      <section className="workbench-panel grid min-w-0 gap-3.5 p-4" aria-label="日志工具区">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" role="status">
            <span className={"workbench-tag " + (isPreview ? "" : status === "connected" ? "workbench-tag-positive" : "workbench-tag-warning")}>
              {streamLabel}
            </span>
            {paused && <span className="text-xs text-[var(--text-muted)]">显示已暂停</span>}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button type="button" onClick={() => setPausedLogs(paused ? null : getSnapshotLogs())}>
              {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
              {paused ? "继续显示" : "暂停显示"}
            </Button>
            <Button type="button" onClick={exportFiltered} disabled={!filtered.length}>
              <Download size={14} aria-hidden="true" />导出结果
            </Button>
            <Button type="button" variant="ghost" onClick={clearHistory} disabled={!logs.length && !displayed.length}>
              <Trash2 size={14} aria-hidden="true" />清空
            </Button>
          </div>
        </div>

        <div className="workbench-log-filters">
          <div className="workbench-field flex min-w-0 items-center gap-2 px-2.5">
            <Search size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <input type="search" aria-label="搜索日志" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索日志内容或时间" className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px]" />
            {query && (
              <button type="button" aria-label="清除搜索" className="workbench-title-button !min-h-6 !min-w-6" onClick={() => setQuery("")}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="workbench-segments workbench-log-levels flex-wrap" role="group" aria-label="筛选日志级别">
            {levels.map(({ id, label }) => (
              <button type="button" key={id} aria-pressed={id === level} onClick={() => setLevel(id)}>
                {label} <span className="text-[11px] tabular-nums">{counts[id].toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="workbench-panel grid min-w-0 gap-2 p-3 sm:p-4" aria-label="实时日志列表">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
          <p className="text-xs tabular-nums text-[var(--text-muted)]">
            显示 {filtered.length.toLocaleString()} / {displayed.length.toLocaleString()} 条
            <span className="ml-2 hidden sm:inline">最多保留 {MAX_LOG_BUFFER_SIZE.toLocaleString()} 条</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--workbench-control)] px-2 py-1.5">
              <span className="whitespace-nowrap text-xs text-[var(--text-secondary)]">跟随最新</span>
              <CapsuleToggle checked={followLatest} onChange={setFollowLatest} title="跟随最新日志" />
            </div>
            {!followLatest && (
              <Button type="button" size="sm" variant="ghost" onClick={scrollToEnd} disabled={!filtered.length}>
                <ArrowDownToLine size={14} aria-hidden="true" />跳到末尾
              </Button>
            )}
          </div>
        </div>
        <div
          ref={listRef}
          className="workbench-log-content rounded-md"
          role="region"
          aria-label="日志记录"
          tabIndex={0}
          onScroll={(event) => {
            const list = event.currentTarget;
            if (followLatest && list.scrollHeight - list.scrollTop - list.clientHeight > 32) setFollowLatest(false);
          }}
        >
          {!filtered.length ? (
            <p className="p-7 text-center text-sm text-[var(--text-muted)]">
              {displayed.length ? "没有匹配的日志" : paused ? "显示已暂停" : status === "disconnected" ? "等待核心日志连接" : "等待新日志"}
            </p>
          ) : (
            <div className="min-w-0" role="table" aria-label="日志">
              <div className="workbench-log-row workbench-log-heading" role="row">
                <span role="columnheader">时间</span><span role="columnheader">级别</span><span role="columnheader">内容</span><span role="columnheader" className="sr-only">操作</span>
              </div>
              {filtered.map((entry) => {
                const [badge, tone] = levelBadges[entry.level];
                return (
                  <div className="workbench-log-row" key={entry.id} role="row">
                    <time className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]" role="cell" dateTime={new Date(entry.timestamp).toISOString()}>{entry.time}</time>
                    <div role="cell"><span className={"workbench-tag font-mono " + tone}>{badge}</span></div>
                    <span role="cell" className="workbench-log-message min-w-0 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{entry.payload}</span>
                    <div className="workbench-log-copy" role="cell">
                      <Button type="button" variant="ghost" size="sm" className="!min-h-7 !min-w-7 !p-1" aria-label={"复制 " + entry.time + " 的日志"} title="复制日志" onClick={() => void copyLog(entry)}>
                        <Copy size={13} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
