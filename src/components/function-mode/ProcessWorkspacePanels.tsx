import { useState, useMemo } from "react";
import {
  RefreshCw,
  Wrench,
  Check,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Sliders,
  CheckCircle2,
  Download,
  FolderOpen,
  Copy,
  ExternalLink,
  FileCode,
  Search,
  Activity,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import type { useProcessWorkspace } from "../../hooks/useProcessWorkspace";
import type { FunctionModeView } from "../../types/functionMode";
import type { AppUpdateInfo } from "../../types";
import { checkAppUpdate } from "../../api/maintenance";
import { processUpdateApi } from "../../api/processUpdate";
import { version as appVersion } from "../../../package.json";
import { ProcessCaptureControls } from "./ProcessCaptureControls";

type State = ReturnType<typeof useProcessWorkspace>;
const baseBtn =
  "rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-indigo-500";

export function ProcessAccessBar({
  state: s,
  capability,
  onFull,
}: {
  state: State;
  capability: FunctionModeView;
  onFull?: () => void;
}) {
  const readyCount = s.external?.states.filter((item) => item.ready).length || 0;

  return (
    <section
      aria-label="进程代理运行控制"
      className="border-b border-slate-200/90 dark:border-slate-800/90 px-5 py-3 bg-white/95 dark:bg-slate-900/95 space-y-2.5 shadow-2xs backdrop-blur-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 左侧：分段接入方式控制 */}
        <div className="min-w-0 flex-1">
          <ProcessCaptureControls
            state={s.capture.state}
            onRequest={s.capture.actions.request}
            onCancel={s.capture.actions.cancel}
            onConfirm={() => void s.capture.actions.confirm()}
            onRefresh={() => void s.capture.actions.refresh()}
          />
        </div>

        {/* 右侧：独立代理入口就绪数与平滑胶囊开关 */}
        <div className="flex items-center space-x-2 shrink-0">
          <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !s.external
                  ? "bg-slate-400"
                  : s.external.enabled && readyCount > 0
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              }`}
            />
            <span>
              {!s.external
                ? "状态读取中…"
                : s.external.enabled
                ? `入口就绪 ${readyCount} 个`
                : "独立代理已暂停"}
            </span>
          </span>

          {/* 胶囊滑动总开关 */}
          <button
            type="button"
            role="switch"
            aria-label="独立代理总开关"
            aria-checked={s.external?.enabled === true}
            disabled={s.pending || !s.external}
            onClick={() => void s.actions.toggle()}
            className={`h-8 px-3 rounded-xl border text-xs font-medium flex items-center space-x-2 transition shadow-2xs select-none disabled:opacity-50 disabled:cursor-not-allowed ${
              s.external?.enabled
                ? "bg-emerald-50/80 hover:bg-emerald-100/90 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 cursor-pointer"
                : "bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 cursor-pointer"
            }`}
          >
            <span
              aria-hidden="true"
              className={`relative inline-flex items-center w-7 h-4 rounded-full shrink-0 transition-colors duration-200 ${
                s.external?.enabled ? "bg-emerald-500 shadow-xs" : "bg-slate-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`inline-block w-3 h-3 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                  s.external?.enabled ? "translate-x-[14px]" : "translate-x-0.5"
                }`}
              />
            </span>
            <span>{s.external?.enabled ? "已开启" : "已暂停"}</span>
          </button>
        </div>
      </div>

      {/* 说明与切回完整功能提示条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
        <p className="leading-relaxed min-w-0 flex-1">
          {s.capture.state.view?.mode === "windivert"
            ? "无需为代理参数重启已运行的目标；只接管新连接，实际出口请查看连接记录。"
            : s.capture.state.view?.mode === "user_mode"
            ? "由业务包卡片启动的应用自动透明挂载 Hook，免驱动且无需为代理参数重启。"
            : "应用需接入本包代理入口；发现进程不代表已接管。"}
          {capability.winDivertReason}。
        </p>
        {onFull && <button
          type="button"
          onClick={onFull}
          className="inline-flex items-center space-x-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline shrink-0 cursor-pointer ml-1"
        >
          <span>切回完整功能模式</span>
          <ArrowRight className="w-3 h-3" />
        </button>}
      </div>

      {s.runtimeError && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-xl border border-red-200 dark:border-red-900/60"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 break-words">{s.runtimeError}</span>
          <button className={`${baseBtn} bg-white dark:bg-slate-900`} onClick={() => void s.actions.refresh()}>
            重试读取
          </button>
        </div>
      )}
    </section>
  );
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function ProcessDiagnostics({ state: s }: { state: State }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed" | "failed">("all");

  const states: Record<string, string> = {
    connecting: "连接中",
    active: "隧道已建立",
    closed: "连接已结束",
    response: "响应已转发",
    failed: "失败",
  };

  // 多维过滤与搜索
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return s.records.filter((r) => {
      // 业务包过滤已经在 s.records (通过 s.filter)
      // 状态过滤
      if (statusFilter === "active" && r.state !== "active" && r.state !== "connecting") return false;
      if (statusFilter === "completed" && r.state !== "response" && r.state !== "closed") return false;
      if (statusFilter === "failed" && r.state !== "failed") return false;
      // 搜索过滤
      if (q) {
        const targetMatch = r.target.toLowerCase().includes(q);
        const processMatch = (r.process || "").toLowerCase().includes(q);
        const routeMatch = (r.route || "").toLowerCase().includes(q);
        const upstreamMatch = (r.upstream || "").toLowerCase().includes(q);
        const pidMatch = String(r.pid).includes(q);
        const bundleMatch = (s.bundleNames[r.bundleId] || "").toLowerCase().includes(q);
        if (!targetMatch && !processMatch && !routeMatch && !upstreamMatch && !pidMatch && !bundleMatch) {
          return false;
        }
      }
      return true;
    });
  }, [s.records, s.bundleNames, searchQuery, statusFilter]);

  // 指标统计
  const stats = useMemo(() => {
    let totalUp = 0;
    let totalDown = 0;
    let active = 0;
    let failed = 0;
    for (const r of s.records) {
      totalUp += r.uploaded || 0;
      totalDown += r.downloaded || 0;
      if (r.state === "active" || r.state === "connecting") active++;
      if (r.state === "failed") failed++;
    }
    return {
      total: s.records.length,
      active,
      failed,
      completed: s.records.length - active - failed,
      totalUp,
      totalDown,
    };
  }, [s.records]);

  return (
    <section className="p-5 sm:p-6 space-y-4 overflow-auto h-full max-w-5xl mx-auto" aria-labelledby="process-diagnostics-title">
      {/* 头部标题与业务包快速过滤 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 pb-3">
        <div>
          <h2 id="process-diagnostics-title" className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-500" />
            <span>连接与排障诊断</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            最近采样网络流向记录，包含历史连接与分流诊断；可实时检索过滤与查阅吞吐统计。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="筛选业务包连接"
            value={s.filter}
            onChange={(e) => s.actions.setFilter(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
          >
            <option value="">全部业务包 ({s.records.length})</option>
            {Object.entries(s.bundleNames).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 吞吐与状态快速指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 shadow-2xs space-y-1">
          <span className="text-[11px] text-slate-400 font-medium">总连接采样</span>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 font-mono">
            {stats.total} <span className="text-[10px] text-slate-400 font-normal">条</span>
          </p>
        </div>
        <div className="p-3 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 shadow-2xs space-y-1">
          <span className="text-[11px] text-emerald-500 dark:text-emerald-400 font-medium">活跃 / 建立中</span>
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
            {stats.active} <span className="text-[10px] text-slate-400 font-normal">个</span>
          </p>
        </div>
        <div className="p-3 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 shadow-2xs space-y-1">
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
            <ArrowUp className="w-3 h-3 text-indigo-500" /> 上传总流量
          </span>
          <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 font-mono">
            {formatBytes(stats.totalUp)}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 shadow-2xs space-y-1">
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
            <ArrowDown className="w-3 h-3 text-cyan-500" /> 下载总流量
          </span>
          <p className="text-sm font-bold text-cyan-600 dark:text-cyan-400 font-mono">
            {formatBytes(stats.totalDown)}
          </p>
        </div>
      </div>

      {/* 搜索栏与状态分段 Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* 状态分段 Tab 按钮组 */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/70 dark:border-slate-800">
          {(
            [
              ["all", "全部", stats.total],
              ["active", "活跃中", stats.active],
              ["completed", "已结束", stats.completed],
              ["failed", "异常失败", stats.failed],
            ] as const
          ).map(([val, label, count]) => {
            const isCur = statusFilter === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => setStatusFilter(val)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  isCur
                    ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold shadow-2xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
                }`}
              >
                <span>{label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  val === "failed" && count > 0
                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold"
                    : isCur
                    ? "bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                    : "bg-slate-200/50 dark:bg-slate-800 text-slate-400"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 关键词实时搜索框 */}
        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索域名/IP、进程名、规则..."
            className="w-full pl-8.5 pr-8 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 排障日志常驻卡片 */}
      {s.external?.diagnostics && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${s.external.diagnostics.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
              <strong className="text-slate-800 dark:text-slate-100">
                详细排障日志 · {s.external.diagnostics.error ? "写入异常" : s.external.diagnostics.ready ? "持续记录中" : "正在初始化"}
              </strong>
            </div>
            <button type="button" className={`${baseBtn} flex items-center gap-1.5`} disabled={s.logsBusy} onClick={() => void s.actions.openLogs()}>
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{s.logsBusy ? "正在打开…" : "打开日志目录"}</span>
            </button>
          </div>
          <p className="text-slate-500 leading-relaxed">
            记录建连阶段、关闭原因和流量会话；保留最近 {s.external.diagnostics.retainedFiles} 份历史日志，每份上限 {Math.round(s.external.diagnostics.maxFileBytes / 1024 / 1024)} MiB。严格安全保护，绝不记录任何请求敏感内容或密码。
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 font-mono text-[11px]">
            <span>当前活跃任务: TCP {s.external.diagnostics.activeTcp} · UDP {s.external.diagnostics.activeUdp} · DNS {s.external.diagnostics.activeDns}</span>
            <span className="text-slate-400 break-all">{s.external.diagnostics.directory} / {s.external.diagnostics.fileName}</span>
          </div>
          {(s.external.diagnostics.error || s.logsError || s.external.diagnostics.dropped > 0) && (
            <p role="status" className="text-amber-700 dark:text-amber-300 break-words bg-amber-50/50 dark:bg-amber-950/20 p-2 rounded-lg border border-amber-200/50">
              {s.logsError || s.external.diagnostics.error || `有 ${s.external.diagnostics.dropped} 条日志因队列超限或写入失败未保存。`}
            </p>
          )}
        </div>
      )}

      {/* 连接流向记录列表 */}
      {!s.records.length ? (
        <div className="py-16 text-center text-sm text-slate-500 space-y-2">
          <p>尚未观察到任何独立连接记录。</p>
          <p className="text-xs text-slate-400">请启动已绑定外部代理的业务包并发起网络请求。</p>
        </div>
      ) : !filteredRecords.length ? (
        <div className="py-12 text-center text-xs text-slate-500 space-y-2 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <p>未找到符合当前过滤条件的连接记录。</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
          >
            重置所有筛选
          </button>
        </div>
      ) : (
        <ol className="space-y-2.5">
          {filteredRecords.map((record) => {
            const isFailed = record.state === "failed";
            const isActive = record.state === "active" || record.state === "connecting";
            return (
              <li
                key={record.id}
                className={`p-3.5 rounded-xl border transition text-xs space-y-2 shadow-2xs ${
                  isFailed
                    ? "border-rose-300 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/15"
                    : isActive
                    ? "border-emerald-300/80 dark:border-emerald-900/60 bg-emerald-50/15 dark:bg-emerald-950/10"
                    : "border-slate-200/70 dark:border-slate-800/80 bg-white dark:bg-slate-900/60"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-800 dark:text-slate-100 font-mono text-[13px] break-all">
                      {record.target}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* 流量展示 */}
                    {(record.uploaded > 0 || record.downloaded > 0) && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                        <span className="text-indigo-600 dark:text-indigo-400">↑ {formatBytes(record.uploaded)}</span>
                        <span className="text-slate-300 dark:text-slate-600">/</span>
                        <span className="text-cyan-600 dark:text-cyan-400">↓ {formatBytes(record.downloaded)}</span>
                      </span>
                    )}

                    {/* 状态徽标 */}
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        isFailed
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          : isActive
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {states[record.state] || record.state}
                    </span>
                  </div>
                </div>

                {/* 路由与进程详情元数据 */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500 font-mono">
                  <span>#{record.id}</span>
                  <span>·</span>
                  <span>{new Date(record.at).toLocaleTimeString()}</span>
                  <span>·</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {s.bundleNames[record.bundleId] || record.bundleId}
                  </span>
                  <span>·</span>
                  <span>PID {record.pid}</span>
                  <span>·</span>
                  <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {record.process}
                  </span>
                  <span>·</span>
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {record.route} → {record.upstream}
                  </span>
                </div>

                {/* 失败排障详情突出展示 */}
                {record.message && (
                  <div
                    className={`p-2.5 rounded-lg text-[11px] font-mono leading-relaxed break-words flex items-start gap-2 ${
                      isFailed
                        ? "bg-rose-100/60 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60"
                        : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                    <span>{record.message}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function ProcessSettings({
  state: s,
  standalone = true,
}: {
  state: State;
  onOpenMaintenance?: () => void;
  standalone?: boolean;
}) {
  // 更新检测与下载状态 (完全对齐完整版)
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateError(null);
    setDownloadedPath(null);
    try {
      const info = await (standalone ? processUpdateApi.check() : checkAppUpdate());
      setUpdateInfo(info);
    } catch (err) {
      console.error("检查更新失败:", err);
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setUpdateError(null);
    try {
      const path = await processUpdateApi.download();
      setDownloadedPath(path);
    } catch (err) {
      console.error("下载更新包失败:", err);
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await processUpdateApi.openFolder(downloadedPath || undefined);
    } catch (err) {
      console.error("打开文件夹失败:", err);
    }
  };

  const handleCopyPath = () => {
    if (!downloadedPath) return;
    void navigator.clipboard.writeText(downloadedPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="max-w-2xl p-5 sm:p-6 space-y-6 mx-auto" aria-labelledby="process-settings-title">
      <div>
        <h2 id="process-settings-title" className="font-bold text-base text-slate-900 dark:text-white flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-indigo-500" />
          <span>偏好与版本维护</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          管理独立进程版的窗口关闭动作、开机自启、后台静默偏好与官方版本检测升级。
        </p>
      </div>

      {s.error && (
        <div role="alert" className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 text-xs text-red-600 dark:text-red-400">
          {s.error}
        </div>
      )}
      {s.message && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 text-xs text-emerald-700 dark:text-emerald-300 flex items-center space-x-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{s.message}</span>
        </div>
      )}

      {/* 核心卡片 1：客户端版本与更新检测 (对齐完整版能力，内嵌于偏好设置) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <strong className="text-xs font-bold text-slate-800 dark:text-slate-100 block">
                客户端版本与更新检测
              </strong>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-slate-500">
                  当前版本: <strong className="font-mono text-indigo-600 dark:text-indigo-400">v{appVersion}</strong>
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                  x64 Portable
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={checking || downloading}
            onClick={handleCheckUpdate}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            <span>{checking ? "检查中…" : "检查更新"}</span>
          </button>
        </div>

        {/* 发布源通道指示 */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-0.5">
          <span>更新通道: 主源 <code className="text-slate-600 dark:text-slate-300 font-mono">jojhaa/ProcWeaver</code> / 镜像 <code className="text-slate-600 dark:text-slate-300 font-mono">yunyin-boy/ProcWeaver</code></span>
          <a
            href="https://github.com/jojhaa/ProcWeaver/releases"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <span>GitHub Releases</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* 错误提示 / Linux.do 容灾引导 */}
        {updateError && (
          updateError.includes("linux.do") || updateError.includes("仓库维护") ? (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <Wrench className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <span className="font-bold">全部更新通道暂不可用 (仓库维护中)</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    所有官方及镜像发布通道均未响应或处于迁移维护状态。
                  </p>
                </div>
              </div>
              <a
                href="https://linux.do/t/topic/2940957"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 transition shadow-xs"
              >
                <span>前往 Linux.do 查看最新仓库</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>检查更新失败: {updateError}</span>
            </div>
          )
        )}

        {/* 新版本检测结果 */}
        {updateInfo && (
          updateInfo.hasUpdate ? (
            <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {updateInfo.releaseName || `新版本 ${updateInfo.latestVersion}`}
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  {updateInfo.publishedAt ? new Date(updateInfo.publishedAt).toLocaleDateString() : "近期发布"}
                </span>
              </div>

              {/* 发行更新日志 */}
              {updateInfo.releaseNotes && (
                <div className="p-3 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800/80 text-xs text-slate-700 dark:text-slate-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                  {updateInfo.releaseNotes}
                </div>
              )}

              {/* 推荐独立便携资产信息 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs">
                  <FileCode className="w-4 h-4 text-indigo-500" />
                  <span className="font-medium text-slate-800 dark:text-slate-200 break-all">
                    {updateInfo.assetName || "匹配独立进程版便携包"}
                  </span>
                  <span className="text-slate-400">({updateInfo.assetSizeFormatted})</span>
                </div>

                {/* 下载按钮 */}
                {!downloadedPath && (
                  <button
                    type="button"
                    disabled={downloading}
                    onClick={handleDownload}
                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Download className={`w-3.5 h-3.5 ${downloading ? "animate-bounce" : ""}`} />
                    <span>{downloading ? "正在流式下载…" : "下载独立便携包"}</span>
                  </button>
                )}
              </div>

              {/* 下载完成与目录展示 */}
              {downloadedPath && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>更新便携包下载完成</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={downloadedPath}
                      className="flex-1 px-2.5 py-1 text-[11px] font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 select-all outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyPath}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? "已复制" : "复制"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenFolder}
                      className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>打开所在目录</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    更新为独立进程版便携包。下载后正常退出进程版，解压到新文件夹，按需迁移 process-data；请保留旧目录用于回退。
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-emerald-500/10 dark:bg-emerald-950/20 border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>当前已是最新版本 ({updateInfo.currentVersion})</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                      稳定通道
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    已同步 GitHub 官方与镜像发布源，当前独立进程版处于最新稳定状态。
                  </p>
                </div>
              </div>
              <a
                href={updateInfo.htmlUrl || "https://github.com/jojhaa/ProcWeaver/releases"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-200 dark:border-slate-700 transition self-start sm:self-auto cursor-pointer"
              >
                <span>发行说明</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
            </div>
          )
        )}
      </div>

      {/* 核心卡片 2：系统与窗口偏好 (增加关闭提示配置，支持不再提问) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-4 shadow-2xs">
        <strong className="text-xs font-bold text-slate-800 dark:text-slate-100 block border-b border-slate-100 dark:border-slate-800 pb-2.5">
          系统与窗口偏好
        </strong>

        {s.preferences ? (
          <div className="space-y-3.5">
            {/* 关闭窗口行为选择 */}
            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 block">
                    点击关闭按钮时
                  </span>
                  <span className="text-[11px] text-slate-400">
                    控制点击窗口右上角关闭按钮或接收系统关闭信号时的默认处理方式
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800">
                  {s.preferences.closeAction === "minimize" ? "最小化到托盘" : s.preferences.closeAction === "exit" ? "直接退出" : "每次询问"}
                </span>
              </div>

              {/* 三项单选 Radio */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                {(
                  [
                    ["ask", "每次询问", "弹出退出或最小化确认框"],
                    ["minimize", "最小化到托盘", "保持后台代理与分流服务"],
                    ["exit", "直接退出程序", "停止所有代理并彻底关闭"],
                  ] as const
                ).map(([act, title, hint]) => {
                  const currentAct = s.preferences?.closeAction || (s.preferences?.minimizeOnClose ? "minimize" : "ask");
                  const isChecked = currentAct === act;
                  return (
                    <label
                      key={act}
                      onClick={() => {
                        s.actions.setPreferences({
                          ...s.preferences!,
                          closeAction: act,
                          minimizeOnClose: act === "minimize",
                        });
                      }}
                      className={`p-2.5 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                        isChecked
                          ? "bg-indigo-50/60 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-600 shadow-2xs"
                          : "bg-white dark:bg-slate-900 border-slate-200/70 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-xs text-slate-800 dark:text-slate-100 font-semibold">
                          {title}
                        </strong>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          isChecked ? "border-indigo-600 dark:border-indigo-400" : "border-slate-300 dark:border-slate-700"
                        }`}>
                          {isChecked && <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1">{hint}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 开机自启与静默启动勾选项 */}
            {(
              [
                ["autoStart", standalone ? "开机自启 ProcWeaver Process" : "开机自启 ProcWeaver", "系统启动时自动在后台唤醒独立进程分流服务"],
                ["silentStart", "启动时隐藏主窗口", "开机或启动时不主动弹出窗口，保持静默运行"],
              ] as const
            ).map(([key, label, desc]) => (
              <label
                key={key}
                className="flex items-start justify-between gap-4 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-950 transition cursor-pointer select-none"
              >
                <div>
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 block">
                    {label}
                  </span>
                  <span className="text-[11px] text-slate-400">{desc}</span>
                </div>
                <input
                  type="checkbox"
                  checked={s.preferences![key]}
                  disabled={s.busy}
                  onChange={(e) =>
                    s.actions.setPreferences({
                      ...s.preferences!,
                      [key]: e.target.checked,
                    })
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </label>
            ))}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center space-x-1.5"
                disabled={s.busy}
                onClick={() => void s.actions.save()}
              >
                {s.busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>{s.busy ? "正在保存…" : "保存偏好设置"}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-slate-500">
              {s.busy ? "正在读取偏好设置…" : "偏好设置尚未加载"}
            </span>
            <button
              type="button"
              disabled={s.busy}
              className={baseBtn}
              onClick={() => void s.actions.loadPreferences()}
            >
              重新读取
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
