import { Check, ChevronRight, Layers } from "lucide-react";
import { getDelayColorClass } from "../../utils/nodeParser";
import type { ProxyGroupItem, ProxyItem } from "../../types/proxy";

export const POLICY_ACTIONS = new Map([
  ["DIRECT", "直连"], ["REJECT", "拒绝"], ["REJECT-DROP", "静默拒绝"], ["PASS", "继续匹配"],
]);

const TYPES: Record<string, string> = {
  urltest: "自动优选", "url-test": "自动优选", fallback: "故障转移", loadbalance: "负载均衡", relay: "链式出口",
};

export function strategyLabel(type: string) {
  return TYPES[type.toLowerCase()] ?? "手动选择";
}

export function resolveGroupMember(name: string, proxies: Record<string, ProxyItem>): string {
  const visited = new Set<string>();
  let member = name;
  while (proxies[member]?.now && !visited.has(member)) {
    visited.add(member);
    member = proxies[member].now!;
  }
  return member;
}

interface PolicyMemberCardProps {
  name: string;
  group?: ProxyGroupItem;
  label: string;
  physical?: string;
  delay?: number;
  selected: boolean;
  onSelect?: () => void;
  onReveal?: () => void;
}

export function PolicyMemberCard({ name, group, label, physical, delay, selected, onSelect, onReveal }: PolicyMemberCardProps) {
  const details = group
    ? strategyLabel(group.type) + (physical ? " · " + physical : "")
    : name === "DIRECT" ? "直接连接" : "内置动作";
  const latency = group && delay !== undefined ? getDelayColorClass(delay) : null;
  const contentClass = "workbench-policy-member-content flex min-h-12 min-w-0 flex-1 items-center gap-2 px-2.5";
  const content = (
    <>
      <span className="workbench-policy-member-icon grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--workbench-surface)] text-[var(--workbench-accent)]">
        <Layers size={15} aria-hidden="true" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 text-left">
        <span className="flex min-w-0 items-center justify-between gap-1">
          <span className="truncate text-[13px] font-semibold leading-tight" title={label}>{label}</span>
          {selected && <Check size={14} aria-label="已选中" className="shrink-0 text-[var(--workbench-accent)]" />}
        </span>
        <span className="flex min-w-0 items-center justify-between gap-1">
          <span className="truncate text-[11px] leading-tight text-[var(--text-muted)]" title={details}>{details}</span>
          {latency && <span className={"shrink-0 whitespace-nowrap text-[11px] leading-tight tabular-nums " + latency.textColor}>{latency.label}</span>}
        </span>
      </span>
    </>
  );
  return (
    <article data-selected={selected || undefined}
      className="workbench-policy-member flex min-w-0 items-center rounded-[10px] bg-[var(--workbench-control)] data-[selected=true]:bg-[var(--workbench-selected)]">
      {onSelect ? (
        <button type="button" aria-label={"选择 " + label} aria-pressed={selected}
          className={contentClass} onClick={onSelect}>
          {content}
        </button>
      ) : <div className={contentClass}>{content}</div>}
      {onReveal && <button type="button" aria-label={"查看 " + label} title={"查看 " + label}
        className="workbench-title-button mr-1 shrink-0" onClick={onReveal}><ChevronRight size={16} aria-hidden="true" /></button>}
    </article>
  );
}
