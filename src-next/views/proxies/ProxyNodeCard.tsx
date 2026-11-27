import React from "react";
import { EyeOff } from "lucide-react";
import type { ParsedNodeMeta, NodeHealthResult, ProxyViewMode } from "../../types/proxy";
import { getDelayColorClass, getFraudScoreBadge } from "../../utils/nodeParser";

interface ProxyNodeCardProps {
  meta: ParsedNodeMeta;
  layout: ProxyViewMode;
  health?: NodeHealthResult;
  isSelected: boolean;
  isTesting?: boolean;
  onSelect?: () => void;
  onTest: (e: React.MouseEvent) => void;
  onToggleIgnore?: (e: React.MouseEvent) => void;
}

function splitGridNodeName(name: string) {
  const characters = Array.from(name);
  if (characters.length <= 24) return null;

  // Preserve the final identifiers even when the beginning needs an ellipsis.
  const suffix = name.match(/[\s·|_–—-]+([^\s·|_–—-]+(?:[\s·|_–—-]+[^\s·|_–—-]+){0,2})$/u);
  if (suffix?.index && Array.from(suffix[1]).length <= 16) {
    return [name.slice(0, suffix.index), suffix[1]];
  }
  return [characters.slice(0, -12).join("").trimEnd(), characters.slice(-12).join("").trimStart()];
}

export const ProxyNodeCard: React.FC<ProxyNodeCardProps> = React.memo(({
  meta,
  layout,
  health,
  isSelected,
  isTesting = false,
  onSelect,
  onTest,
  onToggleIgnore,
}) => {
  const delay = getDelayColorClass(meta.latestDelay);
  const risk = getFraudScoreBadge(health?.fraudScore);
  const isList = layout === "list";
  const splitName = isList ? null : splitGridNodeName(meta.cleanName);
  const displayName = splitName ? (
    <span className="workbench-node-name-parts">
      <span>{splitName[0]}</span>
      <span>{splitName[1]}</span>
    </span>
  ) : <span className="workbench-node-name-text">{meta.cleanName}</span>;
  const name = onSelect ? (
    <button type="button" className="workbench-node-name" title={meta.rawName} aria-label={meta.cleanName}
      aria-pressed={isSelected} onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}>
      {displayName}
    </button>
  ) : <span className="workbench-node-name" title={meta.rawName}>{displayName}</span>;
  const protocol = (
    <span className="workbench-node-tags" title={meta.protocolBadge}>
      <span className={"workbench-node-chip " + meta.protocolColor}>{meta.protocolBadge}</span>
      {meta.multiplier !== 1 && <span className="workbench-node-chip workbench-tag tabular-nums">{meta.multiplier}×</span>}
    </span>
  );
  const region = <span className="workbench-node-region" title={meta.regionName}>{meta.regionName}</span>;
  const healthInfo = (
    <span className="workbench-node-health">
      <span className={health?.isResidential ? "text-[var(--workbench-positive)]" : undefined}
        title={health?.ip ? "落地 IP " + health.ip : undefined}>
        {health?.ipType || "待体检"}
      </span>
      <span className={"workbench-node-chip " + risk.bgColor + " " + risk.textColor}>{risk.label}</span>
    </span>
  );
  const speed = (
    <button type="button" onClick={onTest} disabled={isTesting}
      className={"workbench-node-delay workbench-node-action tabular-nums " + (isTesting ? "text-[var(--workbench-accent)]" : delay.textColor)}
      title="单节点测速" aria-label={meta.cleanName + "，单节点测速，" + (isTesting ? "测速中" : delay.label)}>
      {isTesting ? "测速中…" : delay.label}
    </button>
  );
  const active = isSelected && <span className="workbench-node-active">当前出口</span>;
  const hide = onToggleIgnore && (
    <button type="button" className="workbench-node-hide workbench-node-action text-[var(--text-muted)]"
      onClick={onToggleIgnore} title="隐藏该节点" aria-label={"隐藏 " + meta.cleanName}>
      <EyeOff size={13} aria-hidden="true" />
    </button>
  );

  if (isList) {
    return (
      <tr className={onSelect ? "cursor-pointer" : undefined} data-selected={isSelected || undefined} onClick={onSelect}>
        <td>
          <div className="workbench-node-table-title">{name}{active}</div>
          <div className="workbench-node-table-details">{protocol}{region}{healthInfo}</div>
        </td>
        <td className="workbench-node-table-protocol">{protocol}</td>
        <td className="workbench-node-table-region">{region}</td>
        <td className="workbench-node-table-health">{healthInfo}</td>
        <td className="workbench-node-table-latency">{speed}</td>
        <td className="workbench-node-table-actions">{hide}</td>
      </tr>
    );
  }

  return (
    <article className={"workbench-node" + (onSelect ? " cursor-pointer" : "")}
      data-selected={isSelected || undefined} onClick={onSelect}>
      {name}
      <div className="workbench-node-identifiers">{protocol}{region}{active}</div>
      <div className="workbench-node-footer">
        {healthInfo}
        <div className="workbench-node-controls">{speed}{hide}</div>
      </div>
    </article>
  );
});

ProxyNodeCard.displayName = "ProxyNodeCard";
