// ==========================================================================
// ProcWeaver src-next 路由穿透诊断仪 (Route Simulator Tab) - 增强版
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 新增: 链路穿透深度 / DNS 模式标注 / 耗时估算 / 层级热力图 / 复合条件快速模板
// 风格约束: 严禁 Emoji，全量细线几何，纯键盘一键试算
// ==========================================================================

import React, { useState, useMemo } from "react";
import { RuleItem, RouteSimulateResult } from "../../types/rules";
import { simulateRouting } from "../../services/rulesService";

interface RouteSimulatorTabProps {
  rules: RuleItem[];
}

// DNS 模式判断逻辑
type DnsModeInfo = {
  mode: "fake_ip" | "real_ip" | "unknown";
  label: string;
  latency: string;
  color: string;
};

function detectDnsMode(rule: RuleItem | undefined): DnsModeInfo {
  if (!rule) return { mode: "unknown", label: "未知", latency: "—", color: "text-[var(--text-muted)]" };
  const type = rule.type?.toUpperCase() ?? "";
  // IP 类规则：直接 no-resolve，DNS 完全不参与
  if (type === "IP-CIDR" || type === "IP-CIDR6" || type === "GEOIP") {
    return { mode: "real_ip", label: "no-resolve 旁路", latency: "0 ms (无DNS)", color: "text-emerald-500" };
  }
  // MATCH 兜底：走 fake-ip 通道
  if (type === "MATCH") {
    return { mode: "fake_ip", label: "Fake-IP 兜底", latency: "< 1 ms", color: "text-blue-500" };
  }
  // 域名类规则：内核 fake-ip 下 0ms 直接命中
  return { mode: "fake_ip", label: "Fake-IP 极速", latency: "< 1 ms (0 DNS)", color: "text-emerald-500" };
}

// 规则层级判断（金字塔短路层）
function detectRuleLayer(rule: RuleItem | undefined, ruleIndex: number): { layer: number; label: string; color: string } {
  if (!rule) return { layer: -1, label: "未命中", color: "text-[var(--text-muted)]" };
  const type = rule.type?.toUpperCase() ?? "";
  const proxy = rule.proxy?.toUpperCase() ?? "";

  if (type === "IP-CIDR" || type === "IP-CIDR6") {
    return { layer: 0, label: "第 0 层 — LAN 私网直连 (纳秒级)", color: "text-zinc-400" };
  }
  if (proxy === "REJECT") {
    return { layer: 1, label: "第 1 层 — 广告/恶意阻断熔断 (纳秒级)", color: "text-rose-500" };
  }
  if (type === "RULE-SET") {
    return { layer: 2, label: "第 2 层 — MRS Radix Tree 规则集 (微秒级)", color: "text-blue-500" };
  }
  if (type === "GEOSITE") {
    return { layer: 2, label: "第 2 层 — GEOSITE 大陆域名库 (微秒级)", color: "text-blue-400" };
  }
  if (type === "GEOIP") {
    return { layer: 3, label: "第 3 层 — GEOIP 国内 IP 兜底 (毫秒级)", color: "text-amber-500" };
  }
  if (type === "MATCH") {
    return { layer: 4, label: "第 4 层 — MATCH 终极兜底", color: "text-zinc-500" };
  }
  return { layer: 2, label: `第 2 层 — ${type} 规则 (序号 #${ruleIndex})`, color: "text-blue-500" };
}

// 耗时估算
function estimateLatency(layer: number): string {
  switch (layer) {
    case 0: return "< 0.001 ms (硬件旁路)";
    case 1: return "< 0.01 ms (熔断短路)";
    case 2: return "< 0.03 ms (Radix Tree)";
    case 3: return "< 50 ms (等待 DNS)";
    case 4: return "< 0.01 ms (兜底)";
    default: return "未知";
  }
}

const PRESET_TEST_TARGETS = [
  { label: "ChatGPT", domain: "chatgpt.com" },
  { label: "GitHub", domain: "github.com" },
  { label: "Bilibili", domain: "bilibili.com" },
  { label: "Google", domain: "google.com" },
  { label: "局域网 IP", domain: "192.168.1.1" },
  { label: "time.windows.com", domain: "time.windows.com" },
];

// 复合逻辑规则快速模板
const COMPOUND_TEMPLATES = [
  {
    label: "进程+端口",
    template: "AND,((PROCESS-NAME,xxx.exe),(DST-PORT,443))",
    desc: "仅接管指定进程的 HTTPS 流量",
  },
  {
    label: "进程+域名",
    template: "AND,((PROCESS-NAME,xxx.exe),(DOMAIN-SUFFIX,openai.com))",
    desc: "进程访问指定域名才命中",
  },
  {
    label: "规则集排除",
    template: "AND,((RULE-SET,nb-ai),(NOT,((DOMAIN-SUFFIX,oaiusercontent.com))))",
    desc: "AI 规则集排除 CDN 子域",
  },
];

export const RouteSimulatorTab: React.FC<RouteSimulatorTabProps> = ({ rules }) => {
  const [inputVal, setInputVal] = useState("chatgpt.com");
  const [result, setResult] = useState<RouteSimulateResult | null>(() => {
    return simulateRouting("chatgpt.com", rules);
  });
  const [showTemplates, setShowTemplates] = useState(false);

  const handleSimulate = (target?: string) => {
    const query = (target !== undefined ? target : inputVal).trim();
    if (!query) return;
    if (target !== undefined) setInputVal(target);
    const res = simulateRouting(query, rules);
    setResult(res);
  };

  const dnsInfo = useMemo(() => detectDnsMode(result?.rule), [result]);
  const layerInfo = useMemo(() => detectRuleLayer(result?.rule, result?.ruleIndex ?? 0), [result]);
  const latencyEstimate = useMemo(() => estimateLatency(layerInfo.layer), [layerInfo]);

  return (
    <div className="space-y-4">
      {/* 顶部输入与诊断命令条 */}
      <div className="p-4 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-3">
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-[var(--text-primary)]">
            路由穿透与规则命中试算
          </h4>
          <p className="text-[11px] text-[var(--text-muted)]">
            输入任意域名或 IP，追溯当前内核规则链的匹配顺序、层级深度、DNS 耗时与出口插槽
          </p>
        </div>

        {/* 宽幅一体化输入条 */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus-within:border-blue-500/50 transition-colors">
          <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
            placeholder="输入域名或 IP，如 claude.ai、github.com、1.1.1.1..."
            className="flex-1 bg-transparent text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => handleSimulate()}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <span>诊断</span>
            <span className="text-[10px] opacity-70">↵</span>
          </button>
        </div>

        {/* 快捷测试标签滑轨 */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">常见探测:</span>
          {PRESET_TEST_TARGETS.map((t) => (
            <button
              key={t.domain}
              type="button"
              onClick={() => handleSimulate(t.domain)}
              className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer whitespace-nowrap"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 试算穿透结果卡片（增强版） */}
      {result && (
        <div className="p-4 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4 animate-in fade-in duration-150">
          {/* 顶栏: 状态 + 层级热力 + 耗时估算 */}
          <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-3">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  result.matched ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                }`}
              />
              <h5 className="text-xs font-bold text-[var(--text-primary)]">
                试算分析报告
              </h5>
              {result.matched && (
                <span className={`text-[10px] font-mono font-semibold ${layerInfo.color}`}>
                  {layerInfo.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-mono ${dnsInfo.color}`}>
                {dnsInfo.label} · {dnsInfo.latency}
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                规则匹配耗时: {latencyEstimate}
              </span>
            </div>
          </div>

          {/* 层级穿透热力进度条 */}
          {result.matched && layerInfo.layer >= 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                <span>规则链穿透深度</span>
                <span>第 {layerInfo.layer} 层 / 共 4 层</span>
              </div>
              <div className="h-1 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    layerInfo.layer === 0 ? "w-[5%] bg-zinc-400" :
                    layerInfo.layer === 1 ? "w-[25%] bg-rose-500" :
                    layerInfo.layer === 2 ? "w-[50%] bg-blue-500" :
                    layerInfo.layer === 3 ? "w-[75%] bg-amber-500" :
                    "w-full bg-zinc-500"
                  }`}
                />
              </div>
              <div className="flex justify-between text-[9px] font-mono text-[var(--text-muted)]">
                <span>LAN直连</span>
                <span>REJECT熔断</span>
                <span>规则集</span>
                <span>GEOIP</span>
                <span>MATCH</span>
              </div>
            </div>
          )}

          {/* 四步穿透链路卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
            {/* 步骤 1: 请求目标 */}
            <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1">
              <div className="text-[10px] font-semibold text-[var(--text-muted)]">1. 请求目标</div>
              <div className="font-mono font-bold text-[var(--text-primary)] truncate" title={result.input}>
                {result.input}
              </div>
              <div className={`text-[9px] font-mono ${dnsInfo.color}`}>
                DNS: {dnsInfo.label}
              </div>
            </div>

            {/* 步骤 2: 命中规则类型 + 层级 */}
            <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1">
              <div className="text-[10px] font-semibold text-[var(--text-muted)]">2. 命中规则类型</div>
              <div className="font-mono font-bold text-blue-500 truncate">
                {result.rule?.type || "未命中"}
              </div>
              <div className={`text-[9px] font-mono ${layerInfo.color}`}>
                {layerInfo.layer >= 0 ? `L${layerInfo.layer}` : "—"}
              </div>
            </div>

            {/* 步骤 3: 匹配表达式 + 序号 */}
            <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1">
              <div className="text-[10px] font-semibold text-[var(--text-muted)]">
                3. 规则序号与表达式
              </div>
              <div className="font-mono font-bold text-[var(--text-primary)] truncate" title={result.rule?.payload}>
                #{result.ruleIndex || 0} · {result.rule?.payload || "兜底"}
              </div>
              <div className="text-[9px] font-mono text-[var(--text-muted)]">
                耗时: {latencyEstimate.split(" ")[0]}
              </div>
            </div>

            {/* 步骤 4: 最终出站节点 */}
            <div
              className={`p-3 rounded-xl border space-y-1 ${
                result.rule?.proxy?.toUpperCase() === "REJECT"
                  ? "bg-rose-500/10 border-rose-500/25"
                  : result.rule?.proxy?.toUpperCase() === "DIRECT"
                  ? "bg-zinc-500/10 border-zinc-500/25"
                  : "bg-emerald-500/10 border-emerald-500/25"
              }`}
            >
              <div
                className={`text-[10px] font-semibold ${
                  result.rule?.proxy?.toUpperCase() === "REJECT"
                    ? "text-rose-500"
                    : result.rule?.proxy?.toUpperCase() === "DIRECT"
                    ? "text-zinc-500"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                4. 最终出站出口
              </div>
              <div
                className={`font-mono font-bold truncate ${
                  result.rule?.proxy?.toUpperCase() === "REJECT"
                    ? "text-rose-500"
                    : result.rule?.proxy?.toUpperCase() === "DIRECT"
                    ? "text-zinc-500"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
                title={result.targetProxy}
              >
                {result.targetProxy || "DIRECT"}
              </div>
            </div>
          </div>

          {/* 详细诊断解释 */}
          <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] flex items-start gap-2.5">
            <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-xs space-y-0.5 flex-1">
              <div className="font-semibold text-[var(--text-primary)]">
                {result.matchType || "试算结果"}
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {result.matchDetail || "根据规则优先级执行"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 复合逻辑规则快速模板参考 (AND/OR/NOT) */}
      <div className="rounded-2xl glass-surface border border-[var(--glass-border-subtle)] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg className={`w-3.5 h-3.5 text-blue-500 transition-transform duration-200 ${showTemplates ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-xs font-bold text-[var(--text-primary)]">复合逻辑规则模板参考 (AND / OR / NOT)</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">高级进程+域名组合分流</span>
        </button>

        {showTemplates && (
          <div className="border-t border-[var(--glass-border-subtle)] p-3 space-y-2 animate-in fade-in duration-150">
            <p className="text-[11px] text-[var(--text-muted)] px-1">
              Mihomo v1.19.31 原生支持 AND / OR / NOT 任意嵌套。以下模板可复制到自定义规则集或配置文件中使用：
            </p>
            {COMPOUND_TEMPLATES.map((t, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-blue-500">{t.label}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(t.template)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    title="复制模板"
                  >
                    复制
                  </button>
                </div>
                <code className="block text-[10px] font-mono text-[var(--text-primary)] bg-black/10 dark:bg-white/10 px-2 py-1 rounded-lg break-all">
                  {t.template}
                </code>
                <p className="text-[10px] text-[var(--text-muted)]">{t.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
