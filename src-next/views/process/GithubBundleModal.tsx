import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Pencil, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { requestRepository } from "../../../src/api/bundleRepositories";
import { useBundleRepositories } from "../../../src/hooks/useBundleRepositories";
import {
  DEFAULT_REPOSITORY, downloadRepositoryPackage, isDefaultRepository, normalizeRepository, testGithubRepositoryConnection,
} from "../../../src/services/bundleRepositories";
import type { BundleRepository, RepositoryPackage } from "../../../src/types/bundleRepository";
import { Button } from "../../primitives/Button";
import { Modal } from "../../primitives/Modal";
import { isRepositoryPackageMounted } from "../../services/processRoutingService";
import type { ProcessBundleItem } from "../../types/processRouting";

interface GithubBundleModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingBundles: ProcessBundleItem[];
  onMount: (item: RepositoryPackage) => Promise<void>;
}

export function GithubBundleModal({ isOpen, onClose, existingBundles, onMount }: GithubBundleModalProps) {
  const { state, actions } = useBundleRepositories(isOpen, "github");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<BundleRepository | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [proxyDraft, setProxyDraft] = useState<string | null>(null);
  const [testingProxy, setTestingProxy] = useState(false);
  const [proxyResult, setProxyResult] = useState<{ text: string; failed: boolean } | null>(null);
  const download = useRef<AbortController | null>(null);
  const proxyTest = useRef<AbortController | null>(null);
  const sources = state.repositories.filter((source) => source.kind === "github");
  const source = sources.find((candidate) => candidate.id === selectedId) ?? sources[0];
  const status = source && state.statuses[source.id];
  const busy = !!installing || testingProxy;

  useEffect(() => () => {
    download.current?.abort();
    proxyTest.current?.abort();
  }, []);

  const closeProxySettings = () => {
    proxyTest.current?.abort();
    proxyTest.current = null;
    setTestingProxy(false);
    setProxyDraft(null);
    setProxyResult(null);
  };

  const close = () => {
    download.current?.abort();
    closeProxySettings();
    setDraft(null);
    setError("");
    onClose();
  };

  const addSource = () => {
    closeProxySettings();
    setError("");
    setDraft({ id: crypto.randomUUID(), name: "GitHub", kind: "github", url: "", branch: "", directory: "", enabled: true });
  };

  const saveSource = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setError("");
    try {
      const next = normalizeRepository(draft);
      const directory = !draft.directory.trim() && !next.directory ? "Business-Rules" : next.directory;
      const repo = { ...next, directory };
      const name = isDefaultRepository(repo) ? DEFAULT_REPOSITORY.name : new URL(next.url).pathname.slice(1, 81);
      if (actions.upsert({ ...repo, name })) {
        setSelectedId(next.id);
        setDraft(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub 来源地址无效");
    }
  };

  const saveProxy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (proxyDraft !== null && actions.setGithubProxy(proxyDraft)) closeProxySettings();
  };

  const testProxy = async () => {
    if (proxyDraft === null || proxyTest.current) return;
    const check = new AbortController();
    proxyTest.current = check;
    setTestingProxy(true);
    setProxyResult(null);
    try {
      const result = await testGithubRepositoryConnection(source ?? DEFAULT_REPOSITORY, requestRepository, check.signal, proxyDraft);
      if (!check.signal.aborted) setProxyResult({ text: result, failed: false });
    } catch (error) {
      if (!check.signal.aborted) setProxyResult({ text: error instanceof Error ? error.message : String(error), failed: true });
    } finally {
      if (proxyTest.current === check) {
        proxyTest.current = null;
        setTestingProxy(false);
      }
    }
  };

  const install = async (repo: BundleRepository, item: RepositoryPackage) => {
    if (download.current) return;
    const request = new AbortController();
    download.current = request;
    setInstalling(item.key);
    setError("");
    try {
      const ready = await downloadRepositoryPackage(repo, item, requestRepository, request.signal, state.githubProxy);
      if (!request.signal.aborted) await onMount(ready);
    } catch (reason) {
      if (!request.signal.aborted) setError(typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "规则包挂载失败");
    } finally {
      download.current = null;
      setInstalling(null);
    }
  };

  return (
    <Modal isOpen={isOpen} title="GitHub 业务包" onClose={close} wide>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          {source && (
            <label className="grid min-w-[180px] flex-1 gap-1 text-xs font-medium">
              GitHub 来源
              <select className="workbench-field min-h-8 px-2" value={source.id} disabled={busy} onChange={(event) => {
                setSelectedId(event.target.value);
                setDraft(null);
                setError("");
                setProxyResult(null);
              }}>
                {sources.map((repo) => (
                  <option value={repo.id} key={repo.id}>
                    {repo.name} · {repo.branch || "默认分支"} / {repo.directory || "根目录"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button type="button" size="sm" variant="primary" disabled={busy} onClick={addSource}>
            <Plus size={14} aria-hidden="true" /> 添加来源
          </Button>
          {source && (
            <div className="flex gap-2">
              {source.enabled ? (
                <Button type="button" size="sm" loading={status?.loading} disabled={busy} onClick={() => void actions.refresh(source.id)}>
                  <RefreshCw size={14} aria-hidden="true" /> 刷新
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={busy} onClick={() => actions.toggle(source.id)}>启用来源</Button>
              )}
              <Button type="button" size="sm" disabled={busy} aria-label="编辑来源" title="编辑来源" onClick={() => {
                closeProxySettings();
                setError("");
                setDraft({ ...source, directory: source.directory || "/" });
              }}>
                <Pencil size={14} aria-hidden="true" />
              </Button>
              <Button type="button" size="sm" disabled={busy} aria-label="移除来源" title="移除来源" onClick={() => {
                if (actions.remove(source.id)) {
                  setDraft(null);
                  setError("");
                  setProxyResult(null);
                }
              }}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          )}
          <Button type="button" size="sm" disabled={busy} aria-expanded={proxyDraft !== null} onClick={() => {
            if (proxyDraft !== null) {
              closeProxySettings();
              return;
            }
            setDraft(null);
            setError("");
            setProxyDraft(state.githubProxy);
          }}>
            <Settings2 size={14} aria-hidden="true" /> 下载设置
          </Button>
        </div>

        {proxyDraft !== null && (
          <form onSubmit={saveProxy} className="workbench-panel grid gap-3 p-3 text-xs">
            <label className="grid gap-1">
              GitHub 代理地址
              <input className="workbench-field min-h-9 w-full px-3" value={proxyDraft} disabled={busy}
                maxLength={2048} placeholder="https://proxy.example.com/" aria-describedby="github-proxy-hint"
                onChange={(event) => { setProxyDraft(event.target.value); setProxyResult(null); }} />
            </label>
            <p id="github-proxy-hint" className="text-[var(--text-secondary)]">填写加速服务的 HTTPS 前缀，应用于所有 GitHub 来源。留空沿用现有网络。</p>
            {proxyResult && (
              <p role={proxyResult.failed ? "alert" : "status"}
                className={proxyResult.failed ? "text-[var(--workbench-danger)]" : "text-[var(--text-secondary)]"}>
                {proxyResult.text}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={closeProxySettings}>取消</Button>
              <Button type="button" size="sm" loading={testingProxy} disabled={!!installing} onClick={() => void testProxy()}>测试连接</Button>
              <Button type="submit" size="sm" variant="primary" disabled={busy}>保存设置</Button>
            </div>
          </form>
        )}

        {draft && (
          <form onSubmit={saveSource} className="workbench-panel grid gap-3 p-3 text-xs">
            <label className="grid gap-1">
              GitHub 仓库地址
              <input className="workbench-field min-h-9 w-full px-3" required maxLength={2048} placeholder="https://github.com/所有者/仓库" value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                分支或标签
                <input className="workbench-field min-h-9 w-full px-3" maxLength={200} placeholder="留空使用默认分支" value={draft.branch}
                  onChange={(event) => setDraft({ ...draft, branch: event.target.value })} />
              </label>
              <label className="grid gap-1">
                规则包目录
                <input className="workbench-field min-h-9 w-full px-3" maxLength={400} placeholder="Business-Rules，根目录填 /" value={draft.directory}
                  onChange={(event) => setDraft({ ...draft, directory: event.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(null); setError(""); }}>取消</Button>
              <Button type="submit" size="sm" variant="primary" disabled={!!installing}>保存来源</Button>
            </div>
          </form>
        )}

        {(error || state.error) && <p role="alert" className="text-xs text-[var(--workbench-danger)]">{error || state.error}</p>}
        {!source && !draft && <p className="text-sm text-[var(--text-muted)]">添加公开 GitHub 仓库，读取其中的 .pwpack.json 规则包。</p>}
        {source && !source.enabled && <p className="text-sm text-[var(--text-muted)]">该来源已停用</p>}
        {source?.enabled && status?.error && <p role="alert" className="text-xs text-[var(--workbench-danger)]">{status.error}</p>}
        {source?.enabled && status?.loading && <p role="status" className="text-xs text-[var(--text-muted)]">正在读取仓库规则包</p>}
        {source?.enabled && !status?.loading && status?.fetched && !status.error && !status.packages.length && (
          <p className="text-sm text-[var(--text-muted)]">该目录暂无 .pwpack.json 规则包</p>
        )}
        {source?.enabled && !!status?.warnings.length && (
          <ul className="grid gap-1 text-xs text-[var(--workbench-warning)]" aria-label="未读取的规则包">
            {status.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
          </ul>
        )}
        {source?.enabled && !!status?.packages.length && (
          <ul className="grid gap-2" aria-label="仓库规则包">
            {status.packages.map((item) => {
              const mounted = isRepositoryPackageMounted(existingBundles, item);
              return (
                <li key={item.key} className="workbench-panel flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">{item.definition.packageName}</p>
                    <p className="text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">{item.definition.packageVersion}</p>
                    {item.definition.description && <p className="mt-1 text-xs text-[var(--text-secondary)] [overflow-wrap:anywhere]">{item.definition.description}</p>}
                  </div>
                  <Button type="button" size="sm" variant="primary" loading={installing === item.key}
                    disabled={mounted || busy} onClick={() => void install(source, item)}>
                    <Download size={14} aria-hidden="true" /> {mounted ? "已挂载" : "下载并挂载"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
