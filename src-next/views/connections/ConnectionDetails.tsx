import React from "react";
import { ChevronRight, Unplug } from "lucide-react";
import { Button } from "../../primitives/Button";
import { Modal } from "../../primitives/Modal";
import {
  formatAddress,
  formatBytes,
  formatConnectionRule,
  formatConnectionTarget,
  formatDuration,
  formatDurationMs,
  formatSpeed,
  getConnectionProcess,
} from "../../services/connectionsService";
import type { ConnectionItem } from "../../types/connections";

interface ConnectionDetailsProps {
  connection: ConnectionItem;
  chainLabels: string[];
  onClose: () => void;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  canDisconnect: boolean;
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—";
}

export const ConnectionDetails: React.FC<ConnectionDetailsProps> = ({
  connection,
  chainLabels,
  onClose,
  onDisconnect,
  isDisconnecting,
  canDisconnect,
}) => {
  const { metadata, start, closedAt } = connection;
  const rule = formatConnectionRule(connection);
  const addresses = [
    { label: "本地源地址", value: formatAddress(metadata.sourceIP, metadata.sourcePort) },
    { label: "目标 IP", value: metadata.destinationIP || "—" },
    { label: "入站通道", value: [metadata.inboundName, metadata.type].filter(Boolean).join(" · ") || "—" },
    { label: "DNS 策略", value: metadata.dnsMode || "—" },
  ];
  const traffic = [
    { label: "下载", bytes: connection.download, speed: connection.downloadSpeed },
    { label: "上传", bytes: connection.upload, speed: connection.uploadSpeed },
  ];

  return (
    <Modal isOpen onClose={onClose} title="连接详情">
      <div className="grid min-w-0 gap-4">
        <section className="grid min-w-0 gap-2 rounded-xl bg-[var(--workbench-row-hover)] p-3" aria-label="目标和进程">
          <div className="flex flex-wrap items-center gap-2">
            {metadata.network && <span className="workbench-tag font-mono uppercase">{metadata.network}</span>}
            <span className="workbench-tag">{closedAt ? "已断开" : "活跃"}</span>
            {metadata.hookTier && metadata.hookTier !== "Direct" && (
              <span className="workbench-tag">Hook {metadata.hookTier === "Failed" ? "失败" : metadata.hookTier}</span>
            )}
          </div>
          <p className="min-w-0 font-mono text-sm font-semibold [overflow-wrap:anywhere]">{formatConnectionTarget(connection)}</p>
          <div className="grid min-w-0 gap-0.5">
            <span className="text-[13px] font-medium [overflow-wrap:anywhere]">{getConnectionProcess(connection)}</span>
            {metadata.processPath && <span className="text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">{metadata.processPath}</span>}
          </div>
        </section>

        <dl className="workbench-connection-detail-grid" aria-label="连接属性">
          {addresses.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <section className="grid min-w-0 gap-2 rounded-xl bg-[var(--workbench-row-hover)] p-3" aria-label="路由链路">
          <h4 className="text-[13px] font-semibold">路由链路</h4>
          {chainLabels.length ? (
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
              {chainLabels.map((label, index) => (
                <li key={index} className="flex min-w-0 max-w-full items-center gap-1.5">
                  {index > 0 && <ChevronRight size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />}
                  <span className={"workbench-tag min-w-0 [overflow-wrap:anywhere] " + (index === chainLabels.length - 1 ? "workbench-tag-accent" : "")}>
                    {label}
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="text-xs text-[var(--text-muted)]">暂无路由链路</p>}
          {rule && <p className="text-xs leading-relaxed text-[var(--text-muted)] [overflow-wrap:anywhere]">命中 {rule}</p>}
        </section>

        <dl className="workbench-connection-detail-grid tabular-nums" aria-label="连接流量和时间">
          {traffic.map(({ label, bytes, speed }) => (
            <div key={label} className="min-w-0">
              <dt>{label}</dt>
              <dd>{formatBytes(bytes)}</dd>
              {!closedAt && speed !== undefined && <dd className="!text-xs !text-[var(--text-muted)]">{formatSpeed(speed)}</dd>}
            </div>
          ))}
          <div className="min-w-0">
            <dt>建立时间</dt>
            <dd>{formatDate(start)}</dd>
          </div>
          <div className="min-w-0">
            <dt>持续时长</dt>
            <dd>{closedAt ? formatDurationMs(connection.durationMs) : formatDuration(start)}</dd>
          </div>
          {closedAt && (
            <div className="min-w-0">
              <dt>断开时间（采样）</dt>
              <dd>{formatDate(closedAt)}</dd>
            </div>
          )}
          <div className="min-w-0">
            <dt>连接 ID</dt>
            <dd className="font-mono !text-xs">{connection.id}</dd>
          </div>
        </dl>

        {!closedAt && (
          <div className="flex justify-end">
            <Button type="button" variant="danger" loading={isDisconnecting} disabled={!canDisconnect} onClick={onDisconnect}>
              {!isDisconnecting && <Unplug size={14} aria-hidden="true" />}断开此连接
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
