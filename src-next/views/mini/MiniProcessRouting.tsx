import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Package } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { fetchBundles, fetchProcessRoutingState, saveProcessRoutingState, updateBundleInstance } from "../../services/processRoutingService";
import { usesExistingBundleRules } from "../../types/processRouting";
import type { ProcessBundleItem, ProcessRoutingState } from "../../types/processRouting";

interface MiniProcessRoutingProps {
  onManage?: () => void;
  onShowNotice?: (message: string) => void;
}

export function MiniProcessRouting({ onManage, onShowNotice }: MiniProcessRoutingProps) {
  const [state, setState] = useState<ProcessRoutingState | null>(null);
  const [bundles, setBundles] = useState<ProcessBundleItem[]>([]);
  const [reading, setReading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const readId = useRef(0);

  const load = useCallback(async () => {
    const id = ++readId.current;
    setReading(true);
    try {
      const [routing, items] = await Promise.all([fetchProcessRoutingState({ strict: true }), fetchBundles({ strict: true })]);
      if (id !== readId.current) return;
      setState(routing);
      setBundles(items);
      setReadFailed(false);
    } catch {
      if (id === readId.current) setReadFailed(true);
    } finally {
      if (id === readId.current) setReading(false);
    }
  }, []);

  useEffect(() => {
    const reload = () => void load();
    reload();
    window.addEventListener("netbox-route-changed", reload);
    return () => {
      ++readId.current;
      window.removeEventListener("netbox-route-changed", reload);
    };
  }, [load]);

  const enabled = Boolean(state?.processEnabled && state.bundlesEnabled);
  const enabledBundles = bundles.filter((bundle) => bundle.enabled).length;

  const toggleMaster = async (checked: boolean) => {
    if (!state || pending || readFailed) return;
    setPending("master");
    try {
      const next = { ...state, processEnabled: checked, bundlesEnabled: checked };
      await saveProcessRoutingState(next);
      setState(next);
      onShowNotice?.(checked ? "已开启进程分流" : "已暂停进程分流");
    } catch (error) {
      onShowNotice?.("切换进程分流失败，" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(null);
    }
  };

  const toggleBundle = async (bundle: ProcessBundleItem, checked: boolean) => {
    if (pending || !enabled || readFailed) return;
    setPending(bundle.id);
    try {
      setBundles(await updateBundleInstance(bundle.id, { enabled: checked }));
      onShowNotice?.((checked ? "已启用 " : "已停用 ") + bundle.name);
    } catch (error) {
      onShowNotice?.("切换规则包失败，" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="workbench-mini-page" aria-label="挂件进程分流">
      <section className="workbench-panel workbench-mini-panel" aria-label="进程分流总控">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold">进程分流总控</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {readFailed ? "读取失败" : !state ? "正在读取…" : enabled ? "已开启 · " + state.matchedProcessCount + " 个匹配进程" : "已暂停"}
            </p>
          </div>
          {readFailed ? <Button type="button" size="sm" onClick={() => void load()} disabled={reading}>重试</Button> : (
            <CapsuleToggle title="进程分流总开关" checked={enabled} disabled={!state || reading || pending !== null}
              onChange={(checked) => void toggleMaster(checked)} />
          )}
        </div>
      </section>
      <section className="workbench-panel workbench-mini-panel" aria-label="挂件业务规则包">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-[13px] font-semibold">业务规则包</h3>
            {!!state && !readFailed && <span className="text-[11px] tabular-nums text-[var(--text-muted)]">启用 {enabledBundles} / {bundles.length}</span>}
          </div>
          {onManage && (
            <Button type="button" size="sm" variant="ghost" onClick={onManage}>
              管理规则包 <ArrowUpRight size={13} aria-hidden="true" />
            </Button>
          )}
        </div>
        {readFailed ? <p className="text-xs text-[var(--text-muted)]" role="status">暂时无法读取规则包。</p> : (
          <ul className="grid min-w-0 gap-2">
            {bundles.length === 0 && (
              <li className="py-3 text-center text-xs text-[var(--text-muted)]">{reading ? "正在读取规则包…" : "暂无业务规则包"}</li>
            )}
            {bundles.map((bundle) => {
              const process = bundle.mainExe || bundle.exes[0];
              const moreProcesses = bundle.exes.length > 1 ? " 等 " + bundle.exes.length + " 个进程" : "";
              const useExistingRules = usesExistingBundleRules(bundle);
              const target = bundle.targetProxy || "待绑定出口";
              return (
                <li key={bundle.id} className="workbench-mini-bundle">
                  <span className="workbench-mini-glyph" aria-hidden="true"><Package size={15} /></span>
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-[12px] font-semibold" title={bundle.name}>{bundle.name}</strong>
                    {process && <span className="truncate text-[11px] text-[var(--text-muted)]" title={bundle.exes.join("、")}>{process}{moreProcesses}</span>}
                    <span className="truncate text-[11px] text-[var(--text-secondary)]" title={target}>
                      {target}{useExistingRules && " · 按现有规则"}
                    </span>
                  </div>
                  <CapsuleToggle
                    title={"启用 " + bundle.name}
                    checked={bundle.enabled}
                    disabled={!enabled || reading || pending !== null || (!bundle.enabled && !bundle.targetProxy.trim())}
                    onChange={(checked) => void toggleBundle(bundle, checked)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
