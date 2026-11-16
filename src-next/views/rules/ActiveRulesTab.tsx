// ==========================================================================
// ProcWeaver src-next 实时分流规则大盘 (Active Rules Tab)
// 规范溯源: typography-dark-mono-optics / tauri-desktop-layout-typography / taste-skill
// 风格约束: 双轨等宽分流，消除光渗，点击一键复制表达式
// ==========================================================================

import React, { useState, useMemo } from "react";
import { RuleItem } from "../../types/rules";
import { CustomSelect } from "../../primitives/CustomSelect";

interface ActiveRulesTabProps {
  rules: RuleItem[];
  onShowNotice?: (msg: string) => void;
}

const RULE_TYPES = [
  "ALL",
  "DOMAIN-SUFFIX",
  "DOMAIN",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "GEOSITE",
  "GEOIP",
  "MATCH",
];

// 命中热力颜色：依据 size（命中次数）渲染
function getHeatColor(size?: number): string {
  if (!size || size === 0) return "text-[var(--text-muted)] opacity-50"; // 零命中：灰淡
  if (size < 10) return "text-zinc-400";
  if (size < 100) return "text-blue-400";
  if (size < 1000) return "text-blue-500 font-semibold";
  return "text-emerald-500 font-bold"; // 超高频：绿色醒目
}

function getHeatBarWidth(size?: number): string {
  if (!size || size === 0) return "w-0";
  if (size < 10) return "w-[5%]";
  if (size < 100) return "w-[25%]";
  if (size < 1000) return "w-[60%]";
  return "w-full";
}

function getHeatBarColor(size?: number): string {
  if (!size || size === 0) return "bg-zinc-500/20";
  if (size < 10) return "bg-zinc-400";
  if (size < 100) return "bg-blue-400";
  if (size < 1000) return "bg-blue-500";
  return "bg-emerald-500";
}

export const ActiveRulesTab: React.FC<ActiveRulesTabProps> = ({ rules, onShowNotice }) => {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [proxyFilter, setProxyFilter] = useState<string>("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 分页参数
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // 提取所有涉及的出口名称
  const availableProxies = useMemo(() => {
    const set = new Set<string>();
    rules.forEach((r) => {
      if (r.proxy) set.add(r.proxy);
    });
    return Array.from(set);
  }, [rules]);

  // 毫秒级规则匹配过滤
  const filteredRules = useMemo(() => {
    let result = rules;

    if (selectedType !== "ALL") {
      result = result.filter((r) => r.type.toUpperCase() === selectedType.toUpperCase());
    }

    if (proxyFilter !== "ALL") {
      result = result.filter((r) => r.proxy === proxyFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.payload.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          r.proxy.toLowerCase().includes(q)
      );
    }

    return result;
  }, [rules, selectedType, proxyFilter, search]);

  // 计算当前分页切片
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / pageSize));
  const pagedRules = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRules.slice(start, start + pageSize);
  }, [filteredRules, currentPage, pageSize]);

  // 点击复制表达式
  const handleCopyPayload = (rule: RuleItem) => {
    const text = rule.payload || rule.type;
    navigator.clipboard.writeText(text);
    setCopiedId(rule.id);
    if (onShowNotice) {
      onShowNotice(`已复制规则表达式: ${text}`);
    }
    setTimeout(() => {
      setCopiedId((prev) => (prev === rule.id ? null : prev));
    }, 1500);
  };

  // 出口标签三态语义样式
  const renderProxyBadge = (proxyName: string) => {
    const upper = proxyName.toUpperCase();
    if (upper === "DIRECT") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-secondary)] shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
          <span>DIRECT 直连</span>
        </span>
      );
    }
    if (upper === "REJECT") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono bg-rose-500/10 border border-rose-500/25 text-rose-500 font-semibold shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          <span>REJECT 阻断</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono bg-blue-500/10 border border-blue-500/25 text-blue-500 font-medium shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        <span className="truncate max-w-[140px]">{proxyName}</span>
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* 搜索框与类型滑轨 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        {/* 宽幅一体化搜索条 */}
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="按域名、IP段、规则类型或出口过滤搜索..."
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setCurrentPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
            >
              ×
            </button>
          )}
        </div>

        {/* 出口插槽快速筛选下拉 */}
        <div className="shrink-0 w-44">
          <CustomSelect
            value={proxyFilter}
            onChange={(val) => {
              setProxyFilter(val);
              setCurrentPage(1);
            }}
            options={[
              { value: "ALL", label: "全部出站出口" },
              { value: "DIRECT", label: "DIRECT (国内直连)" },
              { value: "REJECT", label: "REJECT (广告丢弃)" },
              ...availableProxies
                .filter((p) => p !== "DIRECT" && p !== "REJECT")
                .map((p) => ({ value: p, label: p })),
            ]}
            size="md"
          />
        </div>
      </div>

      {/* 规则类型轻量胶囊滑轨 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none">
        {RULE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              setSelectedType(type);
              setCurrentPage(1);
            }}
            className={`px-2.5 py-1 rounded-lg font-mono text-[11px] whitespace-nowrap transition-all cursor-pointer ${
              selectedType === type
                ? "bg-blue-500 text-white font-semibold shadow-xs"
                : "bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* 规则列表流 */}
      <div className="space-y-1.5 min-h-[300px]">
        {pagedRules.length === 0 ? (
          <div className="p-12 text-center text-xs text-[var(--text-muted)] glass-surface rounded-2xl border border-[var(--glass-border-subtle)]">
            未找到匹配的规则条目
          </div>
        ) : (
          pagedRules.map((rule, index) => {
            const globalIndex = (currentPage - 1) * pageSize + index + 1;
            const isCopied = copiedId === rule.id;

            return (
              <div
                key={rule.id}
                onClick={() => handleCopyPayload(rule)}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:px-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-blue-500/30 hover:bg-black/10 dark:hover:bg-white/10 transition-all cursor-pointer group"
                title="点击一键复制表达式到剪贴板"
              >
                {/* 左侧: 序号 + 类型徽标 + 表达式 */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] w-8 text-right shrink-0 tabular-numeric">
                    #{globalIndex}
                  </span>

                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] shrink-0">
                    {rule.type}
                  </span>

                  <div className="font-mono text-xs text-[var(--text-primary)] truncate flex items-center gap-1.5">
                    <span className="group-hover:text-blue-500 transition-colors">
                      {rule.payload || "<MATCH 兜底匹配>"}
                    </span>
                    {isCopied && (
                      <span className="text-[10px] text-emerald-500 font-sans font-semibold animate-in fade-in">
                        ✓ 已复制
                      </span>
                    )}
                  </div>
                </div>

                {/* 右侧: 命中热力 + 出口插槽胶囊 */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  {/* 命中热力标注 (基于 size 字段) */}
                  {rule.size !== undefined && (
                    <div className="flex flex-col items-end gap-0.5" title={`命中次数: ${rule.size}`}>
                      <span className={`text-[9px] font-mono tabular-nums ${getHeatColor(rule.size)}`}>
                        {rule.size === 0 ? "零命中" : `${rule.size.toLocaleString()}×`}
                      </span>
                      <div className="w-12 h-0.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${getHeatBarWidth(rule.size)} ${getHeatBarColor(rule.size)}`} />
                      </div>
                    </div>
                  )}
                  {renderProxyBadge(rule.proxy)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部高密度分页器 (等宽排版) */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border-subtle)] text-xs text-[var(--text-muted)] select-none">
        <span className="font-mono text-[11px]">
          共 <span className="text-[var(--text-primary)] font-semibold tabular-numeric">{filteredRules.length}</span> 条有效规则
        </span>

        <div className="flex items-center gap-2 font-mono">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="px-2.5 py-1 rounded-lg border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 hover:text-[var(--text-primary)] transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            上一页
          </button>
          <span className="px-2 tabular-numeric">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="px-2.5 py-1 rounded-lg border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 hover:text-[var(--text-primary)] transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
};
