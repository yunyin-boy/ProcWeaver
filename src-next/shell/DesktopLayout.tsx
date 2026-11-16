// ==========================================================================
// ProcWeaver src-next 全尺寸多栏工作台外壳 (沉浸毛玻璃视口)
// 规范溯源: tauri-desktop-layout-typography / tauri-linear-raycast-ui
// 动态折叠: 支持 mini (380x580) / compact (1024x680) / standard (1160x740)
// ==========================================================================

import React from "react";
import { WindowChrome } from "./WindowChrome";
import { StatusBar } from "./StatusBar";
import { BandwidthSnapshot } from "../types/telemetry";
import { EngineMode } from "../types/core";
import { FormFactor, FORM_FACTOR_SIZES } from "../utils/useWindowFormFactor";
import { isTauriEnvironment } from "../services/client";

export type NavTab =
  | "overview"
  | "proxies"
  | "process"
  | "profiles"
  | "routing"
  | "connections"
  | "logs"
  | "settings";

interface DesktopLayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isRunning: boolean;
  onToggleCore?: (start: boolean) => void;
  mixedPort: number;
  mode: string;
  processCount: number;
  memoryUsageBytes?: number;
  bandwidth: BandwidthSnapshot;
  theme: "light" | "dark" | "system";
  onToggleTheme: () => void;
  formFactor?: FormFactor;
  onSetFormFactor?: (factor: FormFactor) => void;
  isPinnedTop?: boolean;
  onTogglePinTop?: () => void;
  onOpenCommandPalette?: () => void;
  onChangeMode?: (mode: EngineMode) => void;
  systemProxyEnabled?: boolean;
  onToggleSystemProxy?: (enabled: boolean) => void;
  children: React.ReactNode;
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({
  currentTab,
  onSelectTab,
  isRunning,
  onToggleCore,
  mixedPort,
  mode,
  processCount,
  memoryUsageBytes,
  bandwidth,
  theme,
  onToggleTheme,
  formFactor = "standard",
  onSetFormFactor,
  isPinnedTop = false,
  onTogglePinTop,
  onOpenCommandPalette,
  onChangeMode,
  systemProxyEnabled = false,
  onToggleSystemProxy,
  children,
}) => {
  const isTauri = isTauriEnvironment();
  const isMini = formFactor === "mini";
  const isCompact = formFactor === "compact";

  const navItems: {
    id: NavTab;
    label: string;
    desc: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "overview",
      label: "核心概览",
      desc: "实时遥测与启停",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: "proxies",
      label: "出口节点",
      desc: "延迟测速与分组",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: "process",
      label: "进程分流",
      desc: "应用强锁与进程代理",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
      ),
    },
    {
      id: "profiles",
      label: "订阅源管理",
      desc: "订阅拉取与方案切换",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      ),
    },
    {
      id: "routing",
      label: "规则编织",
      desc: "域名与分流规则",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      id: "connections",
      label: "链接追踪",
      desc: "活动连接与分流追踪",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
    {
      id: "logs",
      label: "实时日志",
      desc: "内核流与事件审计",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: "settings",
      label: "系统首选项",
      desc: "内核与驱动配置",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  // 内部真实工作台内容渲染器
  const renderWorkbenchContent = () => (
    <div className="relative flex flex-col h-full w-full overflow-hidden glass-hud-window text-[var(--text-primary)]">
      {/* 顶部发丝级 1px 倒角切削内高光 */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none z-30" />

      {/* 毛玻璃物理折射光源：浅色通透晶体折射 / 暗色极简幽邃微晕 (避免暗色杂乱色块污染文字) */}
      <div className="pointer-events-none absolute -top-16 -left-16 w-80 h-80 rounded-full bg-sky-400/25 dark:bg-blue-600/5 blur-[90px]" />
      <div className="pointer-events-none absolute top-1/4 -right-16 w-80 h-80 rounded-full bg-indigo-400/20 dark:bg-indigo-500/5 blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-20 left-1/4 w-96 h-96 rounded-full bg-emerald-400/20 dark:bg-emerald-500/3 blur-[100px]" />
      <div className="pointer-events-none absolute top-1/2 left-1/3 w-64 h-64 rounded-full bg-purple-400/12 dark:bg-purple-600/3 blur-[85px]" />

      {/* 沉浸顶栏：支持形态切换与置顶 */}
      <WindowChrome
        isRunning={isRunning}
        onToggleCore={onToggleCore}
        theme={theme}
        onToggleTheme={onToggleTheme}
        formFactor={formFactor}
        onSetFormFactor={onSetFormFactor}
        isPinnedTop={isPinnedTop}
        onTogglePinTop={onTogglePinTop}
      />

      {/* 主体工作区：自适应侧边导航 + 核心视口 */}
      <div className="flex-1 flex overflow-hidden z-10">
        {/* 侧边导航栏 (Mini 挂件模式下彻底隐藏；Compact 紧凑模式下收拢为 56px 图标栏；Standard 模式全展开 208px) */}
        {!isMini && (
          <aside
            className={`shrink-0 flex flex-col justify-between p-2.5 border-r border-[var(--glass-border-subtle)] glass-bar select-none transition-all duration-200 ease-out ${
              isCompact ? "w-14 items-center" : "w-52"
            }`}
          >
            <div className={`space-y-1 w-full ${isCompact ? "flex flex-col items-center" : ""}`}>
              {!isCompact && (
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  工作台
                </div>
              )}
              {navItems.map((item, index) => {
                const active = currentTab === item.id;
                const isTelemetryHeader = index === 4;
                const isSystemHeader = index === 6;

                return (
                  <React.Fragment key={item.id}>
                    {isTelemetryHeader && (
                      isCompact ? (
                        <div className="w-6 h-px bg-[var(--glass-border-subtle)] my-1.5" />
                      ) : (
                        <div className="pt-2 pb-1 px-2.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)] border-t border-[var(--glass-border-subtle)] mt-1.5">
                          观测排障
                        </div>
                      )
                    )}
                    {isSystemHeader && (
                      isCompact ? (
                        <div className="w-6 h-px bg-[var(--glass-border-subtle)] my-1.5" />
                      ) : (
                        <div className="pt-2 pb-1 px-2.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)] border-t border-[var(--glass-border-subtle)] mt-1.5">
                          系统配置
                        </div>
                      )
                    )}
                    <button
                      key={item.id}
                      onClick={() => onSelectTab(item.id)}
                      title={isCompact ? item.label : undefined}
                      className={`
                        flex items-center rounded-xl text-[13px] font-medium
                        transition-all duration-150 ease-[var(--ease-out-expo)]
                        ${
                          isCompact
                            ? "w-10 h-10 justify-center relative p-0"
                            : "w-full justify-between px-3 py-2"
                        }
                        ${
                          active
                            ? "glass-surface text-[var(--text-primary)] font-semibold border-white/20 dark:border-white/20 shadow-xs"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)]"
                        }
                      `}
                    >
                      {isCompact ? (
                        <>
                          <span className={active ? "text-blue-500" : ""}>{item.icon}</span>
                          {active && (
                            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={active ? "text-blue-500" : "text-[var(--text-muted)]"}>
                              {item.icon}
                            </span>
                            <div className="flex flex-col items-start min-w-0">
                              <span className="truncate">{item.label}</span>
                              <span className={`text-[10px] truncate ${active ? "text-blue-500/85 dark:text-blue-400/85 font-medium" : "text-[var(--text-muted)]"}`}>
                                {item.desc}
                              </span>
                            </div>
                          </div>
                          {active && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
                          )}
                        </>
                      )}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* 侧边栏底部: 分流模式三段滑块 + 系统代理开关 (紧凑模式下极简折叠) */}
            {!isCompact ? (
              <div className="p-2.5 rounded-xl glass-surface space-y-2.5 w-full border border-[var(--glass-border-subtle)]">
                {/* 1. 分流模式三段切换 */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-medium px-0.5">
                    <span>分流模式</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
                      {mode}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]">
                    {(
                      [
                        { id: "rule", label: "规则" },
                        { id: "global", label: "全局" },
                        { id: "direct", label: "直连" },
                      ] as const
                    ).map((m) => {
                      const active = mode.toLowerCase() === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onChangeMode?.(m.id)}
                          className={`py-1 text-[11px] font-medium rounded-md transition-all duration-150 text-center select-none ${
                            active
                              ? "bg-blue-600 text-white shadow-xs font-semibold"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-surface-subtle)]"
                          }`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. 系统代理一键开关 */}
                <div className="pt-2 border-t border-[var(--glass-border-subtle)]">
                  <div
                    onClick={() => onToggleSystemProxy?.(!systemProxyEnabled)}
                    className="flex items-center justify-between p-1 rounded-lg hover:bg-[var(--glass-surface-subtle)] cursor-pointer transition-colors select-none group"
                    title={systemProxyEnabled ? "点击关闭 Windows 系统代理" : "点击开启 Windows 系统代理"}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                          systemProxyEnabled
                            ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                            : "bg-[var(--text-muted)] opacity-40"
                        }`}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-medium text-[var(--text-primary)] leading-tight">
                          系统代理
                        </span>
                        <span className="text-[9px] text-[var(--text-muted)] truncate font-mono leading-tight">
                          {systemProxyEnabled
                            ? `127.0.0.1:${mixedPort || 7890}`
                            : "未接管"}
                        </span>
                      </div>
                    </div>

                    {/* 精致微开关 Switch */}
                    <div
                      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                        systemProxyEnabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200 ease-in-out ${
                          systemProxyEnabled ? "translate-x-3.5" : "translate-x-0.5"
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 w-full">
                {/* 紧凑模式下的极简模式切换按钮 */}
                <button
                  type="button"
                  onClick={() => {
                    const nextMode: EngineMode =
                      mode.toLowerCase() === "rule"
                        ? "global"
                        : mode.toLowerCase() === "global"
                        ? "direct"
                        : "rule";
                    onChangeMode?.(nextMode);
                  }}
                  className="w-10 h-10 rounded-xl glass-surface flex flex-col items-center justify-center text-[10px] font-bold text-blue-500 hover:bg-blue-500/10 transition-colors"
                  title={`当前分流模式: ${mode} (点击切换)`}
                >
                  <span className="text-[9px] uppercase">{mode.slice(0, 3)}</span>
                </button>

                {/* 紧凑模式下的系统代理切换按钮 */}
                <button
                  type="button"
                  onClick={() => onToggleSystemProxy?.(!systemProxyEnabled)}
                  className={`w-10 h-10 rounded-xl glass-surface flex items-center justify-center transition-colors ${
                    systemProxyEnabled
                      ? "text-emerald-500 bg-emerald-500/10"
                      : "text-[var(--text-muted)] hover:bg-[var(--glass-surface-subtle)]"
                  }`}
                  title={systemProxyEnabled ? `系统代理: 已接管 (127.0.0.1:${mixedPort})` : "系统代理: 未开启"}
                >
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      systemProxyEnabled
                        ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
                        : "bg-[var(--text-muted)]"
                    }`}
                  />
                </button>
              </div>
            )}
          </aside>
        )}

        {/* 动态内容主区 (Mini 挂件形态下零边距平铺，Compact / Standard 保持自适应排版) */}
        <main
          className={`flex-1 relative ${
            isMini
              ? "p-0 overflow-hidden h-full flex flex-col"
              : isCompact
              ? "overflow-y-auto p-4 pb-12"
              : "overflow-y-auto p-6 pb-14"
          }`}
        >
          <div className={isMini ? "w-full h-full flex-1 flex flex-col overflow-hidden" : "max-w-5xl mx-auto"}>
            {children}
          </div>
        </main>
      </div>

      {/* 底部状态栏 (Mini 模式下隐藏以节省空间) */}
      {!isMini && (
        <StatusBar
          bandwidth={bandwidth}
          mixedPort={mixedPort}
          mode={mode}
          processCount={processCount}
          memoryUsageBytes={memoryUsageBytes}
          onOpenCommandPalette={onOpenCommandPalette}
        />
      )}
    </div>
  );

  // 1. 网页开发/预览调试环境：当用户在非 Tauri 环境下预览时，提供居中的设备模拟外框与视口切换控制条
  if (!isTauri) {
    const isFull = formFactor === "full";
    const dim = FORM_FACTOR_SIZES[formFactor];
    const widthStyle = isFull ? "100%" : typeof dim.width === "number" ? `${dim.width}px` : dim.width;
    const heightStyle = isFull ? "100%" : typeof dim.height === "number" ? `${dim.height}px` : dim.height;

    return (
      <div className={`h-screen w-screen flex flex-col items-center justify-center p-2.5 select-none overflow-hidden relative transition-colors duration-200 ${theme === "light" ? "bg-slate-100 text-slate-900" : "bg-[#07080c] text-slate-100"}`}>
        {/* 背景轻微工作台点阵装饰：明暗双轨 */}
        <div className="absolute inset-0 bg-[radial-gradient(#0f172a12_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        {/* 顶部尺寸形态切换控制条 (双层毛玻璃白瓷，无任何 Emoji) */}
        <div className="relative z-20 mb-2 flex flex-wrap items-center gap-1.5 p-1 rounded-xl glass-surface text-xs shadow-lg">
          <span className="px-2 text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span>视口调试器:</span>
          </span>

          <button
            type="button"
            onClick={() => onSetFormFactor?.("mini")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              formFactor === "mini"
                ? "bg-blue-600 text-white font-bold shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-hover)]"
            }`}
          >
            桌面挂件 (380×580)
          </button>

          <button
            type="button"
            onClick={() => onSetFormFactor?.("compact")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              formFactor === "compact"
                ? "bg-blue-600 text-white font-bold shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-hover)]"
            }`}
          >
            紧凑分屏 (1024×680)
          </button>

          <button
            type="button"
            onClick={() => onSetFormFactor?.("standard")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              formFactor === "standard"
                ? "bg-blue-600 text-white font-bold shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-hover)]"
            }`}
          >
            标准工作台 (1160×740)
          </button>

          <button
            type="button"
            onClick={() => onSetFormFactor?.("full")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              formFactor === "full"
                ? "bg-blue-600 text-white font-bold shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-hover)]"
            }`}
          >
            铺满网页
          </button>
        </div>

        {/* 视口仿真设备外壳：明亮模式白瓷柔阴影，深色模式曜石深投影 */}
        <div
          style={{ width: widthStyle, height: heightStyle }}
          className={`relative overflow-hidden transition-all duration-200 ease-out flex flex-col ${
            isFull
              ? "flex-1 w-full h-full rounded-none border-0"
              : "rounded-2xl border border-[var(--glass-border)] shadow-[0_24px_50px_rgba(15,23,42,0.12)] dark:shadow-[0_28px_65px_rgba(0,0,0,0.7)]"
          }`}
        >
          {renderWorkbenchContent()}
        </div>
      </div>
    );
  }

  // 2. 原生桌面端运行 (Tauri) 或在网页端选择铺满全屏：真实全屏渲染，自由缩放
  return renderWorkbenchContent();
};
