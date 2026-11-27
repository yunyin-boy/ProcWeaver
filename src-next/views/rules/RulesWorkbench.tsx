import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { ConfirmModal } from "../../primitives/ConfirmModal";
import { saveCustomRules } from "../../services/rulesService";
import type { EngineMode } from "../../types/core";
import type { CustomRule, RuleItem, RuleWorkbenchState, SourceRule } from "../../types/rules";
import { ActiveRulesTab } from "./ActiveRulesTab";
import { CustomRuleForm, type RuleDraft } from "./CustomRuleForm";

interface RulesWorkbenchProps {
  rules: RuleItem[];
  context: RuleWorkbenchState | null;
  mode: EngineMode;
  onSaved: (next: RuleWorkbenchState) => void;
  onShowNotice?: (message: string) => void;
}

type Section = "effective" | "custom" | "source";
const SECTIONS = [
  { value: "effective", title: "已生效规则" },
  { value: "custom", title: "自定义规则" },
  { value: "source", title: "方案原规则" },
] as const;

interface Editing {
  context: RuleWorkbenchState;
  title: string;
  draft: RuleDraft;
}

function newRule(profileId: string): RuleDraft {
  return {
    id: crypto.randomUUID(), profileId, enabled: true,
    condition: { kind: "DOMAIN-SUFFIX", value: "", options: [] },
    action: { kind: "direct" },
  };
}

function describeAction(rule: CustomRule, context: RuleWorkbenchState) {
  if (rule.action.kind === "direct") return "直连";
  if (rule.action.kind === "reject") return "拒绝";
  const target = rule.action.target;
  return context.outlets.find((outlet) => outlet.target.profileId === target.profileId
    && outlet.target.kind === target.kind && outlet.target.name === target.name)?.label ?? target.name;
}

export function RulesWorkbench({ rules, context, mode, onSaved, onShowNotice }: RulesWorkbenchProps) {
  const [section, setSection] = useState<Section>("effective");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<{ rule: CustomRule; context: RuleWorkbenchState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const save = async (scope: RuleWorkbenchState, next: CustomRule[]) => {
    if (inFlight.current) throw new Error("正在应用规则");
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await saveCustomRules(scope, next);
      onSaved(saved);
      onShowNotice?.(mode !== "rule" ? "已保存，切换到规则模式后生效"
        : saved.running ? "自定义规则已应用" : "已保存，核心启动后生效");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const onActionError = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const add = () => {
    if (context) setEditing({ context, title: "新增规则", draft: newRule(context.profileId) });
  };
  const copy = (rule: SourceRule) => {
    if (context && rule.copy) setEditing({
      context, title: "复制为自定义",
      draft: { ...newRule(context.profileId), ...rule.copy },
    });
  };
  const move = (index: number, step: number) => {
    if (!context) return;
    const next = [...context.rules];
    const other = index + step;
    if (!next[other]) return;
    [next[index], next[other]] = [next[other], next[index]];
    void save(context, next).catch(onActionError);
  };
  const submit = async (rule: CustomRule) => {
    if (!editing) return;
    const scope = editing.context;
    const next = scope.rules.some((item) => item.id === rule.id)
      ? scope.rules.map((item) => item.id === rule.id ? rule : item)
      : [...scope.rules, rule];
    await save(scope, next);
    setEditing(null);
    setSection("custom");
  };
  const remove = async () => {
    if (!deleting) return;
    const { rule, context: scope } = deleting;
    try {
      await save(scope, scope.rules.filter((item) => item.id !== rule.id));
      setDeleting(null);
    } catch (reason) {
      setDeleting(null);
      onActionError(reason);
    }
  };

  return (
    <div className="grid min-w-0 gap-3">
      {context && (
        <section className="workbench-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3" aria-label="分流规则编辑">
          <div className="workbench-segments workbench-rule-tabs flex-wrap" role="group" aria-label="分流规则内容">
            {SECTIONS.map(({ value, title }) => (
              <button key={value} type="button" aria-pressed={value === section}
                onClick={() => setSection(value)} disabled={saving}>
                {title}
                {value === "custom" && <span className="text-[11px] tabular-nums">{context.rules.length}</span>}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="min-w-0 truncate text-xs text-[var(--text-muted)]" title={context.profileName}>{context.profileName}</span>
            <Button type="button" variant="primary" onClick={add} disabled={saving}>
              <Plus size={15} aria-hidden="true" />新增规则
            </Button>
          </div>
        </section>
      )}

      {error && <p role="alert" className="rounded-xl bg-[var(--workbench-danger-bg)] px-4 py-3 text-xs text-[var(--workbench-danger)]">{error}</p>}
      {(!context || section === "effective") && <ActiveRulesTab rules={rules} onShowNotice={onShowNotice} />}
      {context && section === "source" && <SchemeRules context={context} onCopy={copy} />}
      {context && section === "custom" && (
        <section className="workbench-panel divide-y divide-[var(--glass-border-subtle)] px-4" aria-label="自定义规则列表">
          {!context.rules.length && <p className="py-8 text-center text-sm text-[var(--text-muted)]">暂无自定义规则</p>}
          {context.rules.map((rule, index) => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3"
              data-custom-rule={rule.id}>
              <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
                <span className="shrink-0 pt-0.5 text-xs tabular-nums text-[var(--text-muted)]">{index + 1}</span>
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="workbench-tag font-mono">{rule.condition.kind}</span>
                    <span className="min-w-0 break-all font-mono text-[13px] font-medium">{rule.condition.value}</span>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                    <span>{rule.profileId === null ? "所有方案" : "当前方案"}</span>
                    <span className="min-w-0 break-all text-[var(--text-secondary)]">{describeAction(rule, context)}</span>
                    {rule.availability !== "ready" && (
                      <span className="text-[var(--workbench-warning)]">
                        {rule.availability === "missing_outlet" ? "出口不可用，启用时拒绝" : "当前方案缺少规则集"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <CapsuleToggle title={rule.enabled ? "停用规则" : "启用规则"} checked={rule.enabled} disabled={saving}
                  onChange={(enabled) => { void save(context, context.rules.map((item) => item.id === rule.id
                    ? { ...item, enabled } : item)).catch(onActionError); }} />
                <Button type="button" variant="ghost" size="sm" disabled={saving || index === 0}
                  aria-label="上移规则" title="上移规则" onClick={() => move(index, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={saving || index + 1 === context.rules.length}
                  aria-label="下移规则" title="下移规则" onClick={() => move(index, 1)}>
                  <ArrowDown size={14} aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={saving}
                  onClick={() => setEditing({ context, title: "编辑规则", draft: rule })}>编辑</Button>
                <Button type="button" variant="ghost" size="sm" disabled={saving}
                  onClick={() => setDeleting({ rule, context })}>删除</Button>
              </div>
            </div>
          ))}
        </section>
      )}
      {editing && (
        <CustomRuleForm title={editing.title} context={editing.context} initial={editing.draft}
          saving={saving} apply={editing.context.running && mode === "rule"}
          onSave={submit} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmModal isOpen title="删除规则" description={deleting.rule.condition.value}
          confirmText="删除规则" isLoading={saving} onConfirm={remove}
          onCancel={() => { if (!saving) setDeleting(null); }} />
      )}
    </div>
  );
}

const SOURCE_PAGE_SIZE = 50;

function SchemeRules({ context, onCopy }: { context: RuleWorkbenchState; onCopy: (rule: SourceRule) => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const matches = context.sourceRules.filter((rule) => rule.expression.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / SOURCE_PAGE_SIZE));
  const current = Math.min(page, pages);

  return (
    <section className="workbench-panel grid min-w-0 gap-3 p-4" aria-label="方案原规则列表">
      <div className="workbench-field flex items-center gap-2 px-2.5">
        <Search size={14} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
        <input type="search" aria-label="搜索方案原规则" placeholder="搜索方案原规则"
          className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px]" value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      </div>
      <div className="divide-y divide-[var(--glass-border-subtle)]">
        {!matches.length && <p className="py-7 text-center text-sm text-[var(--text-muted)]">暂无匹配的方案规则</p>}
        {matches.slice((current - 1) * SOURCE_PAGE_SIZE, current * SOURCE_PAGE_SIZE).map((rule) => (
          <div key={rule.order} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="flex min-w-0 flex-[1_1_15rem] items-center gap-2.5">
              <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{rule.order}</span>
              <span className="workbench-tag shrink-0">{context.sourceLabel}</span>
              <code className="min-w-0 break-all text-xs">{rule.expression}</code>
            </div>
            {rule.copy && <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(rule)}>复制为自定义</Button>}
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-[var(--text-muted)]">
          <Button type="button" size="sm" onClick={() => setPage(current - 1)} disabled={current <= 1}>上一页</Button>
          <span className="tabular-nums">{current} / {pages}</span>
          <Button type="button" size="sm" onClick={() => setPage(current + 1)} disabled={current >= pages}>下一页</Button>
        </div>
      )}
    </section>
  );
}
