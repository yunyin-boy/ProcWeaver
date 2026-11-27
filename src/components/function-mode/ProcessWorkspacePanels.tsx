import { PortableUpdateSettings } from "./PortableUpdates";
import { useState } from "react";
import { FolderOpen, Search, X } from "lucide-react";
import type { useProcessWorkspace } from "../../hooks/useProcessWorkspace";
import { Button } from "../../../src-next/primitives/Button";
import { SettingOptions, SettingsSection, SettingSwitch } from "../../../src-next/views/settings/SettingsSections";

type State = ReturnType<typeof useProcessWorkspace>;
type RecordFilter = "all" | "active" | "completed" | "failed";

const connectionStates: Record<string, string> = {
  connecting: "连接中",
  active: "隧道已建立",
  closed: "连接已结束",
  response: "响应已转发",
  failed: "失败",
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function recordGroup(state: string): Exclude<RecordFilter, "all"> {
  if (state === "active" || state === "connecting") return "active";
  return state === "failed" ? "failed" : "completed";
}

export function ProcessDiagnostics({ state: s }: { state: State }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecordFilter>("all");
  const query = searchQuery.trim().toLowerCase();
  const filteredRecords = s.records.filter(record =>
    (statusFilter === "all" || statusFilter === recordGroup(record.state))
    && [record.target, record.process, record.pid, record.route, record.upstream, s.bundleNames[record.bundleId]]
      .some(value => String(value ?? "").toLowerCase().includes(query))
  );
  const counts = { all: s.records.length, active: 0, completed: 0, failed: 0 };
  let totalUp = 0;
  let totalDown = 0;
  for (const record of s.records) {
    counts[recordGroup(record.state)]++;
    totalUp += record.uploaded || 0;
    totalDown += record.downloaded || 0;
  }

  const filters = [
    ["all", "全部"],
    ["active", "活跃连接"],
    ["completed", "已结束"],
    ["failed", "失败"],
  ] as const;
  const metrics = [
    ["连接记录", counts.all],
    ["活跃连接", counts.active],
    ["累计下载", formatBytes(totalDown)],
    ["累计上传", formatBytes(totalUp)],
  ] as const;
  const diagnostics = s.external?.diagnostics;
  const capture = s.capture.state.view;

  return (
    <div className="workbench-view">
      <section className="workbench-panel grid min-w-0 gap-4 p-4" aria-label="连接与诊断工具区">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="workbench-segments workbench-connection-segments flex-wrap" role="group" aria-label="连接状态">
            {filters.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)}>
                {label} <span className="tabular-nums">{counts[id]}</span>
              </button>
            ))}
          </div>
          <Button type="button" loading={s.logsBusy} onClick={() => void s.actions.openLogs()}>
            <FolderOpen size={14} aria-hidden="true" /> 打开日志目录
          </Button>
        </div>

        <dl className="workbench-stat-grid tabular-nums" aria-label="连接流量">
          {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <div className="workbench-field flex min-w-[min(100%,175px)] flex-1 items-center gap-2 px-2.5">
            <Search size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索域名、IP、进程或出口" aria-label="搜索连接" className="min-h-9 min-w-0 flex-1 text-[13px]"
            />
            {searchQuery && <button type="button" className="workbench-title-button !min-h-6 !min-w-6" aria-label="清除搜索" onClick={() => setSearchQuery("")}><X size={14} aria-hidden="true" /></button>}
          </div>
          <select aria-label="筛选业务包连接" value={s.filter} onChange={(event) => s.actions.setFilter(event.target.value)}
            className="workbench-field min-h-9 max-w-full px-2.5 text-[13px]">
            <option value="">全部业务包</option>
            {Object.entries(s.bundleNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </section>

      {filteredRecords.length ? (
        <section className="workbench-panel grid gap-1 p-2" aria-label="连接记录">
          <ol>
            {filteredRecords.map(record => {
              const group = recordGroup(record.state);
              return (
                <li key={record.id} className="process-connection-row">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold [overflow-wrap:anywhere]">{record.target}</p>
                    <span className={"workbench-tag mt-1 " + (group === "failed" ? "workbench-tag-warning" : group === "active" ? "workbench-tag-positive" : "")}>
                      {connectionStates[record.state] ?? record.state}
                    </span>
                  </div>
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <p>{record.process || s.bundleNames[record.bundleId] || record.bundleId}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">PID {record.pid} · {new Date(record.at).toLocaleTimeString()}</p>
                    {record.process && s.bundleNames[record.bundleId] && <p className="text-[11px] text-[var(--text-muted)]">{s.bundleNames[record.bundleId]}</p>}
                  </div>
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <p>{record.upstream || record.route}</p>
                    {record.upstream && <p className="text-[11px] text-[var(--text-muted)]">{record.route}</p>}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    <p>↓ {formatBytes(record.downloaded)}</p>
                    <p>↑ {formatBytes(record.uploaded)}</p>
                  </div>
                  {record.message && <p className={"col-span-full text-[11px] [overflow-wrap:anywhere] " + (group === "failed" ? "text-[var(--workbench-danger)]" : "text-[var(--text-muted)]")}>{record.message}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <section className="workbench-panel workbench-connection-empty" aria-label="连接记录">
          <p role="status">{s.records.length || s.filter ? "暂无匹配的连接记录" : "尚未观察到独立连接"}</p>
          {(s.filter || searchQuery || statusFilter !== "all") && (
            <button type="button" className="workbench-action workbench-action-ghost mt-2" onClick={() => {
              s.actions.setFilter(""); setStatusFilter("all"); setSearchQuery("");
            }}>重置筛选</button>
          )}
        </section>
      )}

      {(diagnostics || capture?.mode === "windivert" || s.logsError) && (
        <SettingsSection title="排障诊断">
          {capture?.mode === "windivert" && <div className="flex flex-wrap items-center gap-2 text-xs">
            <strong className="mr-1">WinDivert</strong>
            <span className="workbench-tag">TCP {capture.tcp}</span>
            <span className="workbench-tag">UDP {capture.udp}</span>
            <span className="workbench-tag">DNS {capture.dns}</span>
            <span className="workbench-tag">未识别 {capture.unclassified}</span>
            <span className="workbench-tag workbench-tag-warning">失败 {capture.failures}</span>
          </div>}
          {diagnostics && <div className="grid gap-1.5 text-xs text-[var(--text-muted)]">
            <p><span className="font-medium text-[var(--text-primary)]">详细排障日志</span> · {diagnostics.error ? "写入异常" : diagnostics.ready ? "持续记录中" : "正在初始化"}</p>
            <p>活跃任务 TCP {diagnostics.activeTcp} · UDP {diagnostics.activeUdp} · DNS {diagnostics.activeDns}</p>
            <p className="break-all font-mono text-[11px] select-text">{diagnostics.directory} / {diagnostics.fileName}</p>
            <p>保留最近 {diagnostics.retainedFiles} 份日志，每份上限 {Math.round(diagnostics.maxFileBytes / 1024 / 1024)} MiB。</p>
          </div>}
          {(s.logsError || diagnostics?.error || Boolean(diagnostics?.dropped)) && (
            <p className="workbench-setting-feedback" role="status">{s.logsError || diagnostics?.error || "未写入日志 " + diagnostics?.dropped + " 条。"}</p>
          )}
        </SettingsSection>
      )}
    </div>
  );
}

const closeOptions = [
  { id: "ask", label: "每次询问", description: "关闭窗口时选择最小化或退出。" },
  { id: "minimize", label: "最小化到托盘", description: "隐藏窗口并在后台保持进程分流。" },
  { id: "exit", label: "直接退出", description: "关闭程序并停止独立代理。" },
] as const;

export function ProcessSettings({ state: s }: { state: State }) {
  const preferences = s.preferences;

  return (
    <div className="workbench-view workbench-settings">
      <SettingsSection title="启动与窗口" tools={preferences && (
        <Button type="button" variant="primary" loading={s.busy} onClick={() => void s.actions.save()}>保存偏好设置</Button>
      )}>
        {s.error && <p role="alert" className="workbench-setting-feedback">{s.error}</p>}
        {s.message && <p role="status" className="text-xs text-[var(--workbench-positive)]">{s.message}</p>}
        {preferences ? (
          <>
            <SettingSwitch title="开机自启" help="系统启动时自动打开 ProcWeaver Process。" checked={preferences.autoStart} disabled={s.busy}
              onChange={(autoStart) => s.actions.setPreferences({ ...preferences, autoStart })} />
            <SettingSwitch title="启动时隐藏主窗口" help="在系统托盘运行，可从托盘打开窗口。" checked={preferences.silentStart} disabled={s.busy}
              onChange={(silentStart) => s.actions.setPreferences({ ...preferences, silentStart })} />
            <SettingOptions
              label="关闭窗口时" options={closeOptions} value={preferences.closeAction ?? (preferences.minimizeOnClose ? "minimize" : "ask")}
              disabled={s.busy} onChange={(closeAction) => s.actions.setPreferences({ ...preferences, closeAction, minimizeOnClose: closeAction === "minimize" })}
            />
          </>
        ) : (
          <div className="workbench-setting-row text-xs">
            <span>{s.busy ? "正在读取偏好设置…" : "偏好设置尚未读取"}</span>
            <Button type="button" loading={s.busy} onClick={() => void s.actions.loadPreferences()}>重新读取</Button>
          </div>
        )}
      </SettingsSection>

      <PortableUpdateSettings title="版本与更新" busy={s.busy} />
    </div>
  );
}
