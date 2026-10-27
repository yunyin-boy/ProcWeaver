import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  X,
  FolderOpen,
  ShieldCheck,
  Check,
  Laptop,
  HelpCircle,
} from "lucide-react";
import { VirtualList } from "../VirtualList";
import {
  aggregateProcessCards,
  KNOWN_APP_NAMES,
  type ProcessAppCard,
} from "../../services/processDiscovery";
import { useProcessDiscovery, type DiscoveryInput } from "../../hooks/useProcessDiscovery";
import type { BundleProcessBinding } from "../../types/businessBundle";
import { executableName, processKey } from "../../utils/bundlePlatform";
import { routingApi } from "../../api/routingOverrides";

type Props = {
  mode: "processes" | "domains";
  input: DiscoveryInput;
  onClose: () => void;
  onProcesses: (items: BundleProcessBinding[]) => void;
  onDomains: (domains: string[]) => void;
};

const buttonBase =
  "px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 text-xs transition cursor-pointer";

function Tooltip({
  content,
  children,
  position = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={`absolute z-50 pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95 ${
            position === "top"
              ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
              : position === "bottom"
              ? "top-full mt-2 left-1/2 -translate-x-1/2"
              : position === "left"
              ? "right-full mr-2 top-1/2 -translate-y-1/2"
              : "left-full ml-2 top-1/2 -translate-y-1/2"
          }`}
          style={{ width: "max-content", maxWidth: "340px" }}
        >
          <div className="rounded-xl bg-slate-900/95 dark:bg-slate-800/95 text-slate-100 p-2.5 text-[11px] shadow-2xl border border-slate-700/80 leading-relaxed text-left backdrop-blur-xs">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProcessDiscoveryDialog(props: Props) {
  const model = useProcessDiscovery(props.input);
  return <DiscoveryDialog {...props} model={model} />;
}

function DiscoveryDialog({
  mode,
  input,
  onClose,
  onProcesses,
  onDomains,
  model,
}: Props & { model: ReturnType<typeof useProcessDiscovery> }) {
  const { state, actions } = model;
  const [query, setQuery] = useState("");
  const [hideSystem, setHideSystem] = useState(true);
  const [descendants, setDescendants] = useState(true);
  const [selectedCardIds, setSelectedCardIds] = useState(new Set<string>());
  const [expandedCardIds, setExpandedCardIds] = useState(new Set<string>());
  const [customCards, setCustomCards] = useState<ProcessAppCard[]>([]);

  // Domain selection (legacy preserved for domain mode)
  const [selectedDomains, setSelectedDomains] = useState(new Set<string>());

  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
        ) ?? []),
      ].filter((n) => n.getClientRects().length);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Aggregate process entries into cards
  const aggregatedCards = useMemo(() => {
    return aggregateProcessCards(state.entries, input.platform, query, hideSystem);
  }, [state.entries, input.platform, query, hideSystem]);

  // Merge with custom-added cards (e.g. from local file browser)
  const allCards = useMemo(() => {
    if (!customCards.length) return aggregatedCards;
    const existingIds = new Set(aggregatedCards.map((c) => c.id));
    const uniqueCustom = customCards.filter((c) => !existingIds.has(c.id));
    return [...uniqueCustom, ...aggregatedCards];
  }, [customCards, aggregatedCards]);

  // Pre-expand cards if a search query is active
  useEffect(() => {
    if (query.trim()) {
      setExpandedCardIds(new Set(allCards.map((c) => c.id)));
    }
  }, [query, allCards]);

  const toggleCard = (id: string) => {
    setSelectedCardIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedCardIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedCardIds(new Set(allCards.map((c) => c.id)));
  };

  const collapseAll = () => {
    setExpandedCardIds(new Set());
  };

  const handleBrowseLocalExe = async () => {
    try {
      const chosen = await routingApi.browse();
      if (!chosen) return;
      const name = executableName(chosen);
      const key = processKey(chosen, input.platform);
      const lower = name.toLowerCase();
      const known = KNOWN_APP_NAMES[lower];

      const newCard: ProcessAppCard = {
        id: key,
        name,
        friendlyName: known?.label,
        icon: known?.icon || "🖥️",
        executablePath: chosen,
        instances: [],
        children: [],
        isSystem: false,
        mainPid: 0,
      };

      setCustomCards((prev) => [newCard, ...prev.filter((c) => c.id !== key)]);
      setSelectedCardIds((prev) => new Set([...prev, key]));
    } catch (e) {
      console.error("浏览本地程序失败:", e);
    }
  };

  // Convert selected cards to BundleProcessBinding[]
  const chosenProcesses = useMemo(() => {
    const result: BundleProcessBinding[] = [];
    for (const card of allCards) {
      if (selectedCardIds.has(card.id) && card.executablePath) {
        result.push({
          exe: card.name,
          executablePath: card.executablePath,
          includeDescendants: descendants,
        });
      }
    }
    return result;
  }, [allCards, selectedCardIds, descendants]);

  // Calculate total instances and children covered by the selection
  const totalCoveredInstances = useMemo(() => {
    let count = 0;
    for (const card of allCards) {
      if (selectedCardIds.has(card.id)) {
        count += Math.max(1, card.instances.length);
        if (descendants) {
          count += card.children.length;
        }
      }
    }
    return count;
  }, [allCards, selectedCardIds, descendants]);

  // Preserved for domain detection mode
  const domains = useMemo(() => {
    return state.domains
      .filter((d) => `${d.domain} ${d.processes.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }, [state.domains, query]);

  const chosenDomains = [...selectedDomains];
  const toggleDomain = (id: string) => {
    setSelectedDomains((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const takeoverTooltip = (
    <div className="space-y-1.5 p-0.5">
      <div className="flex items-center gap-1.5 font-bold text-white text-xs border-b border-slate-700/80 pb-1">
        <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
        <span>进程树智能接管承诺</span>
      </div>
      <div className="space-y-1 text-slate-300 text-[11px]">
        <p className="flex items-start gap-1">
          <span className="text-amber-400 shrink-0 font-bold">⚡</span>
          <span>
            <strong className="text-white">即开即管：</strong>
            游戏更新器、VS Code 唤起的 git/curl、临时 worker 等短命子进程，启动瞬间底层驱动自动拦截分流。
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-emerald-400 shrink-0 font-bold">⏳</span>
          <span>
            <strong className="text-white">未来自适应：</strong>
            后续新派生的子进程，唤起时自动继承分流规则，无需再次打开本窗口抓取。
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-blue-400 shrink-0 font-bold">🎯</span>
          <span>
            <strong className="text-white">精准隔离：</strong>
            仅接管由此软件亲手拉起的后代，不影响系统其他应用运行的同名程序。
          </span>
        </p>
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 text-xs overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h3 id={title} className="text-sm font-bold flex items-center gap-2">
              <span>{mode === "processes" ? "从运行进程选择" : "检测已连接域名"}</span>
              {mode === "processes" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                  卡片聚合模式
                </span>
              )}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 mt-0.5 text-[11px]">
              当前模式：{state.mode} · 纯应用层、TUN、WinDivert 共用此选择器
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭选择窗口"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-3 overflow-y-auto min-h-0 flex-1">
          {mode === "processes" ? (
            <>
              {/* Informative Banner with Tooltip */}
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-xl text-[11px] text-indigo-800 dark:text-indigo-300">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck size={15} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
                  <span className="truncate">
                    智能按主程序聚合展示。勾选主程序并开启“包含子进程”，将由底层驱动自动接管派生的所有短命子进程与临时任务。
                  </span>
                </div>
                <Tooltip content={takeoverTooltip} position="left">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 underline font-medium cursor-pointer shrink-0 ml-2"
                  >
                    <span>接管承诺</span>
                    <HelpCircle size={13} />
                  </button>
                </Tooltip>
              </div>

              {/* Action Toolbar Row 1 */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative min-w-0 flex-1 basis-64">
                  <input
                    type="search"
                    aria-label="搜索进程名、应用名称、PID 或路径"
                    placeholder="搜索应用名、可执行文件 (.exe)、PID 或路径..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-8 py-2 bg-slate-50 dark:bg-slate-950 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-xs"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className={buttonBase}
                  onClick={handleBrowseLocalExe}
                  title="未在运行或瞬态程序可直接从本地硬盘选择 .exe 添加"
                >
                  <FolderOpen size={13} className="inline mr-1 text-indigo-500" />
                  浏览本地程序 (.exe)
                </button>

                <button
                  type="button"
                  className={buttonBase}
                  disabled={state.loading}
                  onClick={() => void actions.refresh()}
                  title="重新扫描系统运行中进程"
                >
                  <RefreshCw
                    size={13}
                    className={`inline mr-1 ${state.loading ? "animate-spin text-indigo-500" : ""}`}
                  />
                  刷新进程
                </button>
              </div>

              {/* Action Toolbar Row 2: Filters and Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs py-1 px-1 text-slate-600 dark:text-slate-400 select-none">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200 transition">
                    <input
                      type="checkbox"
                      checked={hideSystem}
                      onChange={(e) => setHideSystem(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>隐藏 Windows 系统后台服务 (svchost/conhost等)</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200 transition">
                    <input
                      type="checkbox"
                      checked={descendants}
                      onChange={(e) => setDescendants(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>包含子进程 (也跟踪后续新启动的子进程)</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={expandAll}
                    className="text-[11px] text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                  >
                    展开全部
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <button
                    type="button"
                    onClick={collapseAll}
                    className="text-[11px] text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                  >
                    收起全部
                  </button>
                </div>
              </div>

              {state.error && (
                <p role="alert" className="text-amber-700 dark:text-amber-300 break-words">
                  {state.error}
                </p>
              )}

              {/* Cards List Area */}
              {state.loading ? (
                <div className="py-20 text-center text-slate-400 space-y-2">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-500" />
                  <p>正在读取 Windows 进程快照与主程序树...</p>
                </div>
              ) : !allCards.length ? (
                <div className="py-16 text-center text-slate-400 space-y-1">
                  <Laptop className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-1" />
                  <p className="font-medium text-slate-600 dark:text-slate-300">未找到匹配的运行中主程序</p>
                  <p className="text-[11px]">
                    可尝试清除搜索关键词、取消勾选“隐藏 Windows 后台服务”，或点击上方“浏览本地程序”直接选取 .exe 文件。
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {allCards.map((card) => {
                    const isSelected = selectedCardIds.has(card.id);
                    const isExpanded = expandedCardIds.has(card.id);
                    const hasSubItems = card.instances.length > 1 || card.children.length > 0;

                    return (
                      <div
                        key={card.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? "bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-800/80 shadow-2xs"
                            : "bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800/90 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        {/* Card Header Row */}
                        <div className="p-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!card.executablePath}
                              onChange={() => toggleCard(card.id)}
                              className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0 w-4 h-4"
                              aria-label={`选择 ${card.friendlyName || card.name}`}
                            />

                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center text-base shrink-0 select-none">
                              {card.icon}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900 dark:text-white truncate">
                                  {card.friendlyName || card.name}
                                </span>
                                {card.friendlyName && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono shrink-0">
                                    {card.name}
                                  </span>
                                )}

                                {card.instances.length > 1 && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                                    {card.instances.length} 个实例
                                  </span>
                                )}

                                {card.children.length > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border border-purple-200/60 dark:border-purple-800/60 font-medium">
                                    派生 {card.children.length} 个子进程
                                  </span>
                                )}

                                {isSelected && descendants && (
                                  <Tooltip content={takeoverTooltip} position="top">
                                    <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-indigo-100/80 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-help">
                                      <ShieldCheck size={11} className="text-indigo-600 dark:text-indigo-400" />
                                      动态接管后代
                                    </span>
                                  </Tooltip>
                                )}
                              </div>

                              <p
                                className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5 font-mono"
                                title={card.executablePath || "系统进程，无法读取有效路径"}
                              >
                                {card.executablePath || (card.mainPid ? `PID: ${card.mainPid}` : "外部自定义程序")}
                              </p>
                            </div>
                          </div>

                          {/* Expand/Collapse Trigger */}
                          {hasSubItems && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(card.id)}
                              className="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer flex items-center gap-1 text-[11px] shrink-0"
                              title={isExpanded ? "收起实例与子进程详情" : "展开查看实例与子进程详情"}
                            >
                              <span>{isExpanded ? "收起" : "展开详情"}</span>
                              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          )}
                        </div>

                        {/* Card Sub-processes Drawer */}
                        {isExpanded && hasSubItems && (
                          <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5 rounded-b-xl">
                            {/* Instances list */}
                            {card.instances.length > 1 && (
                              <div>
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                                  运行中同路径实例（共用此规则）
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {card.instances.map((inst, idx) => (
                                    <span
                                      key={inst.identity}
                                      className="text-[10px] px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-mono"
                                    >
                                      PID {inst.pid} {idx === 0 ? "· 主实例" : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Spawned children */}
                            {card.children.length > 0 && (
                              <div>
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                                  由该主程序派生的子进程树
                                </span>
                                <div className="space-y-1.5">
                                  {card.children.map((child) => (
                                    <div
                                      key={child.identity}
                                      className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-xs"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <ChevronRight size={12} className="text-slate-400 shrink-0" />
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                          {child.name}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                          PID {child.pid}
                                        </span>
                                        <span
                                          className="text-[10px] text-slate-400 truncate font-mono hidden sm:inline"
                                          title={child.executablePath || ""}
                                        >
                                          {child.executablePath}
                                        </span>
                                      </div>

                                      <Tooltip
                                        content={
                                          <div className="space-y-1 p-0.5 text-[11px]">
                                            <div className="font-bold text-white flex items-center gap-1">
                                              <Check className="w-3 h-3 text-emerald-400" />
                                              <span>已由主程序动态接管</span>
                                            </div>
                                            <p className="text-slate-300">
                                              子进程 <span className="font-mono text-indigo-300">{child.name}</span>{" "}
                                              (PID {child.pid}) 由当前主程序派生。由于开启了“包含子进程”，底层驱动会自动将其网络流量纳入主程序规则，
                                              <strong className="text-emerald-300">无需单独添加</strong>。
                                            </p>
                                          </div>
                                        }
                                        position="left"
                                      >
                                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 cursor-help shrink-0">
                                          <Check size={11} />
                                          已由主程序接管 (免勾选)
                                        </span>
                                      </Tooltip>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Short-lived ephemeral processes reminder */}
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-0.5">
                              💡 提示：该程序在运行期间临时唤起并退出的短命子进程（如 git、updater、临时 worker），启动时底层驱动自动捕获并分流，无需在此抓取。
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* Preserved Domain Detection Mode */
            <>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                开始后持续检测，关闭窗口停止采集，也可手动停止。仅汇总进入当前核心且能关联到选择范围的连接；纯应用层需先接入代理。短连接可能漏采，仅有 IP 或域名不可见时不会猜测。重新开始会清空上次候选。
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="search"
                  aria-label="搜索域名或进程"
                  placeholder="搜索域名或进程..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-w-0 flex-1 basis-48 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-950 focus:outline-indigo-500 text-xs"
                />
                <button
                  type="button"
                  className={buttonBase}
                  disabled={state.loading || !input.members.length}
                  onClick={() => {
                    if (state.running) actions.stop();
                    else {
                      setSelectedDomains(new Set());
                      actions.start();
                    }
                  }}
                >
                  {state.running ? "停止检测" : "开始检测"}
                </button>
              </div>

              {input.bundleId && (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={state.includeBundle}
                    disabled={state.running}
                    onChange={(e) => {
                      setSelectedDomains(new Set());
                      actions.includeBundle(e.target.checked);
                    }}
                  />
                  <span>也显示本业务包入口的域名（可能包含包内其他进程，单独标注）</span>
                </label>
              )}

              {state.error && (
                <p role="alert" className="text-amber-700 dark:text-amber-300 break-words">
                  {state.error}
                </p>
              )}

              {state.limited && (
                <p role="status" className="text-amber-700 dark:text-amber-300">
                  候选滚动保留最近 500 个域名，每次最多处理 10000 条匹配连接；检测仍在继续，已勾选项不会丢失。
                </p>
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <span>
                  {state.domains.length} 个域名 · 已选 {chosenDomains.length} 个
                </span>
                <button
                  type="button"
                  className={buttonBase}
                  onClick={() =>
                    setSelectedDomains(
                      new Set([...selectedDomains, ...domains.filter((d) => d.confirmed).map((d) => d.domain)])
                    )
                  }
                >
                  选择按路径关联的候选
                </button>
                <button type="button" className={buttonBase} onClick={() => setSelectedDomains(new Set())}>
                  清空选择
                </button>
              </div>

              {!domains.length ? (
                <p role="status" className="py-10 text-center text-slate-500">
                  {state.running
                    ? "尚未观察到匹配域名，请在目标应用发起新请求。"
                    : "点击开始检测；未发现域名不代表应用没有网络请求。"}
                </p>
              ) : (
                <VirtualList
                  items={domains}
                  itemKey={(d) => d.domain}
                  rowHeight={84}
                  className="h-[min(42vh,360px)] rounded-xl border border-slate-200 dark:border-slate-700"
                  label="已观察域名"
                  renderRow={(d) => (
                    <label className="flex gap-3 px-3 items-center h-full cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedDomains.has(d.domain)}
                        onChange={() => toggleDomain(d.domain)}
                        aria-label={`选择域名 ${d.domain}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono font-semibold truncate" title={d.domain}>
                          {d.domain}
                        </span>
                        <span
                          className="block truncate text-[11px] text-slate-500 dark:text-slate-400"
                          title={d.processes.join("、")}
                        >
                          {d.processes.join("、")} · {d.connections} 条连接 ·{" "}
                          {new Date(d.lastSeen).toLocaleTimeString()}
                        </span>
                        <span
                          className={`block truncate text-[11px] ${
                            d.confirmed
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-amber-700 dark:text-amber-300"
                          }`}
                          title={d.sources.join("；")}
                        >
                          {d.sources.join("；")}
                        </span>
                      </span>
                    </label>
                  )}
                />
              )}
              <p className="text-slate-500 dark:text-slate-400">
                按准确域名加入，不自动扩大为通配域名。连接数按连续采样去重，漏采后重现可能重复计数。候选滚动保留最近 500 个域名，已勾选项保留至加入或清空；关闭窗口释放记录。
              </p>
            </>
          )}
        </div>

        {/* Footer Area */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between gap-2 shrink-0">
          <div>
            {mode === "processes" ? (
              selectedCardIds.size > 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>已勾选 {selectedCardIds.size} 项</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCardIds(new Set())}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    清空已选
                  </button>
                </div>
              )
            ) : (
              chosenDomains.length > 0 && (
                <div className="text-xs text-slate-500">已选 {chosenDomains.length} 个域名</div>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className={buttonBase} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              disabled={
                mode === "processes"
                  ? !chosenProcesses.length || state.loading
                  : !chosenDomains.length
              }
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 transition cursor-pointer shadow-xs"
              onClick={() => {
                if (mode === "processes") onProcesses(chosenProcesses);
                else onDomains(chosenDomains);
                onClose();
              }}
            >
              {mode === "processes"
                ? chosenProcesses.length > 0
                  ? `加入 ${chosenProcesses.length} 个主程序 (已联动覆盖 ${totalCoveredInstances} 个实例及后续所有子进程)`
                  : "加入 0 个程序"
                : `加入 ${chosenDomains.length} 个域名`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
