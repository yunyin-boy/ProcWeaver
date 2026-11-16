// ==========================================================================
// ProcWeaver src-next 业务分流出口选择模态弹窗 (OutletPickerModal)
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy / taste-skill
// 交互模式: 模式 B (单击选中高亮，双击或点击确认按钮正式换绑生效，防误触)
// 视觉规范: 扎实双层毛玻璃 (95%不透明度防背景文字穿透)、1px发丝微高光、无Emoji
// ==========================================================================

import React, { useState, useEffect, useMemo, useRef } from "react";
import { cleanProxyOptions } from "../../services/processRoutingService";

export interface OutletPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  bundleName?: string;
  currentProxy: string;
  availableProxies: string[];
  onConfirm: (selectedProxy: string) => void;
}

type RegionTab = "all" | "common" | "hk" | "jp" | "us" | "sg" | "other";

interface TabDef {
  id: RegionTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: "all", label: "全部" },
  { id: "common", label: "常用策略 (Proxy/自动)" },
  { id: "hk", label: "香港" },
  { id: "jp", label: "日本" },
  { id: "us", label: "美国" },
  { id: "sg", label: "新加坡" },
  { id: "other", label: "其他节点" },
];

const RESERVED_PROXIES = new Set(["DIRECT", "REJECT", "GLOBAL", "RULES"]);

export const OutletPickerModal: React.FC<OutletPickerModalProps> = ({
  isOpen,
  onClose,
  bundleName = "当前业务包",
  currentProxy,
  availableProxies,
  onConfirm,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<RegionTab>("all");
  const [selectedProxy, setSelectedProxy] = useState<string>(currentProxy || "Proxy");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 清洗并去重所有可用代理出站
  const cleanedList = useMemo(() => {
    const rawCleaned = cleanProxyOptions(availableProxies);
    const set = new Set<string>();
    const list: Array<{ value: string; label: string; isGroup: boolean; region: RegionTab }> = [];

    // 固定置顶项：Proxy (遵循核心规则与主代理)
    const fixedTop: string[] = ["Proxy"];
    const allCandidates = Array.from(new Set([...fixedTop, ...rawCleaned.map((c) => c.value)]));

    for (const item of allCandidates) {
      if (!item || set.has(item)) continue;
      const trimmed = item.trim();
      const upper = trimmed.toUpperCase();
      // 过滤系统底层保留关键字，防止内核拦截
      if (RESERVED_PROXIES.has(upper)) continue;
      // 过滤内部锚点与本地方案占位策略组
      if (trimmed.startsWith("PW-") || trimmed.startsWith("本地方案")) continue;

      set.add(item);

      const lower = item.toLowerCase();
      let region: RegionTab = "other";
      if (item === "Proxy" || lower.includes("auto") || lower.includes("自动") || lower.includes("selector")) {
        region = "common";
      } else if (/香港|九龙|hk|hongkong/i.test(item)) {
        region = "hk";
      } else if (/日本|东京|大阪|jp|japan/i.test(item)) {
        region = "jp";
      } else if (/美国|洛杉矶|硅谷|us|united states/i.test(item)) {
        region = "us";
      } else if (/新加坡|狮城|sg|singapore/i.test(item)) {
        region = "sg";
      }

      const isGroup = item === "Proxy" || lower.includes("auto") || lower.includes("自动");

      list.push({
        value: item,
        label: item,
        isGroup,
        region,
      });
    }

    return list;
  }, [availableProxies]);

  // 当弹窗打开时，重置搜索并同步初始选中项
  useEffect(() => {
    if (isOpen) {
      setSelectedProxy(currentProxy || "Proxy");
      setSearchQuery("");
      setActiveTab("all");
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentProxy]);

  // 根据分类与搜索过滤
  const filteredList = useMemo(() => {
    let result = cleanedList;

    if (activeTab === "common") {
      result = result.filter((item) => item.region === "common");
    } else if (activeTab !== "all") {
      result = result.filter((item) => item.region === activeTab);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((item) => item.value.toLowerCase().includes(q));
    }

    return result;
  }, [cleanedList, activeTab, searchQuery]);

  // 键盘快捷键支持：ESC 关闭，Enter 确认
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedProxy) {
          onConfirm(selectedProxy);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedProxy, onConfirm, onClose]);

  if (!isOpen) return null;

  const handleConfirmAction = () => {
    if (!selectedProxy) return;
    onConfirm(selectedProxy);
    onClose();
  };

  const handleItemDoubleClick = (val: string) => {
    setSelectedProxy(val);
    onConfirm(val);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 shadow-2xl p-5 text-left flex flex-col gap-3.5 max-h-[86vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部微高光发丝线 */}
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 dark:via-white/15 to-transparent pointer-events-none" />

        {/* 1. 头部：标题与关闭按钮 */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[var(--glass-border-subtle)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-wide">
                选择分流出口节点
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                为业务包 <span className="font-semibold text-blue-500">[{bundleName}]</span> 指定专属出站插槽
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            title="关闭 (Esc)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 2. 搜索框与即时过滤 */}
        <div className="relative shrink-0">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索节点名称、地区、协议（如 香港、日本、BGP、DIRECT）..."
            className="w-full pl-9 pr-8 py-2 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 3. 地区与分类标签胶囊 (Tabs) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0 scrollbar-none text-[11px]">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                    : "bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/10 border border-transparent"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 4. 节点列表区 (支持单选高亮与双击确认) */}
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-[220px] max-h-[340px] pr-1.5 p-1.5 border border-[var(--glass-border-subtle)] rounded-xl bg-black/[0.02] dark:bg-white/[0.02]">
          {filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)] text-xs space-y-1">
              <svg className="w-8 h-8 opacity-40 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>未检索到匹配的出口节点</span>
              <span className="text-[10px] opacity-70">请调整搜索关键词或切换分类标签</span>
            </div>
          ) : (
            filteredList.map((item) => {
              const isSelected = selectedProxy === item.value;
              const isCurrentlyBound = currentProxy === item.value;

              return (
                <div
                  key={item.value}
                  onClick={() => setSelectedProxy(item.value)}
                  onDoubleClick={() => handleItemDoubleClick(item.value)}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all border ${
                    isSelected
                      ? "bg-blue-500/15 border-blue-500/50 text-[var(--text-primary)] shadow-sm"
                      : "border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    {/* 单选圈 / 对勾 */}
                    <div
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-[var(--glass-border-medium)] group-hover:border-[var(--text-muted)]"
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* 节点名称 */}
                    <span className="font-medium truncate tracking-tight text-[11px]">
                      {item.value}
                    </span>
                  </div>

                  {/* 状态徽标 */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.isGroup ? (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        策略组
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                        节点
                      </span>
                    )}

                    {isCurrentlyBound && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                        当前使用
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 5. 底部操作栏 (模式 B: 单击高亮选中，确认换绑后正式生效) */}
        <div className="flex items-center justify-between pt-2.5 border-t border-[var(--glass-border-subtle)] shrink-0">
          <div className="min-w-0 flex-1 pr-3">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <span className="shrink-0">待绑定:</span>
              <span className="font-semibold text-[var(--text-primary)] truncate max-w-[220px]" title={selectedProxy}>
                {selectedProxy || "未选择"}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline opacity-75 shrink-0">
                (支持双击快速应用)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--glass-border-medium)] transition cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmAction}
              disabled={!selectedProxy}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/25 transition cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              确认更换出口
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
