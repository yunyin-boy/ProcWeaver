import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { BundleRepository } from "../../types/bundleRepository";

const inputClass =
  "w-full rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-100/80 dark:bg-black/45 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3)] px-3 py-2 text-xs text-slate-800 dark:text-zinc-200 outline-none focus:border-white/20 transition-colors";
const buttonClass =
  "rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300 transition cursor-pointer disabled:opacity-50";

interface Props {
  open: boolean;
  repositories: BundleRepository[];
  error: string;
  onClose(): void;
  onSave(repo: BundleRepository): boolean;
  onToggle(id: string): void;
  onRemove(id: string): boolean;
}

export function RepositoryManager({
  open,
  repositories,
  error,
  onClose,
  onSave,
  onToggle,
  onRemove,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<BundleRepository | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    setDraft(null);
    setRemoving(null);
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  useEffect(() => {
    if (draft) nameRef.current?.focus();
  }, [draft?.id]);

  if (!open) return null;

  const add = () => {
    setRemoving(null);
    setDraft({
      id: crypto.randomUUID(),
      name: "",
      kind: "github",
      url: "",
      branch: "",
      directory: "",
      enabled: true,
    });
  };

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="repository-manager-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
            onClose();
          }
        }
      }}
      className="m-auto w-[min(46rem,calc(100vw-2rem))] max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#0d1015]/95 backdrop-blur-2xl text-slate-800 dark:text-zinc-200 p-0 shadow-[-25px_25px_60px_-10px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop:bg-black/60 font-sans"
    >
      <header className="flex justify-between items-center p-5 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-black/30">
        <div>
          <h2 id="repository-manager-title" className="text-sm font-bold text-slate-900 dark:text-zinc-100">
            管理规则仓库来源
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            最多 20 个来源；停用或删除来源后，已装载套件仍然保留。
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-white/5 border border-white/10 rounded">
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭仓库管理"
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="p-5 space-y-4 text-xs">
        <ul className="space-y-2">
          {repositories.map((repo) => (
            <li
              key={repo.id}
              className="rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#121316]/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] p-3"
            >
              <div className="flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100 break-words flex items-center gap-1.5">
                    <span>{repo.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 break-all mt-1 font-mono">
                    {repo.url}
                  </p>
                  {repo.kind === "github" && (
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-1 break-words">
                      {repo.branch || "默认分支"} · {repo.directory || "根目录"}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={repo.enabled}
                    aria-label={`${repo.enabled ? "停用" : "启用"}仓库 ${repo.name}`}
                    onClick={() => onToggle(repo.id)}
                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
                      repo.enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
                        repo.enabled ? "left-0.5 translate-x-4" : "left-0.5"
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`编辑仓库 ${repo.name}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer"
                    onClick={() => {
                      setRemoving(null);
                      setDraft({ ...repo });
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除仓库 ${repo.name}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer"
                    onClick={() => setRemoving(repo.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {removing === repo.id && (
                <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs space-y-2">
                  <p>删除「{repo.name}」的仓库配置？已装载套件和出口绑定保持不变。</p>
                  <div className="flex gap-2">
                    <button type="button" className={buttonClass} onClick={() => setRemoving(null)}>
                      取消删除
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium cursor-pointer transition"
                      onClick={() => {
                        if (onRemove(repo.id)) {
                          setRemoving(null);
                          if (draft?.id === repo.id) setDraft(null);
                        }
                      }}
                    >
                      确认删除来源
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="rounded-xl p-3 bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 text-xs break-words">
            {error}
          </p>
        )}

        {draft ? (
          <form
            aria-label="仓库配置"
            className="rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white dark:bg-[#121316]/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] p-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (onSave(draft)) setDraft(null);
            }}
          >
            <h3 className="text-xs font-bold text-slate-900 dark:text-zinc-100">
              {repositories.some((r) => r.id === draft.id) ? "编辑仓库来源" : "添加新仓库来源"}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-slate-600 dark:text-zinc-400">仓库名称</span>
                <input
                  ref={nameRef}
                  required
                  maxLength={80}
                  className={inputClass}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-slate-600 dark:text-zinc-400">来源类型</span>
                <select
                  className={inputClass}
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({ ...draft, kind: e.target.value as BundleRepository["kind"] })
                  }
                >
                  <option value="github">GitHub 公开仓库</option>
                  <option value="index">HTTPS JSON 索引</option>
                </select>
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-slate-600 dark:text-zinc-400">仓库地址</span>
              <input
                required
                className={inputClass}
                value={draft.url}
                maxLength={2048}
                placeholder={
                  draft.kind === "github"
                    ? "https://github.com/所有者/仓库/tree/main/Business-Rules"
                    : "https://example.com/rules/index.json"
                }
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </label>
            {draft.kind === "github" ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 block">
                    <span className="text-slate-600 dark:text-zinc-400">分支 / 标签（可选）</span>
                    <input
                      className={inputClass}
                      value={draft.branch}
                      maxLength={200}
                      placeholder="留空使用目录链接或仓库默认分支"
                      onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-slate-600 dark:text-zinc-400">规则包目录（可选）</span>
                    <input
                      className={inputClass}
                      value={draft.directory}
                      maxLength={400}
                      placeholder="例如 Business-Rules；留空读取链接目录"
                      onChange={(e) => setDraft({ ...draft, directory: e.target.value })}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  读取指定目录下的 .pwpack.json 文件。分支名含 / 时，请使用仓库首页地址并单独填写分支和目录。
                </p>
              </>
            ) : (
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 space-y-1">
                <p>支持直接填写 .pwpack.json 地址，或提供 packages 列表；文件地址可相对于索引。</p>
                <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-100/80 dark:bg-black/45 p-2 font-mono">
                  {'{"packages":["browser.pwpack.json","tools.pwpack.json"]}'}
                </pre>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1 border-t border-slate-100 dark:border-white/[0.06]">
              <button type="button" className={buttonClass} onClick={() => setDraft(null)}>
                取消编辑
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] active:scale-95 transition cursor-pointer"
              >
                保存仓库
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            disabled={repositories.length >= 20 || !repositories.length}
            onClick={add}
            className="inline-flex gap-1.5 items-center rounded-xl px-4 py-1.5 text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] active:scale-95 transition cursor-pointer disabled:opacity-50"
          >
            <Plus size={14} className="text-zinc-950" />
            <span>添加仓库</span>
          </button>
        )}
      </div>
    </dialog>,
    document.body
  );
}
