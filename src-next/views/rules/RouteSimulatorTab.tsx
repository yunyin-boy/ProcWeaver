import React, { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "../../primitives/Button";
import type { RuleItem } from "../../types/rules";
import { simulateRouting } from "../../services/rulesService";

interface RouteSimulatorTabProps {
  rules: RuleItem[];
  onShowNotice?: (msg: string) => void;
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

export const RouteSimulatorTab: React.FC<RouteSimulatorTabProps> = ({ rules, onShowNotice }) => {
  const [inputVal, setInputVal] = useState("chatgpt.com");
  const [target, setTarget] = useState("chatgpt.com");
  const result = useMemo(() => simulateRouting(target, rules), [rules, target]);
  const output = result.targetProxy?.toUpperCase();
  const outputTone = output === "REJECT" ? "text-[var(--workbench-danger)]" : "text-[var(--workbench-accent)]";

  const runTest = (value: string) => {
    const query = value.trim();
    if (!query) return;
    setInputVal(query);
    setTarget(query);
  };

  const copyTemplate = async (template: string) => {
    try {
      await navigator.clipboard.writeText(template);
      onShowNotice?.("已复制规则模板");
    } catch {
      onShowNotice?.("复制规则模板失败");
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <section className="workbench-panel grid min-w-0 gap-3 p-4" aria-label="路由试算输入">
        <form onSubmit={(event) => { event.preventDefault(); runTest(inputVal); }} className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="workbench-field flex min-w-[min(100%,12rem)] flex-1 items-center gap-2 px-2.5">
            <Search size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              aria-label="试算目标"
              value={inputVal}
              onChange={(event) => setInputVal(event.target.value)}
              placeholder="输入域名或 IP"
              className="min-h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px]"
            />
          </div>
          <Button type="submit" variant="primary" size="lg" disabled={!inputVal.trim()}>试算</Button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-[var(--text-muted)]">常用目标</span>
          {PRESET_TEST_TARGETS.map((preset) => (
            <Button key={preset.domain} type="button" size="sm" onClick={() => runTest(preset.domain)}>{preset.label}</Button>
          ))}
        </div>
      </section>

      <section className="workbench-panel grid min-w-0 gap-3.5 p-4" aria-label="路由试算结果" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="workbench-panel-title">试算结果</h3>
          <span className={"workbench-tag " + (result.matched ? "workbench-tag-positive" : "")}>{result.matched ? "命中规则" : "未命中"}</span>
        </div>
        <dl className="workbench-stat-grid">
          <div className="min-w-0">
            <dt>目标</dt>
            <dd className="font-mono">{result.input}</dd>
          </div>
          <div className="min-w-0">
            <dt>出口</dt>
            <dd className={outputTone}>{result.targetProxy || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt>规则类型</dt>
            <dd className="font-mono">{result.rule?.type || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt>规则顺序</dt>
            <dd className="tabular-nums">{result.ruleIndex ?? "—"}</dd>
          </div>
        </dl>
        {result.rule?.payload && <code className="min-w-0 [overflow-wrap:anywhere] rounded-lg bg-[var(--workbench-row-hover)] px-3 py-2 text-xs">{result.rule.payload}</code>}
        {result.matchDetail && <p className="text-xs leading-relaxed text-[var(--text-muted)]">{result.matchDetail}</p>}
        <p className="text-xs text-[var(--text-muted)]">根据列表中的规则顺序试算，实际出口以核心为准。</p>
      </section>

      <details className="workbench-panel min-w-0 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold">复合规则模板</span>
          <ChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        </summary>
        <div className="mt-3 grid min-w-0 gap-2">
          {COMPOUND_TEMPLATES.map((template) => (
            <article key={template.label} className="grid min-w-0 gap-1.5 rounded-lg bg-[var(--workbench-row-hover)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[13px] font-semibold">{template.label}</h4>
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyTemplate(template.template)}>复制</Button>
              </div>
              <code className="[overflow-wrap:anywhere] font-mono text-xs">{template.template}</code>
              <p className="text-xs text-[var(--text-muted)]">{template.desc}</p>
            </article>
          ))}
        </div>
      </details>
    </div>
  );
};
