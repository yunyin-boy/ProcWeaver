import React from "react";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { LoaderCircle } from "lucide-react";
import { CaptureConnectionEvidence, ProcessRuleItem } from "../../types/processRouting";
import { EntryStatusItem } from "../../services/processRoutingService";
import { RoutingEvidenceBadge } from "./RoutingEvidenceBadge";

interface ProcessRuleRowProps {
  rule: ProcessRuleItem;
  entryStatus?: EntryStatusItem;
  captureEvidence?: CaptureConnectionEvidence;
  isGlobalActive: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  onLaunch?: (rule: ProcessRuleItem) => Promise<void> | void;
}

export const ProcessRuleRow: React.FC<ProcessRuleRowProps> = ({
  rule,
  entryStatus,
  captureEvidence,
  isGlobalActive,
  onToggleEnabled,
  onDelete,
  onLaunch,
}) => {
  const [isLaunching, setIsLaunching] = React.useState(false);

  const handleLaunchClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onLaunch || isLaunching) return;
    setIsLaunching(true);
    try {
      await onLaunch(rule);
    } finally {
      setIsLaunching(false);
    }
  };
  const actions = {
    proxy: { label: "代理分流", tone: "workbench-tag-accent" },
    direct: { label: "国内直连", tone: "workbench-tag-positive" },
    reject: { label: "网络阻断", tone: "workbench-tag-warning" },
  };
  const action = actions[rule.action] ?? { label: "规则分流", tone: "" };

  return (
    <div className="workbench-process-row">
      <div className="grid min-w-0 gap-0.5">
        <strong className="break-words text-[13px]">{rule.label}</strong>
        <span className="break-all font-mono text-[11px] text-[var(--text-muted)]">{rule.matchValue}</span>
        {rule.includeDescendants && <span className="text-[11px] text-[var(--text-muted)]">含子进程</span>}
      </div>
      <div className="grid min-w-0 justify-items-start gap-1 text-xs">
        <span className={"workbench-tag " + action.tone}>{action.label}</span>
        {rule.action === "proxy" && rule.targetProxy && <span className="break-all">{rule.targetProxy}</span>}
      </div>
      <div className="grid justify-items-start gap-1">
        {rule.enabled
          ? <RoutingEvidenceBadge ready={isGlobalActive} entry={entryStatus} capture={captureEvidence} />
          : <span className="workbench-tag">已停用</span>}
        {rule.createdAt && <span className="break-words text-[11px] text-[var(--text-muted)]">{rule.createdAt}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <CapsuleToggle checked={rule.enabled} onChange={onToggleEnabled} title={"启用规则 " + rule.label} />
        {onLaunch && (
          <button
            type="button"
            className="workbench-action workbench-action-primary"
            onClick={handleLaunchClick}
            disabled={isLaunching || !rule.enabled}
            title={rule.enabled ? "受控启动程序" : "启用规则后可受控启动"}
          >
            {isLaunching && <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />}
            {isLaunching ? "启动中…" : "启动"}
          </button>
        )}
        <button type="button" onClick={onDelete} className="workbench-action workbench-action-ghost" title="删除进程规则">删除</button>
      </div>
    </div>
  );
};
