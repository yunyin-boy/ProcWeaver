import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Activity, ClipboardList, Eraser, Globe, LayoutDashboard, LucideIcon, Moon,
  Radio, RotateCw, ScrollText, Search, Settings, Shield, Sun, Workflow,
} from "lucide-react";
import { KbdBadge } from "../primitives/Badge";
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
  icon: LucideIcon;
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
        title: "前往核心概览",
        subtitle: "查看 60s 吞吐流、落地 IP 与内存监控",
        category: "视图导航",
        icon: LayoutDashboard,
        action: () => {
          onNavigateTab("overview");
          onClose();
        },
      },
      {
        id: "nav-proxies",
        title: "前往出口节点",
        subtitle: "浏览所有策略组与批量测速",
        category: "视图导航",
        icon: Globe,
        action: () => {
          onNavigateTab("proxies");
          onClose();
        },
      },
      {
        id: "nav-process",
        title: "前往进程分流",
        subtitle: "应用强锁、自选进程代理与活跃进程接管",
        category: "视图导航",
        icon: Workflow,
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
        icon: Radio,
        action: () => {
          onNavigateTab("profiles");
          onClose();
        },
      },
      {
        id: "nav-routing",
        title: "前往规则编织",
        subtitle: "分流规则链、外部规则集与路由诊断仪",
        category: "视图导航",
        icon: ClipboardList,
        action: () => {
          onNavigateTab("routing");
          onClose();
        },
      },
      {
        id: "nav-connections",
        title: "前往链接追踪",
        subtitle: "实时连接流水、传输速率与单项强制断开",
        category: "视图导航",
        icon: Activity,
        action: () => {
          onNavigateTab("connections");
          onClose();
        },
      },
      {
        id: "nav-logs",
        title: "前往实时日志",
        subtitle: "事件流抓取、等级过滤与诊断导出",
        category: "视图导航",
        icon: ScrollText,
        action: () => {
          onNavigateTab("logs");
          onClose();
        },
      },
      {
        id: "nav-settings",
        title: "前往系统首选项",
        subtitle: "混合端口、TUN 网卡与过滤策略",
        category: "视图导航",
        icon: Settings,
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
        icon: Eraser,
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
        icon: RotateCw,
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
        icon: Shield,
        action: async () => {
          onClose();
          const active = await toggleSystemProxy();
          onShowNotice(active ? "系统代理已启用" : "系统代理已关闭");
        },
      },
      {
        id: "action-toggle-theme",
        title: `切换界面明暗模式 (当前: ${currentTheme})`,
        subtitle: "在浅色、深色和跟随系统之间切换",
        category: "系统偏好",
        icon: currentTheme === "dark" ? Sun : Moon,
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
      icon: Globe,
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
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center px-3 pt-[10vh]">
      <div onClick={onClose} className="workbench-dialog-backdrop fixed inset-0" aria-hidden="true" />

      <div
        onKeyDown={handleKeyDown}
        className="workbench-dialog relative z-10 flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden p-2.5"
        role="dialog"
        aria-label="命令中心"
        aria-modal="true"
      >
        <div className="workbench-field flex items-center gap-2 px-3 py-1.5">
          <Search size={17} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            aria-label="搜索节点、页面或运维操作"
            placeholder="搜索节点、页面或运维操作"
            className="min-h-8 min-w-0 flex-1 rounded bg-transparent text-sm"
          />
          <KbdBadge keys={["Esc"]} className="shrink-0 !bg-[var(--workbench-surface)]" />
        </div>

        <div ref={listRef} className="mt-2 grid gap-0.5 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="p-7 text-center text-xs text-[var(--text-muted)]">未匹配到动作或节点</div>
          ) : filteredCommands.map((item, index) => {
            const Icon = item.icon;
            const selected = index === selectedIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => item.action()}
                onFocus={() => setSelectedIndex(index)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={"flex w-full min-w-0 items-center justify-between gap-2 rounded-lg p-2.5 text-left text-[13px] " + (
                  selected ? "bg-[var(--workbench-selected)] text-[var(--workbench-accent)]" : "hover:bg-[var(--workbench-control)]"
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon size={16} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.title}</span>
                    {item.subtitle && <span className="block truncate text-[11px] text-[var(--text-muted)]">{item.subtitle}</span>}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)] sm:flex">
                  {item.badge && <span className="workbench-tag">{item.badge}</span>}
                  {item.category}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 pb-0.5 text-[11px] text-[var(--text-muted)]">
          <span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
};
