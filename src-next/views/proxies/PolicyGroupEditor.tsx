import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ListPlus, Plus, Search, X, Zap } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { Modal } from "../../primitives/Modal";
import { checkPolicyGroupNow, measurePolicyGroupNodes, type PolicyGroup, type PolicyGroupEntry, type PolicyGroupProbe,
  type PolicyGroupRow, type PolicyGroupWorkbench } from "../../services/policyGroupsService";
import { fromConditions, matchesConditions, measuredDelay, PolicyGroupConditionsPanel, toConditions }
  from "./PolicyGroupConditionsPanel";

const ENTRY_LABELS: Record<PolicyGroupEntry["kind"], string> = {
  select: "手动选择",
  "url-test": "自动优选",
  group: "策略组",
  node: "节点",
  action: "内置动作",
};

function probeLabel(probe: PolicyGroupProbe | undefined, now: number, pending: boolean): string {
  if (pending) return "测速中";
  if (!probe) return "未测速";
  switch (probe.status) {
    case "passed": return measuredDelay(probe, now) === null ? "已过期" : probe.delayMs + " ms";
    case "expired": return "已过期";
    case "timeout": return "超时";
    case "failed": return "失败";
    case "unavailable": return "接口不可用";
  }
}

interface PolicyGroupEditorProps {
  context: PolicyGroupWorkbench;
  liveContext: PolicyGroupWorkbench | null;
  current?: PolicyGroupRow;
  onSave: (group: PolicyGroup) => Promise<void>;
  onClose: () => void;
}

export function PolicyGroupEditor({ context, liveContext, current, onSave, onClose }: PolicyGroupEditorProps) {
  const formId = useId();
  const nameId = useId();
  const otherParentsId = useId();
  const [name, setName] = useState(current?.name ?? "");
  const [strategy, setStrategy] = useState<PolicyGroup["strategy"]>(current?.strategy ?? "select");
  const [members, setMembers] = useState<string[]>(current?.members ?? []);
  const [parents, setParents] = useState<string[]>(() => current?.parents
    ?? (context.primarySelector ? [context.primarySelector] : []));
  const [showOtherParents, setShowOtherParents] = useState(false);
  const [useConditions, setUseConditions] = useState(Boolean(current?.automatic));
  const [draft, setDraft] = useState(() => fromConditions(current?.automatic));
  const [manualProbes, setManualProbes] = useState(() => new Map<string, PolicyGroupProbe>());
  const [pending, setPending] = useState(new Set<string>());
  const [now, setNow] = useState(Date.now);
  const measuring = useRef(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(80);
  const [saving, setSaving] = useState(false);
  const [requestingCheck, setRequestingCheck] = useState(false);
  const [error, setError] = useState("");
  const live = liveContext?.profileId === context.profileId ? liveContext : context;
  const saved = current && live.groups.find(group => group.name === current.name);
  const running = live.running && (!liveContext || liveContext.profileId === context.profileId);
  const probes = new Map(live.probes.map(probe => [probe.name, probe]));
  for (const probe of manualProbes.values()) {
    if (probe.expiresAt > (probes.get(probe.name)?.expiresAt ?? 0)) probes.set(probe.name, probe);
  }
  const proxyIsPrimary = context.primarySelector === "PROXY";
  const proxyLabel = proxyIsPrimary ? "节点选择" : "公共出口";
  const labelledEntries = live.entries.map(entry => entry.name === "PROXY" ? { ...entry, label: proxyLabel } : entry);
  const entries = new Map(labelledEntries.map(entry => [entry.name, entry]));
  const term = search.trim().toLowerCase();
  const choices = labelledEntries.filter(entry =>
    entry.name !== current?.name && !members.includes(entry.name)
    && (entry.name !== "PROXY" || proxyIsPrimary)
    && (entry.label.toLowerCase().includes(term) || entry.name.toLowerCase().includes(term)));
  const manualGroups = labelledEntries.filter(entry => entry.kind === "select" && entry.name !== current?.name
    && (entry.name !== "PROXY" || proxyIsPrimary || current?.parents.includes(entry.name)));
  const primary = manualGroups.find(entry => entry.name === context.primarySelector);
  const otherParents = manualGroups.filter(entry => entry !== primary);
  const missingParents = parents.filter(parent => !manualGroups.some(entry => entry.name === parent));
  const otherSelected = otherParents.filter(entry => parents.includes(entry.name)).length;
  const conditions = toConditions(draft);
  const checkSaved = Boolean(saved?.automatic && members.length === saved.members.length
    && members.every(member => saved.members.includes(member))
    && JSON.stringify({ ...conditions, checkIntervalMinutes: saved.automatic.checkIntervalMinutes })
      === JSON.stringify(toConditions(fromConditions(saved.automatic))));
  const checking = requestingCheck || Boolean(checkSaved && saved?.checkStatus?.checking);
  const matches = useConditions ? live.entries.filter(entry =>
    !members.includes(entry.name) && matchesConditions(entry, conditions)) : [];
  const admitted = matches.filter(entry => {
    const delay = measuredDelay(probes.get(entry.name), now);
    return delay !== null && (conditions.maxDelayMs === null || delay <= conditions.maxDelayMs);
  });
  const notMeasured = matches.filter(entry => (probes.get(entry.name)?.expiresAt ?? 0) <= now);
  const needsProof = members.some(member => !current?.members.includes(member) && entries.get(member)?.kind === "node"
    && measuredDelay(probes.get(member), now) === null);
  const canSave = Boolean(name.trim()) && (members.length > 0 || useConditions) && !needsProof && pending.size === 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const measure = async (selected: PolicyGroupEntry[]) => {
    const names = selected.filter(entry => entry.node).map(entry => entry.name);
    if (!running || names.length === 0 || measuring.current || saving) return;
    measuring.current = true;
    setPending(new Set(names));
    setError("");
    try {
      for (let offset = 0; offset < names.length; offset += 4096) {
        const results = await measurePolicyGroupNodes(context, names.slice(offset, offset + 4096));
        setManualProbes(previous => {
          const next = new Map(previous);
          for (const result of results) next.set(result.name, result);
          return next;
        });
      }
      setNow(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      measuring.current = false;
      setPending(new Set());
    }
  };

  const measureMatches = async () => {
    if (!checkSaved || !saved) {
      await measure(matches);
      return;
    }
    setRequestingCheck(true);
    setError("");
    try {
      await checkPolicyGroupNow(context.profileId, saved.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRequestingCheck(false);
    }
  };

  const move = (index: number, offset: number) => {
    const next = [...members];
    const other = index + offset;
    [next[index], next[other]] = [next[other], next[index]];
    setMembers(next);
  };
  const toggleParent = (parent: string) => setParents(current => current.includes(parent)
    ? current.filter(item => item !== parent) : [...current, parent]);

  const parentOption = (name: string, label: string, missing = false) => (
    <label className="workbench-policy-parent" key={name} title={label}
      data-selected={parents.includes(name)} data-missing={missing || undefined}>
      <input type="checkbox" checked={parents.includes(name)} disabled={saving} onChange={() => toggleParent(name)} />
      <span className="min-w-0 truncate">{label}</span>
      {missing && <span className="shrink-0 text-[11px]">失效</span>}
    </label>
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), strategy, members, parents,
        automatic: useConditions ? conditions : undefined });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen wide title={current ? "编辑策略组" : "新建策略组"} subtitle={"当前方案 · " + context.profileName}
      onClose={() => { if (!saving) onClose(); }} footer={(
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {(needsProof || error) && <div className="grid min-w-0 flex-1 basis-52 gap-1 text-xs [overflow-wrap:anywhere]">
            {needsProof && <p className="text-[var(--workbench-warning)]">请重新测试已选节点中的过期或失败项。</p>}
            {error && <p role="alert" className="text-[var(--workbench-danger)]">{error}</p>}
          </div>}
          <div className="ml-auto flex gap-2">
            <Button type="button" size="lg" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
            <Button type="submit" form={formId} size="lg" variant="primary" disabled={!canSave} loading={saving}>
              {context.running ? "保存并应用" : "保存策略组"}
            </Button>
          </div>
        </div>
      )}>
      <form id={formId} className="workbench-policy-form grid min-w-0 gap-4" onSubmit={submit}>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <label htmlFor={nameId} className="grid gap-1.5 text-[13px] font-semibold">
            组名称
            <input id={nameId} value={name} maxLength={80} required autoFocus={!current} readOnly={Boolean(current)}
              disabled={saving} placeholder="例如 浏览器出口" className="min-h-9 min-w-0 px-3 text-[13px] font-normal"
              onChange={event => setName(event.target.value)} />
          </label>
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-semibold">策略类型</span>
            <div className="workbench-segments min-h-9" role="group" aria-label="策略类型">
              <button type="button" aria-pressed={strategy === "select"} disabled={saving}
                onClick={() => setStrategy("select")}>手动选择</button>
              <button type="button" aria-pressed={strategy === "url-test"} disabled={saving}
                onClick={() => setStrategy("url-test")}>自动优选</button>
            </div>
          </div>
        </div>

        {(manualGroups.length > 0 || missingParents.length > 0) && (
          <fieldset className="workbench-policy-inset min-w-0">
            <legend className="sr-only">加入手动组</legend>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 text-[13px] font-semibold" aria-hidden="true">加入手动组</span>
                {primary && parentOption(primary.name, primary.label)}
              </div>
              {(otherParents.length > 0 || missingParents.length > 0) && (
                <Button type="button" variant="ghost" size="sm" aria-expanded={showOtherParents} aria-controls={otherParentsId}
                  onClick={() => setShowOtherParents(open => !open)}>
                  {primary ? "其他手动组" : "选择手动组"}
                  {otherSelected > 0 && <span className="workbench-tag">{otherSelected} 已选</span>}
                  {missingParents.length > 0 && <span className="workbench-tag workbench-tag-warning">{missingParents.length} 失效</span>}
                  <ChevronDown size={14} aria-hidden="true" className={showOtherParents ? "rotate-180" : undefined} />
                </Button>
              )}
            </div>
            {(otherParents.length > 0 || missingParents.length > 0) && (
              <div id={otherParentsId} hidden={!showOtherParents} className="px-3 pb-3">
                <div className="grid max-h-36 min-w-0 gap-1.5 overflow-auto sm:grid-cols-3">
                  {otherParents.map(entry => parentOption(entry.name, entry.label))}
                  {missingParents.map(parent => parentOption(parent, parent === "PROXY" ? proxyLabel : parent, true))}
                </div>
              </div>
            )}
          </fieldset>
        )}

        <div className="grid min-w-0 gap-2.5">
          <div className="flex min-w-0 items-stretch gap-2">
            <div className="workbench-field flex min-w-0 flex-1 items-center gap-2 px-3">
              <Search size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              <input type="search" aria-label="搜索成员" placeholder="搜索节点或策略组" value={search} disabled={saving}
                className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px]"
                onChange={event => { setSearch(event.target.value); setLimit(80); }} />
            </div>
            <Button type="button" className="shrink-0 whitespace-nowrap" title={context.testUrl}
              disabled={saving || !running || pending.size > 0 || !choices.some(entry => entry.node)}
              onClick={() => { void measure(choices); }}>
              <Zap size={14} aria-hidden="true" /> 测候选节点
            </Button>
          </div>
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
            <section className="workbench-policy-inset min-w-0" aria-label="可选成员">
              <header className="workbench-policy-list-header">
                <h4>可选成员</h4>
                <span className="text-[11px] font-normal text-[var(--text-muted)]">
                  {running ? "节点通过测速后可添加" : "启动核心后可测速"}
                </span>
              </header>
              <div className="workbench-policy-member-list">
                {choices.slice(0, limit).map(entry => {
                  const probe = probes.get(entry.name);
                  const passed = measuredDelay(probe, now) !== null;
                  return (
                    <div className="workbench-policy-member-row" key={entry.name}>
                      <button type="button" disabled={saving || pending.size > 0 || Boolean(entry.node && !passed)}
                        className="workbench-policy-member-add" title={entry.label}
                        aria-label={"添加成员 " + entry.label} onClick={() => setMembers(items => [...items, entry.name])}>
                        <Plus size={14} className="shrink-0 text-[var(--workbench-accent)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
                        {!entry.node && <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{ENTRY_LABELS[entry.kind]}</span>}
                      </button>
                      {entry.node && (
                        <>
                          <span className={"shrink-0 text-[11px] tabular-nums " + (passed
                            ? "text-[var(--workbench-positive)]" : "text-[var(--text-muted)]")}>
                            {probeLabel(probe, now, pending.has(entry.name))}
                          </span>
                          <button type="button" className="workbench-title-button shrink-0"
                            title={"测速 " + entry.label} aria-label={"测速 " + entry.label}
                            disabled={saving || !running || pending.size > 0}
                            onClick={() => { void measure([entry]); }}><Zap size={13} aria-hidden="true" /></button>
                        </>
                      )}
                    </div>
                  );
                })}
                {choices.length === 0 && <p className="workbench-policy-list-empty">没有匹配的成员</p>}
                {choices.length > limit && <Button type="button" size="sm" onClick={() => setLimit(count => count + 80)}>显示更多</Button>}
              </div>
            </section>
            <section className="workbench-policy-inset min-w-0" aria-label="已选成员">
              <header className="workbench-policy-list-header">
                <h4>已选成员</h4>
                <span className="workbench-tag tabular-nums">{members.length}</span>
              </header>
              <div className="workbench-policy-member-list">
                {members.map((member, index) => {
                  const entry = entries.get(member);
                  const label = entry?.label ?? (member === "PROXY" ? proxyLabel : member);
                  return (
                    <div className="workbench-policy-member-row" key={member}>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-xs" title={label}>{label}</span>
                      {!entry && <span className="workbench-tag text-[var(--workbench-warning)]">失效</span>}
                      {entry?.node && !current?.members.includes(member) && (
                        <button type="button" className="workbench-title-button" title={"重测 " + label}
                          aria-label={"重测 " + label} disabled={saving || !running || pending.size > 0}
                          onClick={() => { void measure([entry]); }}><Zap size={13} aria-hidden="true" /></button>
                      )}
                      <button type="button" className="workbench-title-button" aria-label={"上移 " + label}
                        disabled={saving || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                      <button type="button" className="workbench-title-button" aria-label={"下移 " + label}
                        disabled={saving || index + 1 === members.length} onClick={() => move(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                      <button type="button" className="workbench-title-button" aria-label={"移除 " + label} disabled={saving}
                        onClick={() => setMembers(items => items.filter(item => item !== member))}><X size={14} aria-hidden="true" /></button>
                    </div>
                  );
                })}
                {members.length === 0 && <div className="workbench-policy-list-empty">
                  <ListPlus size={23} aria-hidden="true" />
                  <p>从可选成员添加</p>
                </div>}
              </div>
            </section>
          </div>
        </div>

        <div className="workbench-policy-inset">
          <div className="flex min-h-11 items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">按条件自动加入</span>
              {useConditions && Boolean(saved?.automaticMembers.length) && <span className="workbench-tag">
                已自动加入 {saved?.automaticMembers.length} 个
              </span>}
            </div>
            <CapsuleToggle checked={useConditions} onChange={setUseConditions} disabled={saving || pending.size > 0}
              title="按条件自动加入" />
          </div>
          {useConditions && <PolicyGroupConditionsPanel entries={live.entries} draft={draft} onChange={setDraft}
            matched={matches.length} admitted={admitted.length} pending={notMeasured.length}
            disabled={saving || pending.size > 0} canMeasure={running && (checkSaved || matches.length > 0)}
            measureLabel={checkSaved ? "立即检测" : "测匹配节点"} checking={checking}
            status={saved?.checkStatus} preview={!checkSaved} onMeasure={() => { void measureMatches(); }} />}
        </div>
      </form>
    </Modal>
  );
}
