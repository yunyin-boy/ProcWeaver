import React, { useMemo, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CustomSelect } from "../../primitives/CustomSelect";
import type { RuleItem } from "../../types/rules";

interface ActiveRulesTabProps {
  rules: RuleItem[];
  onShowNotice?: (msg: string) => void;
}

const PAGE_SIZE = 50;

export const ActiveRulesTab: React.FC<ActiveRulesTabProps> = ({ rules, onShowNotice }) => {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [proxyFilter, setProxyFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const typeOptions = useMemo(() => [
    { value: "", label: "全部类型" },
    ...Array.from(new Set(rules.map((rule) => rule.type))).sort().map((type) => ({ value: type, label: type })),
  ], [rules]);
  const proxyOptions = useMemo(() => [
    { value: "", label: "全部出口" },
    ...Array.from(new Set(rules.map((rule) => rule.proxy))).filter(Boolean).sort().map((proxy) => ({ value: proxy, label: proxy })),
  ], [rules]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rules.map((rule, index) => ({ rule, order: index + 1 })).filter(({ rule }) =>
      (!selectedType || rule.type === selectedType) &&
      (!proxyFilter || rule.proxy === proxyFilter) &&
      (!query || [rule.payload, rule.type, rule.proxy].some((value) => value.toLowerCase().includes(query)))
    );
  }, [rules, selectedType, proxyFilter, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const pageRules = filteredRules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasStatistics = filteredRules.some(({ rule }) => rule.size !== undefined || rule.hitCount !== undefined);

  const copyRule = async (rule: RuleItem) => {
    try {
      await navigator.clipboard.writeText(rule.payload || rule.type);
      onShowNotice?.("已复制规则表达式");
    } catch {
      onShowNotice?.("复制规则表达式失败");
    }
  };

  return (
    <section className="workbench-panel grid min-w-0 gap-3.5 p-4" aria-label="分流规则列表">
      <div className="workbench-rule-filters">
        <div className="workbench-field flex min-w-0 items-center gap-2 px-2.5">
          <Search size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索分流规则"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }}
            placeholder="搜索域名、网段或出口"
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px]"
          />
          {search && (
            <button
              type="button"
              className="workbench-title-button !min-h-6 !min-w-6"
              aria-label="清除搜索"
              onClick={() => { setSearch(""); setCurrentPage(1); }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <CustomSelect value={selectedType} onChange={(value) => { setSelectedType(value); setCurrentPage(1); }} options={typeOptions} />
        <CustomSelect value={proxyFilter} onChange={(value) => { setProxyFilter(value); setCurrentPage(1); }} options={proxyOptions} />
      </div>

      {pageRules.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]" role="status">
          {rules.length ? "没有匹配的分流规则" : "暂无可显示的分流规则"}
        </p>
      ) : (
        <div className="workbench-routing-table" data-statistics={hasStatistics || undefined} role="table" aria-label="分流规则">
          <div className="workbench-routing-row workbench-routing-heading" role="row">
            <span role="columnheader">顺序</span>
            <span role="columnheader">类型</span>
            <span role="columnheader">匹配条件</span>
            <span role="columnheader">出口</span>
            {hasStatistics && <span role="columnheader">统计</span>}
          </div>
          {pageRules.map(({ rule, order }) => {
            const proxy = rule.proxy.toUpperCase();
            const proxyLabel = proxy === "DIRECT" ? "DIRECT 直连" : proxy === "REJECT" ? "REJECT 阻断" : rule.proxy;
            const proxyTone = proxy === "DIRECT" ? "" : proxy === "REJECT" ? "workbench-tag-warning" : "workbench-tag-accent";
            return (
              <div key={rule.id} className="workbench-routing-row" role="row">
                <span role="cell" className="tabular-nums text-[var(--text-muted)]">{order}</span>
                <div role="cell" className="flex min-w-0 flex-wrap gap-1">
                  <span className="workbench-tag max-w-full [overflow-wrap:anywhere] font-mono">{rule.type}</span>
                  {rule.disabled && <span className="workbench-tag">已停用</span>}
                </div>
                <div role="cell" className="workbench-routing-condition min-w-0">
                  <button
                    type="button"
                    className="workbench-routing-copy"
                    title="复制规则表达式"
                    onClick={() => void copyRule(rule)}
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere] font-mono">{rule.payload || "兜底匹配"}</span>
                    <Copy size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  </button>
                </div>
                <div role="cell" className="min-w-0">
                  <span className={"workbench-tag max-w-full [overflow-wrap:anywhere] " + proxyTone}>{proxyLabel}</span>
                </div>
                {hasStatistics && (
                  <div role="cell" className="workbench-routing-statistics flex min-w-0 flex-wrap gap-x-2 gap-y-1 tabular-nums text-[var(--text-muted)]">
                    {rule.size !== undefined && <span>{rule.size.toLocaleString()} 条</span>}
                    {rule.hitCount !== undefined && <span>命中 {rule.hitCount.toLocaleString()}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span role="status">共 {filteredRules.length.toLocaleString()} 条</span>
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => setCurrentPage(page - 1)} disabled={page <= 1}>上一页</Button>
            <span className="tabular-nums">{page} / {totalPages}</span>
            <Button type="button" size="sm" onClick={() => setCurrentPage(page + 1)} disabled={page >= totalPages}>下一页</Button>
          </div>
        )}
      </footer>
    </section>
  );
};
