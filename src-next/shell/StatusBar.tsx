// ==========================================================================
// ProcWeaver src-next 高密度底部状态栏 (毛玻璃透光)
// 规范溯源: typography-dark-mono-optics / tauri-desktop-layout-typography
// ==========================================================================

import React from "react";
import { BandwidthSnapshot } from "../types/telemetry";
import { formatBitrate } from "../services/telemetryService";
import { formatMemoryBytes } from "../services/coreService";
import { KbdBadge } from "../primitives/Badge";

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
  const memText = formatMemoryBytes(memoryUsageBytes);

  return (
    <footer className="h-7 w-full flex items-center justify-between px-3 text-[11px] border-t border-[var(--glass-border-subtle)] glass-bar text-[var(--text-muted)] select-none z-[var(--z-sticky)]">
      {/* 左侧：分流模式与端口 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span>分流模式:</span>
          <span className="font-medium text-[var(--text-secondary)] uppercase">
            {mode}
          </span>
        </div>
        <span className="text-[var(--glass-border-subtle)]">|</span>
        <div className="flex items-center gap-1">
          <span>混合端口:</span>
          <span className="font-mono tabular-numeric text-[var(--text-secondary)]">
            {mixedPort}
          </span>
        </div>
        <span className="text-[var(--glass-border-subtle)]">|</span>
        <div className="flex items-center gap-1">
          <span>接管进程:</span>
          <span className="font-mono tabular-numeric text-[var(--text-secondary)]">
            {processCount}
          </span>
        </div>
        <span className="text-[var(--glass-border-subtle)]">|</span>
        <div className="flex items-center gap-1">
          <span>核心内存:</span>
          <span className="font-mono tabular-numeric text-[var(--text-secondary)]">
            {memText}
          </span>
        </div>
      </div>

      {/* 右侧：实时吞吐量 (等宽防抖自适应 bps/Kbps/Mbps/Gbps) 与快捷键提示 */}
      <div className="flex items-center gap-4">
        {/* 速率遥测 */}
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <div className="flex items-center gap-1" title={`下行速率: ${down.value} ${down.unit}`}>
            <span className="text-zinc-500">↓</span>
            <span className="tabular-numeric font-medium text-[var(--text-primary)] min-w-[4.5ch] text-right inline-block">
              {down.value}
            </span>
            <span className="text-[10px] text-zinc-500 uppercase font-semibold">{down.unit}</span>
          </div>

          <div className="flex items-center gap-1" title={`上行速率: ${up.value} ${up.unit}`}>
            <span className="text-zinc-500">↑</span>
            <span className="tabular-numeric font-medium text-[var(--text-primary)] min-w-[4.5ch] text-right inline-block">
              {up.value}
            </span>
            <span className="text-[10px] text-zinc-500 uppercase font-semibold">{up.unit}</span>
          </div>
        </div>

        <span className="text-[var(--glass-border-subtle)]">|</span>

        {/* 快捷键提示 (点击唤起命令浮层) */}
        <div
          onClick={onOpenCommandPalette}
          className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors active:scale-95"
          title="点击或按 Ctrl+K 唤起命令中心"
        >
          <span>命令中心</span>
          <KbdBadge keys={["Ctrl", "K"]} />
        </div>
      </div>
    </footer>
  );
};
