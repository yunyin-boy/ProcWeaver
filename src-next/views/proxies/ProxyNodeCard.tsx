import React from "react";
import { ParsedNodeMeta, NodeHealthResult } from "../../types/proxy";
import { getDelayColorClass, getFraudScoreBadge } from "../../utils/nodeParser";

interface ProxyNodeCardProps {
  meta: ParsedNodeMeta;
  health?: NodeHealthResult;
  isSelected: boolean;
  isTesting?: boolean;
  onSelect: () => void;
  onTest: (e: React.MouseEvent) => void;
  onToggleIgnore?: (e: React.MouseEvent) => void;
}

export const ProxyNodeCard: React.FC<ProxyNodeCardProps> = React.memo(({
  meta,
  health,
  isSelected,
  isTesting = false,
  onSelect,
  onTest,
  onToggleIgnore,
}) => {
  const delay = getDelayColorClass(meta.latestDelay);
  const risk = getFraudScoreBadge(health?.fraudScore);

  return (
    <article className="workbench-node cursor-pointer" data-selected={isSelected || undefined} onClick={onSelect}>
      <div className="workbench-node-tags">
        <span className="workbench-node-region-code workbench-tag">{meta.regionCode}</span>
        <span className={"workbench-node-chip " + meta.protocolColor}>{meta.protocolBadge}</span>
        {meta.multiplier !== 1 && <span className="workbench-tag tabular-nums">{meta.multiplier}×</span>}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        className="workbench-node-name"
        title={meta.rawName}
        aria-pressed={isSelected}
      >
        {meta.cleanName}
      </button>
      <span className="workbench-node-region text-xs text-[var(--text-muted)]">{meta.regionName}</span>
      <div className="workbench-node-health">
        <span
          className={health?.isResidential ? "text-[var(--workbench-positive)]" : ""}
          title={health?.ip ? "落地 IP " + health.ip : undefined}
        >
          {health?.ipType || "待体检"}
        </span>
        <span className={"workbench-node-chip " + risk.bgColor + " " + risk.textColor}>{risk.label}</span>
      </div>
      <button
        type="button"
        onClick={onTest}
        disabled={isTesting}
        className={"workbench-node-delay workbench-node-action tabular-nums " + (isTesting ? "text-[var(--workbench-accent)]" : delay.textColor)}
        title="单节点测速"
        aria-label={meta.cleanName + "，单节点测速，" + (isTesting ? "测速中" : delay.label)}
      >
        {isTesting ? "测速中…" : delay.label}
      </button>
      {isSelected && <span className="workbench-node-active">当前出口</span>}
      {onToggleIgnore && (
        <button
          type="button"
          className="workbench-node-hide workbench-node-action text-[var(--text-muted)]"
          onClick={onToggleIgnore}
          title="隐藏该节点"
          aria-label={"隐藏 " + meta.cleanName}
        >
          隐藏
        </button>
      )}
    </article>
  );
});

ProxyNodeCard.displayName = "ProxyNodeCard";
