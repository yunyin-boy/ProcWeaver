import { Button } from "../../primitives/Button";
import { POLICY_CHECK_INTERVALS, type PolicyCheckInterval, type PolicyCheckStatus,
  type PolicyGroupConditions, type PolicyGroupEntry, type PolicyGroupProbe } from "../../services/policyGroupsService";
import { getRegionDisplayName } from "../../utils/nodeParser";

export interface ConditionsDraft {
  regions: string[];
  protocols: string[];
  keywords: string;
  multiplier: string;
  delay: string;
  checkIntervalMinutes: PolicyCheckInterval;
}

export function fromConditions(value?: PolicyGroupConditions): ConditionsDraft {
  return {
    regions: value?.regions ?? [],
    protocols: value?.protocols ?? [],
    keywords: value?.keywords.join("，") ?? "",
    multiplier: value?.maxMultiplier?.toString() ?? "",
    delay: value?.maxDelayMs?.toString() ?? "",
    checkIntervalMinutes: value?.checkIntervalMinutes ?? POLICY_CHECK_INTERVALS[0],
  };
}

export function toConditions(draft: ConditionsDraft): PolicyGroupConditions {
  return {
    regions: draft.regions,
    protocols: draft.protocols,
    keywords: [...new Set(draft.keywords.split(/[,，、\n]+/).map(word => word.trim()).filter(Boolean))],
    maxMultiplier: draft.multiplier ? Number(draft.multiplier) : null,
    maxDelayMs: draft.delay ? Number(draft.delay) : null,
    checkIntervalMinutes: draft.checkIntervalMinutes,
  };
}

export function matchesConditions(entry: PolicyGroupEntry, conditions: PolicyGroupConditions): boolean {
  const node = entry.node;
  return Boolean(node && (
    (conditions.regions.length === 0 || conditions.regions.includes(node.region))
    && (conditions.protocols.length === 0 || conditions.protocols.includes(node.protocol))
    && (conditions.keywords.length === 0 || conditions.keywords.some(word => entry.label.toLowerCase().includes(word.toLowerCase())))
    && (conditions.maxMultiplier === null || node.multiplier <= conditions.maxMultiplier)
  ));
}

export function measuredDelay(probe: PolicyGroupProbe | undefined, now: number): number | null {
  return probe?.status === "passed" && probe.expiresAt > now ? probe.delayMs : null;
}

interface FilterChipsProps {
  label: string;
  options: Map<string, string>;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}

function FilterChips({ label, options, values, disabled, onChange }: FilterChipsProps) {
  const choices = new Map(options);
  for (const value of values) if (!choices.has(value)) choices.set(value, value);
  if (choices.size === 0) return null;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-semibold">{label}</legend>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto p-0.5" aria-label={label}>
        {[...choices].sort(([, a], [, b]) => a.localeCompare(b, "zh-CN")).map(([value, text]) => {
          const selected = values.includes(value);
          return (
            <button type="button" key={value} className={"workbench-tag min-h-7 px-2" + (selected ? " workbench-tag-accent" : "")}
              aria-pressed={selected} disabled={disabled}
              onClick={() => onChange(selected ? values.filter(item => item !== value) : [...values, value])}>
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface PolicyGroupConditionsPanelProps {
  entries: PolicyGroupEntry[];
  draft: ConditionsDraft;
  onChange: (next: ConditionsDraft) => void;
  matched: number;
  admitted: number;
  pending: number;
  disabled: boolean;
  canMeasure: boolean;
  onMeasure: () => void;
  measureLabel: string;
  checking: boolean;
  status?: PolicyCheckStatus | null;
  preview: boolean;
}

const checkTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

function CheckResult({ status }: { status: PolicyCheckStatus }) {
  const { last, nextAt, checking, error } = status;
  const added = last?.added.length ?? 0;
  const removed = last?.removed.length ?? 0;
  const counts = "加入 " + added + " · 移出 " + removed;
  return (
    <div className="grid gap-2 text-xs text-[var(--text-secondary)]">
      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 tabular-nums" aria-live="polite">
        <div className="flex gap-2">
          <dt className="text-[var(--text-muted)]">上次检测</dt>
          <dd>{last ? checkTime.format(last.checkedAt) : "尚未检测"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--text-muted)]">下次检测</dt>
          <dd>{checking ? "检测中" : nextAt ? checkTime.format(nextAt) : "核心未运行"}</dd>
        </div>
      </dl>
      {last && (added + removed > 0 ? (
        <details>
          <summary className="w-fit cursor-pointer rounded-sm text-[var(--workbench-accent)]">{counts}</summary>
          <ul className="mt-2 grid max-h-36 gap-1.5 overflow-auto pr-1">
            {last.added.map(item => (
              <li className="flex items-baseline gap-2" key={item.name}>
                <span className="shrink-0 text-[var(--workbench-positive)]">加入</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{item.name} · {item.reason}</span>
              </li>
            ))}
            {last.removed.map(item => (
              <li className="flex items-baseline gap-2" key={item.name}>
                <span className="shrink-0 text-[var(--workbench-warning)]">移出</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{item.name} · {item.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : <p>{counts}</p>)}
      {last && last.incomplete > 0 && <p>{last.incomplete} 个节点测速未完成</p>}
      {error && <p role="alert" className="text-[var(--workbench-warning)] [overflow-wrap:anywhere]">
        应用成员变更失败，等待重试。{error}
      </p>}
    </div>
  );
}

export function PolicyGroupConditionsPanel({ entries, draft, onChange, matched, admitted, pending,
  disabled, canMeasure, onMeasure, measureLabel, checking, status, preview }: PolicyGroupConditionsPanelProps) {
  const regionCodes = new Set(draft.regions);
  const protocols = new Map<string, string>();
  for (const { node } of entries) {
    if (!node) continue;
    if (node.region) regionCodes.add(node.region);
    protocols.set(node.protocol, node.protocol);
  }
  const regions = new Map([...regionCodes].map(code => [code, getRegionDisplayName(code)]));

  return (
    <section className="grid min-w-0 gap-3 px-3 pb-3" aria-label="自动入组条件">
      <div className="grid gap-3 sm:grid-cols-2">
        <FilterChips label="国家或地区" options={regions} values={draft.regions} disabled={disabled}
          onChange={regions => onChange({ ...draft, regions })} />
        <FilterChips label="协议" options={protocols} values={draft.protocols} disabled={disabled}
          onChange={protocols => onChange({ ...draft, protocols })} />
      </div>
      <div className="grid min-w-0 gap-2.5 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="grid gap-1 text-xs font-semibold">
          名称关键词
          <input className="min-h-8 min-w-0 px-2.5 font-normal" value={draft.keywords} maxLength={512}
            disabled={disabled} placeholder="用逗号分隔，匹配任一"
            onChange={event => onChange({ ...draft, keywords: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          最高倍率
          <input type="number" min="0" max="10000" step="any" className="min-h-8 min-w-0 px-2.5 font-normal"
            value={draft.multiplier} placeholder="不限" disabled={disabled}
            onChange={event => onChange({ ...draft, multiplier: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          延迟上限（ms）
          <input type="number" min="1" max="4000" step="1" className="min-h-8 min-w-0 px-2.5 font-normal"
            value={draft.delay} placeholder="不限" disabled={disabled}
            onChange={event => onChange({ ...draft, delay: event.target.value })} />
        </label>
      </div>
      <div className="grid gap-2.5 border-t border-[var(--workbench-row-hover)] pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="text-xs font-semibold">检测周期</span>
            <div className="workbench-segments min-h-8" role="group" aria-label="检测周期">
              {POLICY_CHECK_INTERVALS.map(minutes => (
                <button type="button" key={minutes} aria-pressed={draft.checkIntervalMinutes === minutes} disabled={disabled}
                  onClick={() => onChange({ ...draft, checkIntervalMinutes: minutes })}>{minutes} 分钟</button>
              ))}
            </div>
          </div>
          <Button type="button" size="sm" disabled={!canMeasure || disabled} loading={checking} onClick={onMeasure}>
            {measureLabel}
          </Button>
        </div>
        {status && <CheckResult status={status} />}
        <p aria-live="polite" className="text-xs text-[var(--text-secondary)]">
          符合条件 {matched}{preview && (" · 可自动加入 " + admitted + (pending > 0 ? " · 待测速 " + pending : ""))}
        </p>
      </div>
    </section>
  );
}
