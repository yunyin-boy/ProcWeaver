// ==========================================================================
// ProcWeaver src-next 独立托盘右键极简悬浮菜单
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// 特性: 500x380 动态自适应飞出画布 / 120fps 毛玻璃景深 / 绝无 Emoji
// ==========================================================================

import React, { useEffect, useState, useRef } from "react";
import { invokeCommand, isTauriEnvironment } from "../../services/client";

interface TrayNodeItem {
  name: string;
  delay?: number | null;
  active: boolean;
}

interface TrayRegionGroup {
  region: string;
  nodes: TrayNodeItem[];
}

export interface TrayMenuPayload {
  running: boolean;
  mode: string;
  sysProxyEnabled: boolean;
  sysProxyState?: string;
  tunEnabled?: boolean;
  autoRun: boolean;
  processEnabled: boolean;
  activeNode?: string | null;
  activeNodeDelay?: number | null;
  downSpeed?: number;
  upSpeed?: number;
  groups: TrayRegionGroup[];
  direction?: string;
}

function normalizeTrayPayload(raw: any): TrayMenuPayload {
  if (!raw || typeof raw !== "object") {
    return {
      running: false,
      mode: "rule",
      sysProxyEnabled: false,
      autoRun: false,
      processEnabled: true,
      groups: [],
      direction: "left",
    };
  }
  return {
    running: Boolean(raw.running),
    mode: raw.mode || "rule",
    sysProxyEnabled: Boolean(raw.sysProxyEnabled ?? raw.sys_proxy_enabled),
    sysProxyState: raw.sysProxyState ?? raw.sys_proxy_state ?? "unknown",
    tunEnabled: Boolean(raw.tunEnabled ?? raw.tun_enabled),
    autoRun: Boolean(raw.autoRun ?? raw.auto_run),
    processEnabled: Boolean(raw.processEnabled ?? raw.process_enabled ?? true),
    activeNode: raw.activeNode ?? raw.active_node ?? null,
    activeNodeDelay: raw.activeNodeDelay ?? raw.active_node_delay ?? null,
    downSpeed: typeof raw.downSpeed === "number" ? raw.downSpeed : (typeof raw.down_speed === "number" ? raw.down_speed : 0),
    upSpeed: typeof raw.upSpeed === "number" ? raw.upSpeed : (typeof raw.up_speed === "number" ? raw.up_speed : 0),
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    direction: raw.direction === "right" ? "right" : "left",
  };
}

function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return "0 B/s";
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

type SubmenuType = "none" | "nodes" | "mode" | "tools";

export const TrayContextMenuView: React.FC = () => {
  const [payload, setPayload] = useState<TrayMenuPayload>({
    running: false,
    mode: "rule",
    sysProxyEnabled: false,
    autoRun: false,
    processEnabled: true,
    groups: [],
    direction: "left",
  });
  const [direction, setDirection] = useState<"left" | "right">("left");
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuType>("none");
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.className = "antialiased select-none overflow-hidden bg-transparent m-0 p-0 font-sans";

    // 初始与每次聚焦时向 Rust 穿透拉取真实状态
    const fetchLatestPayload = async () => {
      try {
        const raw = await invokeCommand<any>("get_tray_payload");
        if (raw) {
          const data = normalizeTrayPayload(raw);
          setPayload(data);
          if (data.direction === "right" || data.direction === "left") {
            setDirection(data.direction);
          }
        }
      } catch {}
    };

    fetchLatestPayload();
    window.addEventListener("focus", fetchLatestPayload);

    let unlistenUpdated: (() => void) | undefined;
    let unlistenTraffic: (() => void) | undefined;
    let unlistenDir: (() => void) | undefined;

    if (isTauriEnvironment()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<any>("tray-payload-updated", (e) => {
          const data = normalizeTrayPayload(e.payload);
          setPayload(data);
          if (data.direction === "right" || data.direction === "left") {
            setDirection(data.direction);
          }
        }).then((un) => {
          unlistenUpdated = un;
        });

        listen<{ downSpeed: number; upSpeed: number }>("tray-traffic-updated", (e) => {
          setPayload((prev) => ({
            ...prev,
            downSpeed: e.payload.downSpeed,
            upSpeed: e.payload.upSpeed,
          }));
        }).then((un) => {
          unlistenTraffic = un;
        });

        listen<string>("tray-direction-changed", (e) => {
          if (e.payload === "right" || e.payload === "left") {
            setDirection(e.payload);
          }
        }).then((un) => {
          unlistenDir = un;
        });
      }).catch(() => {});
    }

    // 窗口失焦或 Escape 瞬退
    const handleBlur = () => {
      setActiveSubmenu("none");
      invokeCommand("hide_tray_menu").catch(() => {});
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveSubmenu("none");
        invokeCommand("hide_tray_menu").catch(() => {});
      }
    };
    window.addEventListener("blur", handleBlur);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (unlistenUpdated) unlistenUpdated();
      if (unlistenTraffic) unlistenTraffic();
      if (unlistenDir) unlistenDir();
      window.removeEventListener("focus", fetchLatestPayload);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // 鼠标感应 Hover Intent (60ms 防误触)
  const handleTriggerEnter = (type: SubmenuType) => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = setTimeout(() => {
      setActiveSubmenu(type);
    }, 60);
  };

  // 鼠标离开触发项 (180ms 跨缝隙保护期)
  const handleTriggerLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    leaveTimerRef.current = setTimeout(() => {
      setActiveSubmenu("none");
    }, 180);
  };

  const handleSubmenuEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const handleSubmenuLeave = () => {
    leaveTimerRef.current = setTimeout(() => {
      setActiveSubmenu("none");
    }, 180);
  };

  const handleAction = async (id: string) => {
    try {
      await invokeCommand("execute_tray_menu_action", { id });
    } finally {
      setActiveSubmenu("none");
      await invokeCommand("hide_tray_menu");
    }
  };

  const modeZh =
    payload.mode === "global"
      ? "全局代理"
      : payload.mode === "direct"
      ? "直接连接"
      : "规则分流";

  return (
    <div className="w-[500px] h-[380px] bg-transparent overflow-visible relative flex items-end select-none text-xs font-sans p-2">
      {/* 动态画布布局容器 */}
      <div
        className={`w-full flex items-end ${
          direction === "left"
            ? "justify-end space-x-2"
            : "justify-start flex-row-reverse space-x-2 space-x-reverse"
        }`}
      >
        {/* ===================== 二级飞出感应子菜单 ===================== */}
        {activeSubmenu !== "none" && (
          <div
            onMouseEnter={handleSubmenuEnter}
            onMouseLeave={handleSubmenuLeave}
            className="w-[236px] max-h-[360px] glass-hud-window border border-[var(--glass-border)] rounded-2xl p-2 shadow-2xl text-[var(--text-primary)] flex flex-col animate-in fade-in zoom-in-95 duration-100 overflow-hidden"
          >
            {/* 子菜单 1：节点线路秒切 */}
            {activeSubmenu === "nodes" && (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] border-b border-[var(--glass-border-subtle)] mb-1 flex items-center justify-between">
                  <span>节点线路选择</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    {payload.groups.reduce((acc, g) => acc + g.nodes.length, 0)} 节点
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar text-[11px]">
                  {/* 一键全局最快 */}
                  <button
                    type="button"
                    onClick={() => handleAction("select_fastest_node")}
                    className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-500 hover:bg-blue-500/25 transition text-left cursor-pointer font-medium"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>全局测速优选 (最低延迟)</span>
                  </button>

                  {/* 地区分组 */}
                  {payload.groups.map((group) => {
                    const isExpanded = expandedRegion === group.region;
                    return (
                      <div key={group.region} className="border border-[var(--glass-border-subtle)] rounded-xl overflow-hidden bg-[var(--glass-bg-subtle)]">
                        <button
                          type="button"
                          onClick={() => setExpandedRegion(isExpanded ? null : group.region)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[var(--glass-bg-hover)] transition text-left text-[11px]"
                        >
                          <span className="font-medium text-[var(--text-primary)] truncate">
                            {group.region}
                          </span>
                          <div className="flex items-center space-x-1 shrink-0 text-[10px] text-[var(--text-muted)]">
                            <span className="font-mono">{group.nodes.length}</span>
                            <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-1 space-y-0.5 bg-[var(--glass-bg)] border-t border-[var(--glass-border-subtle)]">
                            {/* 该地区专属快速优选 */}
                            <button
                              type="button"
                              onClick={() => handleAction(`select_fastest_region:${group.region}`)}
                              className="w-full flex items-center space-x-1.5 px-2 py-1 rounded-lg text-blue-500 hover:bg-blue-500/10 text-[10px] font-medium"
                            >
                              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              <span>优选此地区最优节点</span>
                            </button>

                            {group.nodes.map((node) => {
                              const isActive = node.active || (Boolean(payload.activeNode) && node.name === payload.activeNode);
                              return (
                                <button
                                  key={node.name}
                                  type="button"
                                  onClick={() => handleAction(`select_node:${node.name}`)}
                                  className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-left transition text-[10px] ${
                                    isActive
                                      ? "bg-blue-500/20 text-blue-500 font-semibold"
                                      : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]"
                                  }`}
                                >
                                  <span className="truncate pr-1">{node.name}</span>
                                  {node.delay && node.delay > 0 ? (
                                    <span className={`font-mono text-[9px] shrink-0 ${node.delay < 100 ? "text-emerald-500" : node.delay < 250 ? "text-amber-500" : "text-rose-500"}`}>
                                      {node.delay}ms
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 子菜单 2：运行模式 */}
            {activeSubmenu === "mode" && (
              <div className="space-y-1">
                <div className="px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] border-b border-[var(--glass-border-subtle)] mb-1">
                  分流运行模式
                </div>
                {[
                  { id: "set_mode:rule", label: "规则分流 (Rule)", desc: "按设定的国内外规则智能分流", mode: "rule" },
                  { id: "set_mode:global", label: "全局代理 (Global)", desc: "全部流量通过所选出口节点", mode: "global" },
                  { id: "set_mode:direct", label: "直接连接 (Direct)", desc: "不经过任何代理，直连访问", mode: "direct" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleAction(item.id)}
                    className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition ${
                      payload.mode === item.mode
                        ? "bg-blue-500/15 border border-blue-500/30 text-blue-500"
                        : "hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] border border-transparent"
                    }`}
                  >
                    <div>
                      <div className="text-[11px] font-medium">{item.label}</div>
                      <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{item.desc}</div>
                    </div>
                    {payload.mode === item.mode && (
                      <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* 子菜单 3：急救与实用工具 */}
            {activeSubmenu === "tools" && (
              <div className="space-y-1 text-[11px]">
                <div className="px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] border-b border-[var(--glass-border-subtle)] mb-1">
                  实用维护工具
                </div>
                <button
                  type="button"
                  onClick={() => handleAction("tool:flush_dns")}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition text-left"
                >
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>刷新系统 DNS 缓存</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("tool:close_all_conns")}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition text-left"
                >
                  <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>切断所有活动连接</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("tool:copy_env_pwsh")}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition text-left"
                >
                  <svg className="w-3.5 h-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>复制终端环境变量 (PowerShell)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("tool:restart_core")}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition text-left"
                >
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>平滑热重启内核</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("tool:emergency_reset")}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-rose-500 transition text-left"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>网络急救与代理重置</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===================== 主托盘菜单实体 ===================== */}
        <div className="w-[244px] glass-hud-window border border-[var(--glass-border)] rounded-2xl p-2.5 shadow-2xl text-[var(--text-primary)] flex flex-col space-y-1.5 animate-in fade-in duration-120">
          {/* 1. 顶部状态与实时流量 */}
          <div className="px-2 py-1.5 rounded-xl bg-[var(--glass-bg-subtle)] border border-[var(--glass-border-subtle)]">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center space-x-1.5 font-medium text-[11px]">
                <span className={`w-2 h-2 rounded-full ${payload.running ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" : "bg-slate-400"}`} />
                <span className="font-semibold">ProcWeaver</span>
                <span className="text-[9px] text-[var(--text-muted)] font-mono">[{modeZh}]</span>
              </div>
            </div>

            {/* 出口节点指示 */}
            <div
              onClick={() => handleAction("open_node_view")}
              className="text-[10px] text-[var(--text-secondary)] hover:text-blue-500 cursor-pointer flex items-center justify-between transition"
            >
              <span className="truncate pr-1">
                出口: {payload.activeNode || "未选定 / 直连"}
              </span>
              {payload.activeNodeDelay && payload.activeNodeDelay > 0 ? (
                <span className="font-mono text-[9px] text-emerald-500 shrink-0">
                  {payload.activeNodeDelay}ms
                </span>
              ) : null}
            </div>

            {/* 流量遥测 */}
            <div className="flex items-center justify-between text-[9px] font-mono text-[var(--text-muted)] mt-1 pt-1 border-t border-[var(--glass-border-subtle)]">
              <span>↓ {formatSpeed(payload.downSpeed)}</span>
              <span>↑ {formatSpeed(payload.upSpeed)}</span>
            </div>
          </div>

          {/* 2. 核心快捷功能组 (带飞出展开箭头) */}
          <div className="space-y-0.5 text-[11px]">
            {/* 节点秒切 */}
            <div
              onMouseEnter={() => handleTriggerEnter("nodes")}
              onMouseLeave={handleTriggerLeave}
              className={`flex items-center justify-between px-2 py-1.5 rounded-xl cursor-pointer transition ${
                activeSubmenu === "nodes"
                  ? "bg-[var(--glass-bg-hover)] text-blue-500"
                  : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>节点线路秒切</span>
              </div>
              <svg className={`w-3 h-3 text-[var(--text-muted)] ${direction === "left" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>

            {/* 运行模式 */}
            <div
              onMouseEnter={() => handleTriggerEnter("mode")}
              onMouseLeave={handleTriggerLeave}
              className={`flex items-center justify-between px-2 py-1.5 rounded-xl cursor-pointer transition ${
                activeSubmenu === "mode"
                  ? "bg-[var(--glass-bg-hover)] text-blue-500"
                  : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span>分流运行模式</span>
              </div>
              <svg className={`w-3 h-3 text-[var(--text-muted)] ${direction === "left" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>

            {/* 常用工具 */}
            <div
              onMouseEnter={() => handleTriggerEnter("tools")}
              onMouseLeave={handleTriggerLeave}
              className={`flex items-center justify-between px-2 py-1.5 rounded-xl cursor-pointer transition ${
                activeSubmenu === "tools"
                  ? "bg-[var(--glass-bg-hover)] text-blue-500"
                  : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-3.5 h-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                </svg>
                <span>实用工具维护</span>
              </div>
              <svg className={`w-3 h-3 text-[var(--text-muted)] ${direction === "left" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>

          {/* 3. 核心开关区域 */}
          <div className="pt-1 border-t border-[var(--glass-border-subtle)] space-y-0.5 text-[11px]">
            {/* 系统代理开关 */}
            <button
              type="button"
              onClick={() => {
                setPayload((prev) => ({ ...prev, sysProxyEnabled: !prev.sysProxyEnabled }));
                handleAction("toggle_sysproxy");
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-left transition"
            >
              <span className="text-[var(--text-secondary)]">系统代理</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
                payload.sysProxyEnabled
                  ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                  : "bg-slate-500/10 text-slate-400 border-slate-500/20"
              }`}>
                {payload.sysProxyEnabled ? "已开启" : "已关闭"}
              </span>
            </button>

            {/* 进程分流总开关 */}
            <button
              type="button"
              onClick={() => {
                setPayload((prev) => ({ ...prev, processEnabled: !prev.processEnabled }));
                handleAction("toggle_process_master");
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-left transition"
            >
              <span className="text-[var(--text-secondary)]">手动进程分流</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
                payload.processEnabled
                  ? "bg-blue-500/15 text-blue-500 border-blue-500/30"
                  : "bg-slate-500/10 text-slate-400 border-slate-500/20"
              }`}>
                {payload.processEnabled ? "已开启" : "已关闭"}
              </span>
            </button>

            {/* 开机自启动 */}
            <button
              type="button"
              onClick={() => {
                setPayload((prev) => ({ ...prev, autoRun: !prev.autoRun }));
                handleAction("toggle_autolaunch");
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-[var(--glass-bg-hover)] text-left transition"
            >
              <span className="text-[var(--text-secondary)]">开机自启动</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
                payload.autoRun
                  ? "bg-blue-500/15 text-blue-500 border-blue-500/30"
                  : "bg-slate-500/10 text-slate-400 border-slate-500/20"
              }`}>
                {payload.autoRun ? "已开启" : "已关闭"}
              </span>
            </button>
          </div>

          {/* 4. 底部打开与退出 */}
          <div className="pt-1 border-t border-[var(--glass-border-subtle)] grid grid-cols-2 gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => handleAction("open")}
              className="w-full flex items-center justify-center space-x-1.5 px-2 py-1.5 rounded-xl bg-[var(--glass-bg-subtle)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border-subtle)] text-[var(--text-primary)] transition font-medium"
            >
              <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              <span>主控制台</span>
            </button>

            <button
              type="button"
              onClick={() => handleAction("quit")}
              className="w-full flex items-center justify-center space-x-1.5 px-2 py-1.5 rounded-xl hover:bg-rose-500/15 text-rose-500 border border-rose-500/20 transition font-medium"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>退出程序</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
