// ==========================================================================
// ProcWeaver src-next Raycast / Linear 风格纯键盘命令浮层 (Command Palette)
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy / taste-skill
// 快捷键: Ctrl + K (唤起 / 隐藏)
// ==========================================================================

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { fetchProxiesData, switchGroupProxy } from "../services/proxyService";
import { flushDns, reloadCoreConfig } from "../services/dnsService";
import { toggleSystemProxy } from "../services/systemProxyService";
import { parseNodeMeta } from "../utils/nodeParser";
import { ParsedNodeMeta } from "../types/proxy";

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: "节点切换" | "快捷运维" | "视图导航" | "系统偏好";
  icon: string;
  badge?: string;
  action: () => void | Promise<void>;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: string) => void;
  onShowNotice: (msg: string) => void;
  currentTheme: "light" | "dark" | "system";
  onToggleTheme: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  onShowNotice,
  currentTheme,
  onToggleTheme,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [nodeItems, setNodeItems] = useState<{ name: string; groupName: string; meta: ParsedNodeMeta }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 1. 打开时自动聚焦输入框并拉取最新节点列表
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      fetchProxiesData().then((snap) => {
        const list: { name: string; groupName: string; meta: ParsedNodeMeta }[] = [];
        // 提取主要策略组中的所有节点
        for (const group of snap.groups) {
          for (const nodeName of group.all) {
            // 避免完全重复
            if (!list.some((i) => i.name === nodeName && i.groupName === group.name)) {
              list.push({
                name: nodeName,
                groupName: group.name,
                meta: parseNodeMeta(snap.proxies[nodeName] || { name: nodeName, type: "Unknown" }),
              });
            }
          }
        }
        setNodeItems(list);
      });
    }
  }, [isOpen]);

  // 2. 静态内置核心动作命令
  const actionCommands = useMemo<CommandItem[]>(() => {
    return [
      {
        id: "nav-overview",
        title: "前往运行概览驾驶舱",
        subtitle: "查看 60s 吞吐流、落地 IP 与内存监控",
        category: "视图导航",
        icon: "🧭",
        action: () => {
          onNavigateTab("overview");
          onClose();
        },
      },
      {
        id: "nav-proxies",
        title: "前往出口节点大盘",
        subtitle: "浏览所有策略组与批量测速",
        category: "视图导航",
        icon: "⚡",
        action: () => {
          onNavigateTab("proxies");
          onClose();
        },
      },
      {
        id: "nav-process",
        title: "前往进程分流大盘",
        subtitle: "应用强锁、自选进程代理与活跃进程接管",
        category: "视图导航",
        icon: "🔀",
        action: () => {
          onNavigateTab("process");
          onClose();
        },
      },
      {
        id: "nav-profiles",
        title: "前往订阅源管理",
        subtitle: "云端机场订阅拉取、流量配额查看与方案切换",
        category: "视图导航",
        icon: "📡",
        action: () => {
          onNavigateTab("profiles");
          onClose();
        },
      },
      {
        id: "nav-routing",
        title: "前往业务规则编织系统",
        subtitle: "分流规则链、外部规则集与路由诊断仪",
        category: "视图导航",
        icon: "🧬",
        action: () => {
          onNavigateTab("routing");
          onClose();
        },
      },
      {
        id: "nav-connections",
        title: "前往活动连接追踪",
        subtitle: "实时连接流水、传输速率与单项强制断开",
        category: "视图导航",
        icon: "🔗",
        action: () => {
          onNavigateTab("connections");
          onClose();
        },
      },
      {
        id: "nav-logs",
        title: "前往实时内核运行日志",
        subtitle: "事件流抓取、等级过滤与诊断导出",
        category: "视图导航",
        icon: "📜",
        action: () => {
          onNavigateTab("logs");
          onClose();
        },
      },
      {
        id: "nav-settings",
        title: "前往系统高级偏好设置",
        subtitle: "混合端口、TUN 网卡与过滤策略",
        category: "视图导航",
        icon: "⚙️",
        action: () => {
          onNavigateTab("settings");
          onClose();
        },
      },
      {
        id: "action-flush-dns",
        title: "一键刷新 DNS 缓存与 Fake-IP",
        subtitle: "清空系统与内核 DNS 映射记录",
        category: "快捷运维",
        icon: "🧹",
        action: async () => {
          onClose();
          await flushDns();
          onShowNotice("DNS 缓存与 Fake-IP 映射已清空");
        },
      },
      {
        id: "action-reload-core",
        title: "平滑重载分流规则与内核配置",
        subtitle: "无缝应用最新规则包与端口",
        category: "快捷运维",
        icon: "🔄",
        action: async () => {
          onClose();
          await reloadCoreConfig();
          onShowNotice("内核分流配置已平滑重载");
        },
      },
      {
        id: "action-toggle-sysproxy",
        title: "切换系统代理全局接管状态",
        subtitle: "一键启用或回滚 Windows 系统代理",
        category: "快捷运维",
        icon: "🛡️",
        action: async () => {
          onClose();
          const active = await toggleSystemProxy();
          onShowNotice(active ? "系统代理已启用" : "系统代理已关闭");
        },
      },
      {
        id: "action-toggle-theme",
        title: `切换界面明暗模式 (当前: ${currentTheme})`,
        subtitle: "无级流转于暗色星空与透光白瓷风格",
        category: "系统偏好",
        icon: currentTheme === "dark" ? "🌙" : "☀️",
        action: () => {
          onToggleTheme();
          onClose();
        },
      },
    ];
  }, [onNavigateTab, onClose, onShowNotice, currentTheme, onToggleTheme]);

  // 3. 将节点动态映射为命令
  const dynamicNodeCommands = useMemo<CommandItem[]>(() => {
    return nodeItems.map((item) => ({
      id: `node-${item.groupName}-${item.name}`,
      title: item.meta.cleanName,
      subtitle: `组: ${item.groupName} | ${item.meta.regionName} | 倍率 ${item.meta.multiplier}x`,
      category: "节点切换",
      icon: "🌐",
      badge: item.meta.protocolBadge,
      action: async () => {
        onClose();
        await switchGroupProxy(item.groupName, item.name);
        onShowNotice(`[${item.groupName}] 已切换至: ${item.meta.cleanName}`);
      },
    }));
  }, [nodeItems, onClose, onShowNotice]);

  // 4. 全量过滤列表
  const filteredCommands = useMemo(() => {
    const all = [...actionCommands, ...dynamicNodeCommands];
    if (!query.trim()) return all.slice(0, 40); // 默认展示前 40 条

    const q = query.toLowerCase().trim();
    return all
      .filter((cmd) => {
        return (
          cmd.title.toLowerCase().includes(q) ||
          (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q)) ||
          cmd.category.includes(q) ||
          (cmd.badge && cmd.badge.toLowerCase().includes(q))
        );
      })
      .slice(0, 50);
  }, [actionCommands, dynamicNodeCommands, query]);

  // 5. 键盘导航逻辑
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filteredCommands.length ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredCommands.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const active = filteredCommands[selectedIndex];
        if (active) {
          active.action();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filteredCommands, selectedIndex, onClose]
  );

  // 保持高亮行在可视区域内
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center pt-[12vh] px-4 select-none">
      {/* 遮罩背景 (毛玻璃高斯模糊) */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-md transition-opacity animate-in fade-in duration-150"
      />

      {/* 浮动命令面板本体 */}
      <div
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f172a] backdrop-blur-2xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[70vh] transition-all"
      >
        {/* 顶部微高光内发丝 */}
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        {/* 顶部搜索框 */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--glass-border-subtle)]">
          <span className="text-zinc-400 text-sm">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="搜索节点、策略组或系统运维动作 (按 Esc 关闭)..."
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
          />
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[var(--text-muted)] border border-[var(--glass-border-subtle)]">
            ESC
          </span>
        </div>

        {/* 候选列表区 */}
        <div ref={listRef} className="overflow-y-auto p-2 space-y-1 divide-y divide-transparent">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              未匹配到任何动作或节点
            </div>
          ) : (
            filteredCommands.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-xs transition-all ${
                    isSelected
                      ? "bg-blue-500/15 border border-blue-500/30 text-blue-500 dark:text-blue-300 shadow-sm"
                      : "text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
                  }`}
                >
                  {/* 左侧：图标 + 标题 + 副标题 */}
                  <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                    <span className="text-sm shrink-0">{item.icon}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      {item.subtitle && (
                        <div className="text-[10px] text-[var(--text-muted)] truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 右侧：分类标签或徽章 */}
                  <div className="flex items-center gap-2 shrink-0">
                    {item.badge && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-black/10 dark:bg-white/10 text-[var(--text-secondary)] border border-[var(--glass-border-subtle)]">
                        {item.badge}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {item.category}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] font-mono text-blue-500 font-bold ml-1">
                        ↵
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部导航提示条 */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--glass-border-subtle)] bg-black/5 dark:bg-white/5 text-[10px] font-mono text-[var(--text-muted)]">
          <div className="flex items-center gap-3">
            <span>↑↓ 导航选择</span>
            <span>↵ 回车执行</span>
            <span>ESC 关闭</span>
          </div>
          <span>ProcWeaver Command Hub</span>
        </div>
      </div>
    </div>
  );
};
