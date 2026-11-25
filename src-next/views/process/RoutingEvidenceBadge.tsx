import type { EntryStatusItem } from "../../services/processRoutingService";
import type { CaptureConnectionEvidence } from "../../types/processRouting";

const tones = {
  verified: "workbench-tag-positive",
  observed: "workbench-tag-accent",
  warning: "workbench-tag-warning",
  error: "!bg-[var(--workbench-danger-bg)] !text-[var(--workbench-danger)]",
  idle: "",
};

export function RoutingEvidenceBadge({
  ready,
  unavailableHint,
  entry,
  capture,
}: {
  ready: boolean;
  unavailableHint?: string;
  entry?: EntryStatusItem;
  capture?: CaptureConnectionEvidence;
}) {
  let label = "待观测";
  let detail = entry?.identityMessage || entry?.message || "等待目标进程活动";
  let tone: keyof typeof tones = "idle";
  if (!ready) {
    label = "待就绪";
    detail = unavailableHint || "全局分流或驱动尚未就绪";
  } else if (entry?.hookTier === "Failed") {
    label = "注入异常";
    detail = entry.hookTierReason || entry.message;
    tone = "error";
  } else if (entry?.state === "restart_required" || entry?.state === "partial") {
    label = "待受控重启";
    detail = entry.message;
    tone = "warning";
  } else if (entry?.verifiedOutlet) {
    label = "已观测到指定出口";
    detail = "核心观测到使用 " + entry.verifiedOutlet + " 的双向连接。";
    tone = "verified";
  } else if (capture?.stage === "ipv6_policy" && capture.errorKind === "Ipv6Blocked") {
    label = "已阻断 IPv6";
    detail = "业务包的 IPv6 策略已阻断近期连接";
    tone = "observed";
  } else if (capture?.outcome === "failed") {
    label = "近期转发异常";
    detail = capture.errorKind || capture.stage;
    tone = "error";
  } else if (capture?.outcome === "relayed") {
    if (capture.stage === "dns_sandbox") {
      label = "沙盒 DNS 已应答";
      detail = "应用已收到套件的 DNS 应答，实际连接按套件规则选择解析路径";
    } else if (capture.stage === "dns_doh") {
      label = "DNS 已应答";
      detail = "业务包解析器已向应用返回 DNS 响应";
    } else if (capture.stage === "dns_ipv6_policy") {
      label = "已过滤 AAAA";
      detail = "业务包的 IPv6 策略已向应用返回空应答";
    } else {
      label = "已转发至入口";
      detail = "近期连接已与受管入口交换流量，等待所绑定出口的连接证据";
    }
    tone = "observed";
  } else if (entry?.connectionState === "observed") {
    label = "连接已观测";
    detail = entry.connectionMessage || "核心已看到相关连接";
    tone = "observed";
  } else if (capture?.outcome === "attributed" || entry?.identityState === "path_verified") {
    label = "进程已匹配";
    detail = entry?.identityMessage || "WinDivert 已识别连接所属进程";
    tone = "observed";
  }
  return (
    <span className={"workbench-tag " + tones[tone]} title={detail}>
      {label}
    </span>
  );
}
