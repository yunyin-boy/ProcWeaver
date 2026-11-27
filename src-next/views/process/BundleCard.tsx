import React from "react";
import { ChevronRight, Package, Play, LoaderCircle } from "lucide-react";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import { CaptureConnectionEvidence, ProcessBundleItem, usesExistingBundleRules } from "../../types/processRouting";
import type { EntryStatusItem } from "../../services/processRoutingService";
import { RoutingEvidenceBadge } from "./RoutingEvidenceBadge";

interface BundleCardProps {
  bundle: Pick<ProcessBundleItem, "name" | "description" | "mainExe" | "exes" | "enabled" | "targetProxy" | "mode"> & {
    policy: Pick<ProcessBundleItem["policy"], "dnsMode" | "proxySubprocesses" | "useExistingRules">;
  };
  isGlobalActive?: boolean;
  busy?: boolean;
  globalStatusHint?: string;
  entryStatus?: EntryStatusItem;
  outletUnavailable?: boolean;
  captureEvidence?: CaptureConnectionEvidence;
  notice?: string;
  onOpenDetail?: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onOpenOutletPicker: () => void;
  onToggleSubprocesses: (enabled: boolean) => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete?: () => void;
  onLaunch?: () => Promise<void> | void;
}

export const BundleCard: React.FC<BundleCardProps> = ({
  bundle,
  isGlobalActive = true,
  busy = false,
  globalStatusHint,
  entryStatus,
  outletUnavailable = false,
  captureEvidence,
  notice,
  onOpenDetail,
  onToggleEnabled,
  onOpenOutletPicker,
  onToggleSubprocesses,
  onEdit,
  onExport,
  onDelete,
  onLaunch,
}) => {
  const [isLaunching, setIsLaunching] = React.useState(false);

  const handleLaunchClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onLaunch || isLaunching) return;
    setIsLaunching(true);
    try {
      await onLaunch();
    } finally {
      setIsLaunching(false);
    }
  };

  const displayedExes = bundle.exes.slice(0, 3);
  const hiddenCount = bundle.exes.length - displayedExes.length;
  const useExistingRules = usesExistingBundleRules(bundle);
  const needsOutlet = outletUnavailable || !bundle.targetProxy;
  const outletLabel = bundle.targetProxy || (outletUnavailable ? "出口失效" : "待绑定出口");
  const outletTitle = outletUnavailable ? outletLabel + " · 待重绑" : outletLabel;
  const dnsLabel = { fake_ip: "Fake-IP", system_native: "系统 DNS", safe_pure: "纯净 DNS" }[bundle.policy.dnsMode] || "纯净 DNS";
  const bundleStatus = needsOutlet ? (outletUnavailable ? "待重绑" : "待绑定") : bundle.enabled ? "已启用" : "已暂停";
  const bundleStatusTone = needsOutlet
    ? "workbench-tag-warning"
    : bundle.enabled ? "workbench-tag-positive" : "";

  return (
    <article className="workbench-panel workbench-bundle-item">
      <div className="grid min-w-0 gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--workbench-selected)] text-[var(--workbench-accent)]">
            <Package size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="workbench-panel-title [overflow-wrap:anywhere]">
              {onOpenDetail ? (
                <button type="button" className="text-left hover:text-[var(--workbench-accent)]" onClick={onOpenDetail} title="查看运行详情">
                  {bundle.name}
                </button>
              ) : bundle.name}
            </h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="workbench-tag">{bundle.mode === "sandbox" ? "沙盒" : "严格"}</span>
              <span className={"workbench-tag " + bundleStatusTone}>{bundleStatus}</span>
            </div>
          </div>
        </div>
        {bundle.description && <p className="break-words text-[13px] leading-relaxed text-[var(--text-muted)]">{bundle.description}</p>}
        {notice && <p className="text-xs leading-relaxed text-[var(--workbench-warning)]">{notice}</p>}
        <div className="grid gap-1 text-xs text-[var(--text-muted)]">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span>进程名单 <strong className="tabular-nums text-[var(--text-primary)]">{bundle.exes.length}</strong></span>
            <span className="break-all">主进程 <strong className="font-mono font-medium text-[var(--text-primary)]">{bundle.mainExe}</strong></span>
          </div>
          <div className="flex flex-wrap gap-1">
            {displayedExes.map((exe) => (
              <span key={exe} className="workbench-tag min-w-0 break-all font-mono" title={exe}>{exe}</span>
            ))}
            {hiddenCount > 0 && (
              <span className="workbench-tag tabular-nums" title={bundle.exes.slice(3).join("、")}>+{hiddenCount}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-[13px] font-semibold">专用出口</span>
          {useExistingRules && <span className="text-xs text-[var(--text-muted)]">按现有规则</span>}
        </div>
        <button
          type="button"
          onClick={onOpenOutletPicker}
          className={"workbench-action w-full justify-between " + (needsOutlet ? "!text-[var(--workbench-warning)]" : "")}
          title={outletTitle}
          aria-label={bundle.name + "，专用出口 " + outletTitle}
        >
          <span className="min-w-0 truncate">{outletLabel}</span>
          <ChevronRight size={13} className="shrink-0" aria-hidden="true" />
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="workbench-tag workbench-tag-accent">{dnsLabel}</span>
          <label className="workbench-tag cursor-pointer">
            <input
              type="checkbox"
              checked={bundle.policy.proxySubprocesses}
              disabled={busy}
              onChange={(event) => onToggleSubprocesses(event.target.checked)}
              className="size-3 accent-[var(--workbench-accent-solid)]"
            />
            包含子进程
          </label>
          {bundle.enabled && (
            <RoutingEvidenceBadge
              ready={isGlobalActive}
              unavailableHint={globalStatusHint}
              entry={entryStatus}
              capture={captureEvidence}
            />
          )}
        </div>
      </div>

      <div className="workbench-bundle-actions">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-secondary)]">
          启用套件
          <CapsuleToggle checked={bundle.enabled} disabled={busy} onChange={onToggleEnabled} title={"启用套件 " + bundle.name} />
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {onLaunch && (
            <button
              type="button"
              onClick={handleLaunchClick}
              disabled={busy || isLaunching || !bundle.enabled || outletUnavailable}
              className="workbench-action workbench-action-primary"
              title={bundle.enabled ? "受控启动应用" : "启用套件后可受控启动"}
            >
              {isLaunching ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
              {isLaunching ? "启动中…" : "启动"}
            </button>
          )}
          <button type="button" className="workbench-action workbench-action-ghost" onClick={onEdit}>编辑</button>
          <button type="button" className="workbench-action workbench-action-ghost" onClick={onExport} title="导出脱敏规则包">导出</button>
          {onDelete && <button type="button" disabled={busy} className="workbench-action workbench-action-ghost" onClick={onDelete}>删除</button>}
        </div>
      </div>
    </article>
  );
};
