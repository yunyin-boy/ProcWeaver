import { useState } from "react";
import { ExternalLink, RefreshCw, Settings2, Search } from "lucide-react";
import type { BundleLocalInstance } from "../../types/businessBundle";
import type { BundleRepository, RepositoryPackage, RepositorySnapshot } from "../../types/bundleRepository";
import { RepositoryManager } from "./RepositoryManager";
import { usePlatform } from "../../context/PlatformContext";
import { bundleProcesses } from "../../utils/bundlePlatform";

interface Props {
  state: RepositorySnapshot;
  defaultId: string;
  instances: BundleLocalInstance[];
  onRefresh(id?: string): void;
  onReload(): void;
  onSave(repo: BundleRepository): boolean;
  onToggle(id: string): void;
  onRemove(id: string): boolean;
  onInstall(item: RepositoryPackage): void;
  repositoryLink(repo: BundleRepository): string;
}

const actionBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-xs font-medium text-slate-700 dark:text-zinc-300 transition cursor-pointer disabled:opacity-50";

export function RepositoryCenter(props: Props) {
  const platform = usePlatform();
  const { state } = props;
  const [selected, setSelected] = useState("all");
  const [manager, setManager] = useState(false);
  const [query, setQuery] = useState("");

  const enabled = state.repositories.filter((r) => r.enabled);
  const effectiveSelected = enabled.some((r) => r.id === selected) ? selected : "all";
  const visible = enabled.filter((r) => effectiveSelected === "all" || r.id === effectiveSelected);
  const loading = visible.some((r) => state.statuses[r.id]?.loading);
  const packages = visible
    .flatMap((r) => state.statuses[r.id]?.packages || [])
    .filter((p) =>
      `${p.definition.packageName} ${p.definition.description} ${p.definition.packageId}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );

  return (
    <section className="space-y-4">
      {/* 顶栏标题与操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">规则仓库业务套件</h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            已启用 {enabled.length} / {state.repositories.length} 个来源；装载新实例后再选择本机出口。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={actionBtn}
            disabled={loading || !enabled.length}
            onClick={() => props.onRefresh(effectiveSelected === "all" ? undefined : effectiveSelected)}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "刷新中…" : effectiveSelected === "all" ? "刷新全部仓库" : "刷新当前仓库"}</span>
          </button>
          <button type="button" className={actionBtn} onClick={() => setManager(true)}>
            <Settings2 size={13} />
            <span>管理仓库</span>
          </button>
        </div>
      </div>

      {/* 仓库来源过滤与搜索栏 (黑曜石微凹槽) */}
      <div className="flex flex-wrap gap-2.5">
        <label className="flex gap-2 items-center text-xs text-slate-600 dark:text-zinc-400 shrink-0">
          <span>仓库来源:</span>
          <select
            aria-label="筛选仓库来源"
            value={effectiveSelected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-100/80 dark:bg-black/45 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3)] px-3 py-1.5 text-xs text-slate-900 dark:text-zinc-100 outline-none max-w-60"
          >
            <option value="all">全部已启用仓库</option>
            {enabled.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 pointer-events-none" />
          <input
            aria-label="搜索仓库规则包"
            placeholder="搜索规则包名称、说明或 ID..."
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-100/80 dark:bg-black/45 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3)] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none focus:border-white/20"
          />
        </div>
      </div>

      {state.error && (
        <div role="alert" className="text-xs bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 p-3 rounded-xl flex gap-3 items-center justify-between">
          <span>{state.error}</span>
          <button type="button" className={actionBtn} onClick={props.onReload}>
            重新加载配置
          </button>
        </div>
      )}

      {/* 仓库状态列表 */}
      <div className="space-y-2">
        {visible.map((repo) => {
          const status = state.statuses[repo.id];
          return (
            <div
              key={repo.id}
              className="p-3 rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#121316]/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] text-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800 dark:text-zinc-100 break-words">{repo.name}</span>
                  <span className="ml-2 text-slate-500 dark:text-zinc-400 text-[11px]">
                    {status?.loading
                      ? "正在读取…"
                      : status?.error
                      ? status.packages.length
                        ? "刷新失败 · 显示上次成功结果"
                        : "读取失败"
                      : status?.fetched
                      ? `${status.packages.length} 个规则包`
                      : "等待读取"}
                  </span>
                  {status?.updatedAt && (
                    <span className="ml-2 text-slate-400 dark:text-zinc-500 text-[10px] font-mono">
                      {new Date(status.updatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={status?.loading}
                    aria-label={`刷新仓库 ${repo.name}`}
                    onClick={() => props.onRefresh(repo.id)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <a
                    aria-label={`访问仓库 ${repo.name}`}
                    href={props.repositoryLink(repo)}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
              {status?.error && (
                <p role="alert" className="text-rose-600 dark:text-rose-400 mt-2 break-words">
                  {status.error}
                </p>
              )}
              {!!status?.warnings.length && (
                <details className="mt-2 text-amber-600 dark:text-amber-400">
                  <summary className="cursor-pointer">{status.warnings.length} 项未载入，查看原因</summary>
                  <ul className="list-disc pl-5 mt-1 space-y-1 text-[11px]">
                    {status.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {/* 规则包网格展示 */}
      {!packages.length ? (
        <div className="p-10 text-center rounded-2xl bg-white dark:bg-[#121316]/60 border border-slate-200/80 dark:border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] text-xs text-slate-500 dark:text-zinc-400">
          {loading
            ? "正在读取规则包…"
            : !enabled.length
            ? "暂无启用的仓库，请在管理仓库中添加或启用来源。"
            : query
            ? "没有匹配的规则包。"
            : visible.some((r) => state.statuses[r.id]?.error)
            ? "暂时没有可用结果，请查看上方仓库错误并重试。"
            : "所选仓库暂未提供规则包。"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {packages.map((item) => {
            const bundle = {
              ...item.definition,
              processes: bundleProcesses(
                item.definition,
                platform.os === "android" ? "android" : platform.os === "macos" ? "macos" : "windows"
              ),
            };
            const installed = props.instances.some(
              (i) =>
                i.definition.packageId === bundle.packageId &&
                i.repositoryOrigin?.repositoryKey === item.origin.repositoryKey
            );
            return (
              <article
                key={item.key}
                className="p-4 rounded-2xl bg-white dark:bg-[#121316]/70 border border-slate-200/80 dark:border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] hover:border-slate-300 dark:hover:border-white/[0.18] transition space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex gap-3 items-start">
                    <span className="text-2xl p-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] shrink-0">
                      {bundle.icon || "📦"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-zinc-100 break-words flex items-center gap-1.5">
                        <span>{bundle.packageName}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-zinc-400 border border-slate-200/80 dark:border-white/[0.08]">
                          {bundle.packageVersion}
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 break-words leading-relaxed">
                        {bundle.description}
                      </p>
                      <p className="text-[10px] text-sky-600 dark:text-sky-400 mt-1.5 font-medium">
                        来源: {item.origin.repositoryName}
                      </p>
                    </div>
                  </div>

                  {/* 进程徽标清单 */}
                  <div className="flex flex-wrap gap-1">
                    {bundle.processes.slice(0, 8).map((p, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 text-[9px] font-mono rounded-md bg-slate-100 dark:bg-white/[0.04] text-slate-600 dark:text-zinc-400 border border-slate-200/60 dark:border-white/[0.06] break-all"
                      >
                        {p.exe}
                      </span>
                    ))}
                    {bundle.processes.length > 8 && (
                      <span className="text-[9px] text-slate-400 dark:text-zinc-500 self-center">
                        等 {bundle.processes.length} 个进程
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => props.onInstall(item)}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] active:scale-95 transition cursor-pointer"
                  >
                    {installed ? "再装载一个实例" : "装载到本机"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <RepositoryManager
        open={manager}
        onClose={() => setManager(false)}
        repositories={state.repositories}
        defaultId={props.defaultId}
        error={state.error}
        onSave={props.onSave}
        onToggle={props.onToggle}
        onRemove={props.onRemove}
      />
    </section>
  );
}
