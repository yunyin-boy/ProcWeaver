import type { ProcessCaptureEvidence } from "../../types/processRouting";

const stages: Record<string, string> = {
  ownership: "确认进程归属",
  rule_entry: "选择规则入口",
  routing: "应用分流策略",
  ipv6_policy: "IPv6 策略",
  managed_redirect: "重定向至本机",
  packet_redirect: "重定向数据包",
  dns_doh: "业务包 DoH 解析",
  dns_sandbox: "沙盒 DNS 接管",
  dns_fake_ip: "套件 Fake-IP",
  dns_native: "系统原生 DNS",
  dns_policy: "DNS 模式切换",
  dns_ipv6_policy: "AAAA 过滤",
  socks_ingress: "连接 SOCKS 入口",
  socks_handshake: "SOCKS 协商",
  socks_reply: "SOCKS 请求响应",
  tcp_relay: "转发 TCP",
  socks_udp_reply: "收到 SOCKS UDP 回包",
  udp_relay: "转发 UDP",
};

const outcomes = {
  attributed: "已归属",
  relayed: "已转发至入口",
  failed: "失败",
};

const relayOutcomes: Record<string, string> = {
  dns_doh: "已返回 DNS 应答",
  dns_sandbox: "已返回套件 DNS 应答",
  dns_fake_ip: "已返回映射地址",
  dns_native: "已直放至系统 DNS",
  dns_ipv6_policy: "已返回空应答",
};

const clock = new Intl.DateTimeFormat("zh-CN", { timeStyle: "medium" });

export function CaptureDiagnostics({
  capture,
  ownerLabels,
}: {
  capture?: ProcessCaptureEvidence;
  ownerLabels: ReadonlyMap<string, string>;
}) {
  const events = capture?.recentConnections ?? [];
  return (
    <details className="workbench-panel text-xs">
      <summary className="cursor-pointer rounded-xl px-3 py-2.5 font-semibold text-[var(--text-primary)] hover:bg-[var(--workbench-row-hover)]">
        WinDivert 连接诊断
        {capture && (
          <span className="ml-3 font-normal text-[var(--text-muted)]">
            近期阶段记录 {events.length} · 未确认归属 {capture.unclassified} · 失败 {capture.failures}
          </span>
        )}
      </summary>
      <div className="px-3 pb-3 pt-1">
        <p className="mb-2 text-[var(--text-muted)]">
          记录按连接阶段计数，同一连接可能出现多次。未确认归属计数包含数据包事件。
        </p>
        {!events.length ? (
          <p className="text-[var(--text-muted)]">
            {capture ? "暂无连接诊断记录" : "暂未取得 WinDivert 诊断数据"}
          </p>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead className="text-[var(--text-muted)]">
                <tr>
                  {["时间", "进程 / PID", "规则", "原始目标", "入口", "阶段", "结果"].map((column) => (
                    <th key={column} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[var(--text-primary)]">
                {events.map((event, index) => {
                  const ipv6Blocked = event.stage === "ipv6_policy" && event.errorKind === "Ipv6Blocked";
                  const failed = event.outcome === "failed" && !ipv6Blocked;
                  const result = ipv6Blocked ? "已阻断 IPv6" : outcomes[event.outcome];
                  return (
                    <tr key={[event.connectionId, event.timeMs, event.stage, index].join(":")}>
                      <td className="whitespace-nowrap px-2 py-1 font-mono">
                        {clock.format(event.timeMs)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1">
                        {event.processName || "未知"}{event.pid > 0 && " · " + event.pid}
                      </td>
                      <td className="px-2 py-1">
                        {event.ruleOwner ? ownerLabels.get(event.ruleOwner) ?? event.ruleOwner : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 font-mono">
                        {event.protocol.toUpperCase()} {event.destination}
                        {event.dnsName && (
                          <span className="block max-w-60 truncate text-[var(--text-muted)]" title={event.dnsName}>
                            查询 {event.dnsName}
                          </span>
                        )}
                        {event.dnsUpstream && (
                          <span className="block max-w-60 truncate text-[var(--text-muted)]" title={event.dnsUpstream}>
                            配置上游 {event.dnsUpstream}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 font-mono">{event.entryPort ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1">{stages[event.stage] ?? event.stage}</td>
                      <td className={"px-2 py-1 " + (failed ? "text-rose-500" : "")}>
                        {event.outcome === "relayed" ? relayOutcomes[event.stage] ?? result : result}
                        {!ipv6Blocked && event.errorKind && " · " + event.errorKind}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
