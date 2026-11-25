import React from "react";
import { BandwidthSnapshot } from "../types/telemetry";
import { formatBitrate } from "../services/telemetryService";
import { formatMemoryBytes } from "../services/coreService";
import { KbdBadge } from "../primitives/Badge";
import { ROUTING_MODES } from "../primitives/RoutingModeControl";

interface StatusBarProps {
  bandwidth: BandwidthSnapshot;
  mixedPort: number;
  mode: string;
  processCount: number;
  memoryUsageBytes?: number;
  onOpenCommandPalette?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  bandwidth,
  mixedPort,
  mode,
  processCount,
  memoryUsageBytes,
  onOpenCommandPalette,
}) => {
  const down = formatBitrate(bandwidth.downloadRateBytes);
  const up = formatBitrate(bandwidth.uploadRateBytes);
  const modeLabel = ROUTING_MODES.find((option) => option.id === mode.toLowerCase())?.label ?? mode;
  const items = [
    { label: "分流模式", value: modeLabel },
    { label: "混合端口", value: mixedPort },
    { label: "匹配进程", value: processCount },
    { label: "核心内存", value: formatMemoryBytes(memoryUsageBytes) },
  ];

  return (
    <footer className="workbench-statusbar" aria-label="核心状态">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {items.map(({ label, value }) => (
          <span key={label} className="whitespace-nowrap">
            {label} <strong className="tabular-nums font-medium text-[var(--text-primary)]">{value}</strong>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="whitespace-nowrap tabular-nums" title="下行速率">↓ {down.value} {down.unit}</span>
        <span className="whitespace-nowrap tabular-nums" title="上行速率">↑ {up.value} {up.unit}</span>
        {onOpenCommandPalette && (
          <button type="button" className="workbench-title-button !min-h-6" onClick={onOpenCommandPalette} title="打开命令中心">
            命令中心 <KbdBadge keys={["Ctrl", "K"]} />
          </button>
        )}
      </div>
    </footer>
  );
};
