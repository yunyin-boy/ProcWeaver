import React from "react";
import { RefreshCw } from "lucide-react";
import { LiveProcessItem } from "../../types/processRouting";

interface LiveProcessListProps {
  processes: LiveProcessItem[];
  onRouteProcess: (proc: LiveProcessItem, action: "proxy" | "direct") => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const LiveProcessList: React.FC<LiveProcessListProps> = ({
  processes,
  onRouteProcess,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <section className="workbench-panel workbench-live-table grid gap-2.5 p-3.5" aria-label="运行进程">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)]">进程快照 · {processes.length} 个</span>
        <button type="button" onClick={onRefresh} disabled={isRefreshing} className="workbench-action">
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} aria-hidden="true" />
          {isRefreshing ? "正在刷新…" : "刷新进程列表"}
        </button>
      </div>
      {processes.length === 0 ? (
        <p className="p-6 text-center text-xs text-[var(--text-muted)]">当前没有可显示的进程</p>
      ) : (
        <div className="grid gap-2">
          <div className="workbench-process-columns" aria-hidden="true">
            <span>进程 / PID</span><span>匹配规则</span><span>规则出口</span><span>操作</span>
          </div>
          {processes.map((process) => (
            <div className="workbench-process-row" key={process.pid}>
              <div className="grid min-w-0 gap-0.5">
                <strong className="break-words text-[13px]" title={process.path}>{process.name}</strong>
                <span className="tabular-nums text-[11px] text-[var(--text-muted)]">PID {process.pid}</span>
                {process.path && <span className="truncate text-[11px] text-[var(--text-muted)]" title={process.path}>{process.path}</span>}
              </div>
              <span className="break-words text-xs text-[var(--text-secondary)]">
                {process.isRouted ? process.matchedRuleName || "自定义分流" : "未匹配"}
              </span>
              <span className="break-all text-xs text-[var(--text-secondary)]">{process.matchedProxy || "—"}</span>
              {process.isRouted ? (
                <span className="workbench-tag workbench-tag-positive justify-self-start">规则已匹配</span>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" className="workbench-action workbench-action-primary" onClick={() => onRouteProcess(process, "proxy")}>分流此应用</button>
                  <button type="button" className="workbench-action" onClick={() => onRouteProcess(process, "direct")}>直连排除</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
