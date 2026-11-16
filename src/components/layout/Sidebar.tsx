import React from "react";
import {
  LayoutDashboard,
  Radio,
  Layers,
  Route,
  Activity,
  Terminal,
  Sliders,
  FileText,
  RefreshCw,
} from "lucide-react";
import type { FormFactor } from "../../hooks/useWindowFormFactor";

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  formFactor: FormFactor;
  coreRunning: boolean;
  corePid?: number;
  profileCount?: number | null;
  bundleCount?: number;
  connectionCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  formFactor,
  coreRunning,
  corePid,
  profileCount,
  bundleCount = 2,
  connectionCount,
}) => {
  const isCompact = formFactor === "compact";

  const coreNavItems = [
    {
      id: "dashboard",
      label: "运行概览",
      icon: LayoutDashboard,
      badge: coreRunning ? "就绪" : "待命",
      badgeColor: coreRunning
        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
        : "bg-slate-200 dark:bg-white/[0.08] text-slate-500 dark:text-slate-400",
    },
    {
      id: "proxies",
      label: "节点大盘",
      icon: Radio,
      badge: undefined,
    },
    {
      id: "routing",
      label: "业务分流包",
      icon: Layers,
      badge: bundleCount ? `${bundleCount}包` : undefined,
      badgeColor: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    },
    {
      id: "rules",
      label: "核心路由规则",
      icon: Route,
      badge: "沙盒",
      badgeColor: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    },
    {
      id: "connections",
      label: "连接追踪",
      icon: Activity,
      badge: connectionCount !== undefined && connectionCount > 0 ? String(connectionCount) : undefined,
      badgeColor: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    },
  ];

  const opsNavItems = [
    {
      id: "logs",
      label: "实时日志",
      icon: Terminal,
      badge: undefined,
    },
    {
      id: "profiles",
      label: "订阅配置",
      icon: FileText,
      badge: profileCount !== null && profileCount !== undefined ? `${profileCount}源` : undefined,
      badgeColor: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    },
    {
      id: "settings",
      label: "内核设置",
      icon: Sliders,
      badge: undefined,
    },
    {
      id: "maintenance",
      label: "版本维护",
      icon: RefreshCw,
      badge: "组件",
      badgeColor: "bg-slate-200 dark:bg-white/[0.1] text-slate-600 dark:text-slate-300",
    },
  ];

  return (
    <nav
      id="left-sidebar"
      className={`${
        isCompact ? "compact" : "w-[180px]"
      } border-r hairline-divider flex flex-col justify-between p-3 shrink-0 transition-all duration-300 bg-white/50 dark:bg-slate-900/40 select-none`}
    >
      <div className="space-y-1">
        {/* 核心控制分类 */}
        <div
          id="nav-category-title"
          className="nav-category-title text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2.5 py-1 font-semibold"
        >
          核心控制
        </div>

        {coreNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={item.label}
              className={`nav-item w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition cursor-pointer group ${
                isActive
                  ? "active bg-slate-900 text-white dark:bg-white/[0.08] dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white ghost-hover"
              }`}
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition ${
                    isActive
                      ? "text-sky-400"
                      : "text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"
                  }`}
                />
                <span className="nav-label truncate">{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`nav-badge text-[9px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                    item.badgeColor || "bg-slate-100 dark:bg-white/[0.08] text-slate-500"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* 运维配置分类 */}
        <div
          id="nav-category-sub"
          className="nav-category-sub text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2.5 py-1 pt-3 font-semibold"
        >
          运维配置
        </div>

        {opsNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={item.label}
              className={`nav-item w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition cursor-pointer group ${
                isActive
                  ? "active bg-slate-900 text-white dark:bg-white/[0.08] dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white ghost-hover"
              }`}
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition ${
                    isActive
                      ? "text-sky-400"
                      : "text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"
                  }`}
                />
                <span className="nav-label truncate">{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`nav-badge text-[9px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                    item.badgeColor || "bg-slate-100 dark:bg-white/[0.08] text-slate-500"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 侧边栏底部信息底盘 */}
      <div
        id="sidebar-footer"
        className="p-2.5 rounded-xl text-[10px] font-mono text-slate-500 dark:text-slate-400 space-y-1 border hairline-divider bg-slate-100/50 dark:bg-white/[0.02]"
      >
        <div className="flex items-center justify-between">
          <span>PID: {corePid || "--"}</span>
          <span
            className={`font-bold ${
              coreRunning
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {coreRunning ? "Normal" : "Stopped"}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
          <span>MEM: {coreRunning ? "32.4 MB" : "--"}</span>
          <span>TUN: {coreRunning ? "Active" : "Idle"}</span>
        </div>
      </div>
    </nav>
  );
};
