import React, { useState } from "react";
import type { BundlePolicy } from "../../types/businessBundle";
import { Shield, Globe, Cpu, Info } from "lucide-react";

interface Props {
  policy: BundlePolicy;
  onChange: (next: BundlePolicy) => void;
  isHttpUpstream?: boolean;
}

export const BundlePolicyForm: React.FC<Props> = ({
  policy,
  onChange,
  isHttpUpstream,
}) => {
  const [activeTab, setActiveTab] = useState<"protocol" | "network" | "filter">("protocol");

  return (
    <div className="space-y-4">
      {/* 选项卡导航 */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 rounded-xl p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("protocol")}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "protocol"
              ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>协议与安全</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("network")}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "network"
              ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>DNS 与局域网</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("filter")}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "filter"
              ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>目标与端口</span>
        </button>
      </div>

      {isHttpUpstream && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 text-xs">
          <Info className="w-4 h-4 shrink-0" />
          <span>当前业务包已绑定独立代理出口；若所连上游为标准 HTTP 代理，UDP 请求将自动收束为 TCP 代理。</span>
        </div>
      )}

      {/* 1. 协议与安全防护 */}
      {activeTab === "protocol" && (
        <div className="space-y-2.5">
          {/* 代理 TCP */}
          <div className="flex items-start justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="space-y-0.5 pr-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                代理 TCP 连接
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                透明重定向应用发起的外网 TCP 流量至本业务包专属出口（建议始终开启）
              </div>
            </div>
            <input
              type="checkbox"
              checked={policy.proxyTcp}
              onChange={(e) => onChange({ ...policy, proxyTcp: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
            />
          </div>

          {/* 阻止 IPv6 */}
          <div className="flex items-start justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="space-y-0.5 pr-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>阻止 IPv6 连接旁路</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  防泄漏
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                过滤 AAAA 记录并截断外网 IPv6 直连，彻底根绝本机公网 IPv6 旁路导致的真实 IP 泄露
              </div>
            </div>
            <input
              type="checkbox"
              checked={policy.blockIpv6}
              onChange={(e) => onChange({ ...policy, blockIpv6: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
            />
          </div>

          {/* 禁止 UDP */}
          <div className="flex items-start justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="space-y-0.5 pr-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>禁止 UDP (最高优先级 · 强制覆写)</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                  防 QUIC 延迟
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                快速返回重置，强迫浏览器 0ms 秒切 TCP HTTP/2，消除 1~2 秒首屏等待；同时杜绝 WebRTC 穿透泄露
              </div>
            </div>
            <input
              type="checkbox"
              checked={policy.blockUdp}
              onChange={(e) => onChange({ ...policy, blockUdp: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
            />
          </div>

          {/* 代理 UDP */}
          <div
            className={`flex items-start justify-between p-3 rounded-xl border transition-colors ${
              policy.blockUdp
                ? "bg-slate-100/50 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50 opacity-60"
                : "bg-slate-50 dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-700/60"
            }`}
          >
            <div className="space-y-0.5 pr-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>代理 UDP 数据报 (仅 SOCKS5 支持)</span>
                {policy.blockUdp && (
                  <span className="text-[10px] text-slate-400">
                    (已被「禁止 UDP」优先接管)
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                当未开启「禁止 UDP」且出口支持 SOCKS5 时通过 UDP ASSOCIATE 转发；若上游不支持将平滑降级
              </div>
            </div>
            <input
              type="checkbox"
              disabled={policy.blockUdp}
              checked={!policy.blockUdp && policy.proxyUdp}
              onChange={(e) => onChange({ ...policy, proxyUdp: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 disabled:opacity-40 cursor-pointer"
            />
          </div>

          {/* 代理衍生子进程 */}
          <div className="flex items-start justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="space-y-0.5 pr-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                代理衍生子进程
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Detours 自动追踪主程序创建的渲染、网络与辅助子进程链条，保持完整的代理环境
              </div>
            </div>
            <input
              type="checkbox"
              checked={policy.proxySubprocesses}
              onChange={(e) => onChange({ ...policy, proxySubprocesses: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
            />
          </div>

          {/* 禁用启动代理参数 */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 space-y-2.5">
            <div className="flex items-start justify-between">
              <div className="space-y-0.5 pr-3">
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>禁用启动代理参数 (--proxy-server)</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    安全自检兼容
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  禁止向应用启动命令行追加 --proxy-server 等参数。适用于 Google Gemini 等限制调试与网络覆盖开关的应用
                </div>
              </div>
              <input
                type="checkbox"
                checked={!!policy.disallowProxyArgs}
                onChange={(e) => onChange({ ...policy, disallowProxyArgs: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
              />
            </div>

            {policy.disallowProxyArgs && (
              <div className="p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  {typeof document !== "undefined" && document.documentElement.dataset.edition === "process" ? (
                    <span>
                      <strong>独立进程版针对性提示：</strong>独立进程版不含 TUN 虚拟网卡。若当前接入方式为<strong>【纯应用层】</strong>，开启此选项后应用启动将<strong>完全直连</strong>。请务必在顶部【接入方式】切换为<strong>【用户态 Hook】</strong>（免提权、轻量透明拦截）或<strong>【WinDivert 驱动】</strong>，实现免参数底层透明分流接管。
                    </span>
                  ) : (
                    <span>
                      <strong>提示：</strong>开启此项后应用将以无参数启动；需配合 <strong>TUN 虚拟网卡</strong>、<strong>WinDivert 驱动</strong>或<strong>用户态 Hook</strong> 底层接管分流。若处于纯应用层代理模式，流量将直接直连。
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. DNS 与局域网 */}
      {activeTab === "network" && (
        <div className="space-y-3.5">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-900 dark:text-white block">
              DNS 域名解析模式
            </label>
            <div className="grid grid-cols-1 gap-2">
              {/* safe_pure */}
              <label
                className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                  policy.dnsMode === "safe_pure"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500/80 ring-1 ring-indigo-500/20"
                    : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="dnsModeForm"
                  value="safe_pure"
                  checked={policy.dnsMode === "safe_pure"}
                  onChange={() => onChange({ ...policy, dnsMode: "safe_pure" })}
                  className="mt-0.5 mr-2.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>安全纯净解析</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                      推荐 · 100% 兼容
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    通过专用纯净解析通道向 DoH/DoT 安全上游获取真实公网 IP，SOCKS5 发送真实 IP；绝对兼容各类严苛软件，无任何假 IP 认知偏差
                  </div>
                </div>
              </label>

              {/* fake_ip */}
              <label
                className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                  policy.dnsMode === "fake_ip"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500/80 ring-1 ring-indigo-500/20"
                    : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="dnsModeForm"
                  value="fake_ip"
                  checked={policy.dnsMode === "fake_ip"}
                  onChange={() => onChange({ ...policy, dnsMode: "fake_ip" })}
                  className="mt-0.5 mr-2.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>Fake-IP 极速模式</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-sky-500/10 text-sky-600 dark:text-sky-400">
                      秒开 · 零本地泄露
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    本地 0ms 瞬间生成 198.18.x.x 假 IP，SOCKS5 CONNECT 报文携带原始域名（ATYP=0x03），远端节点解析；性能天花板，适合网页与 AI 工具
                  </div>
                </div>
              </label>

              {/* system_native */}
              <label
                className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                  policy.dnsMode === "system_native"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500/80 ring-1 ring-indigo-500/20"
                    : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="dnsModeForm"
                  value="system_native"
                  checked={policy.dnsMode === "system_native"}
                  onChange={() => onChange({ ...policy, dnsMode: "system_native" })}
                  className="mt-0.5 mr-2.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>系统原生解析</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                      直接放行
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    完全不劫持 DNS 解析，直接使用系统物理网络配置的 DNS 服务器；适合无需 DNS 护航的特定内网环境
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* 绕过局域网与本地回环 */}
          <div className="flex items-start justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="space-y-0.5 pr-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>本地回环与局域网直连绕过 (Bypass LAN)</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  开发者必备
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                127.0.0.1、localhost 以及 RFC1918 私网段（192.168.x.x、10.x.x.x）直连放行，本地服务调试与内网调用不走代理
              </div>
            </div>
            <input
              type="checkbox"
              checked={policy.bypassLan}
              onChange={(e) => onChange({ ...policy, bypassLan: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* 3. 目标与端口过滤 */}
      {activeTab === "filter" && (
        <div className="space-y-3.5">
          {/* 端口过滤 */}
          <div className="space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-xs font-bold text-slate-900 dark:text-white">
              端口黑白名单过滤 (Port Filter)
            </div>
            <div className="flex items-center space-x-4 text-xs">
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="portFilterModeForm"
                  value="all"
                  checked={policy.portFilterMode === "all"}
                  onChange={() => onChange({ ...policy, portFilterMode: "all" })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>代理全部端口</span>
              </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="portFilterModeForm"
                  value="web_only"
                  checked={policy.portFilterMode === "web_only"}
                  onChange={() => onChange({ ...policy, portFilterMode: "web_only" })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>仅 Web 端口 (80, 443)</span>
              </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="portFilterModeForm"
                  value="custom"
                  checked={policy.portFilterMode === "custom"}
                  onChange={() => onChange({ ...policy, portFilterMode: "custom" })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>自定义端口范围</span>
              </label>
            </div>

            {policy.portFilterMode === "custom" && (
              <div className="pt-1.5 space-y-1">
                <input
                  type="text"
                  value={policy.customPorts ?? ""}
                  onChange={(e) => onChange({ ...policy, customPorts: e.target.value })}
                  placeholder="例如：80, 443, 8000-8080 (逗号或短横线)"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-slate-400">
                  支持单端口（如 443）及端口区间（如 3000-3010）。
                </p>
              </div>
            )}
          </div>

          {/* 目标域名/IP 过滤 */}
          <div className="space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-xs font-bold text-slate-900 dark:text-white">
              目标域名 / IP 过滤规则 (Target Filter)
            </div>
            <div className="flex items-center space-x-4 text-xs">
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetFilterModeForm"
                  value="all"
                  checked={policy.targetFilterMode === "all"}
                  onChange={() => onChange({ ...policy, targetFilterMode: "all" })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>代理全部外网目标</span>
              </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetFilterModeForm"
                  value="include"
                  checked={policy.targetFilterMode === "include"}
                  onChange={() => onChange({ ...policy, targetFilterMode: "include" })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>仅代理匹配目标 (白名单)</span>
              </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetFilterModeForm"
                  value="exclude"
                  checked={policy.targetFilterMode === "exclude"}
                  onChange={() => onChange({ ...policy, targetFilterMode: "exclude" })}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>排除匹配目标 (黑名单直连)</span>
              </label>
            </div>

            {policy.targetFilterMode !== "all" && (
              <div className="pt-1.5 space-y-1">
                <textarea
                  rows={2}
                  value={(policy.targetRules ?? []).join("\n")}
                  onChange={(e) => onChange({
                    ...policy,
                    targetRules: e.target.value.split("\n").map(s => s.trim()).filter(Boolean),
                  })}
                  placeholder="例如：&#10;api.openai.com&#10;*.google.com&#10;1.1.1.1"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-slate-400">
                  支持通配符域名与 IP 地址段，每行一个。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
