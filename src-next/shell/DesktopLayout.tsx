import React, { useEffect, useId, useRef, useState } from "react";
import {
  Activity, ArrowLeftRight, ClipboardList, Globe, LayoutDashboard,
  Monitor, PanelLeftClose, PanelLeftOpen, Power, Radio, ScrollText, Settings, Workflow,
} from "lucide-react";
import { WindowChrome } from "./WindowChrome";
import { StatusBar } from "./StatusBar";
import { CapsuleToggle } from "../primitives/CapsuleToggle";
import { RoutingModeControl, ROUTING_MODES } from "../primitives/RoutingModeControl";
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

const navigation = [
  [
    { id: "overview", label: "核心概览", icon: LayoutDashboard },
    { id: "proxies", label: "出口节点", icon: Globe },
    { id: "process", label: "进程分流", icon: Workflow },
    { id: "profiles", label: "订阅源管理", icon: Radio },
  ],
  [
    { id: "routing", label: "规则编织", icon: ClipboardList },
    { id: "connections", label: "链接追踪", icon: Activity },
  ],
  [
    { id: "logs", label: "实时日志", icon: ScrollText },
    { id: "settings", label: "系统首选项", icon: Settings },
  ],
] as const;

const previewSizes = [
  { id: "mini", label: "桌面挂件 (380×580)" },
  { id: "compact", label: "紧凑分屏 (1024×680)" },
  { id: "standard", label: "标准工作台 (1160×740)" },
  { id: "full", label: "铺满网页" },
] as const;

const SIDEBAR_STORAGE_KEY = "procweaver_next_sidebar_collapsed";

function SidebarRoutingMode({ mode, onChange }: { mode: string; onChange: (mode: EngineMode) => void }) {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modeLabel = ROUTING_MODES.find(({ id }) => id === mode.toLowerCase())?.label ?? mode;
  const label = `分流模式 · ${modeLabel}`;

  useEffect(() => {
    if (!open) return;
    const options = controlRef.current?.querySelectorAll<HTMLButtonElement>("[aria-pressed]");
    const selected = Array.from(options ?? []).find((option) => option.getAttribute("aria-pressed") === "true");
    (selected ?? options?.[0])?.focus();

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div
      ref={controlRef}
      className="workbench-rail-mode"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        closeAndFocus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="workbench-action workbench-rail-icon"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popupId}
        onClick={() => setOpen(!open)}
      >
        <ArrowLeftRight size={16} aria-hidden="true" />
        <span className="workbench-rail-tooltip" aria-hidden="true">{label}</span>
      </button>
      <div id={popupId} className="workbench-rail-mode-popup" hidden={!open}>
        <RoutingModeControl
          mode={mode}
          onChange={(nextMode) => {
            closeAndFocus();
            if (nextMode !== mode.toLowerCase()) onChange(nextMode);
          }}
        />
      </div>
    </div>
  );
}

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
  const workbenchRef = useRef<HTMLDivElement>(null);
  const navigationId = useId();
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved === "true" || saved === "false") return saved === "true";
    } catch {}
    return null;
  });
  const [narrowWorkbench, setNarrowWorkbench] = useState(false);
  useEffect(() => {
    if (sidebarPreference !== null || !workbenchRef.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrowWorkbench(entry.contentRect.width <= 760));
    observer.observe(workbenchRef.current);
    return () => observer.disconnect();
  }, [sidebarPreference]);

  const isMini = formFactor === "mini";
  const collapsed = sidebarPreference ?? (formFactor === "compact" || narrowWorkbench);
  const SidebarIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const sidebarToggleLabel = collapsed ? "展开侧栏" : "收起侧栏";
  const pageLabel = isMini ? "桌面挂件" : navigation.flat().find(({ id }) => id === currentTab)?.label;
  const systemProxyLabel = systemProxyEnabled ? "系统代理已接管" : "系统代理未接管";

  const workbench = (
    <div
      ref={workbenchRef}
      className="workbench-window"
      data-mini={isMini || undefined}
      data-sidebar={isMini ? undefined : collapsed ? "collapsed" : "expanded"}
    >
      <WindowChrome
        isRunning={isRunning}
        onToggleCore={onToggleCore}
        theme={theme}
        onToggleTheme={onToggleTheme}
        formFactor={formFactor}
        onSetFormFactor={onSetFormFactor}
        isPinnedTop={isPinnedTop}
        onTogglePinTop={onTogglePinTop}
        sidebarToggle={!isMini && (
          <button
            type="button"
            className="workbench-title-button workbench-rail-toggle"
            aria-label={sidebarToggleLabel}
            aria-expanded={!collapsed}
            aria-controls={navigationId}
            title={sidebarToggleLabel}
            onClick={() => {
              setSidebarPreference(!collapsed);
              try {
                localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!collapsed));
              } catch {}
            }}
          >
            <SidebarIcon size={16} aria-hidden="true" />
          </button>
        )}
      />

      <div className="workbench-body">
        {!isMini && (
          <aside className="workbench-rail" data-collapsed={collapsed || undefined}>
            <nav id={navigationId} className="workbench-nav" aria-label="工作台导航">
              {navigation.map((group, index) => (
                <div key={group[0].id} className={index ? "workbench-nav workbench-nav-group" : "workbench-nav"}>
                  {group.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className="workbench-nav-button"
                      aria-label={label}
                      aria-current={currentTab === id ? "page" : undefined}
                      title={collapsed ? undefined : label}
                      onClick={() => onSelectTab(id)}
                    >
                      <Icon size={16} className="shrink-0" aria-hidden="true" />
                      <span className={collapsed ? "workbench-rail-tooltip" : "truncate"} aria-hidden="true">{label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            {currentTab !== "overview" && (onChangeMode || onToggleSystemProxy) && (
              <div className="workbench-rail-quick" aria-label="网络快捷操作">
                {onChangeMode && (collapsed ? (
                  <SidebarRoutingMode mode={mode} onChange={onChangeMode} />
                ) : (
                  <div className="grid gap-1">
                    <span className="px-1 text-xs text-[var(--text-muted)]">分流模式</span>
                    <RoutingModeControl mode={mode} onChange={onChangeMode} />
                  </div>
                ))}

                {onToggleSystemProxy && (collapsed ? (
                  <button
                    type="button"
                    role="switch"
                    className="workbench-action workbench-rail-icon"
                    aria-checked={systemProxyEnabled}
                    aria-label="系统代理"
                    onClick={() => onToggleSystemProxy(!systemProxyEnabled)}
                  >
                    <Power size={17} aria-hidden="true" />
                    <span className="workbench-rail-tooltip" aria-hidden="true">{systemProxyLabel}</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--workbench-control)] px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">系统代理</p>
                      <p className="truncate text-[11px] text-[var(--text-muted)]">
                        {systemProxyEnabled ? "127.0.0.1:" + mixedPort : "未接管"}
                      </p>
                    </div>
                    <CapsuleToggle checked={systemProxyEnabled} onChange={onToggleSystemProxy} title={systemProxyLabel} />
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}

        <main className="workbench-main" data-page={isMini ? undefined : currentTab} aria-label={pageLabel}>
          <div className="workbench-main-inner">{children}</div>
        </main>
      </div>

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

  if (isTauriEnvironment()) return workbench;

  const { width, height } = FORM_FACTOR_SIZES[formFactor];
  return (
    <div className="workbench-preview flex h-screen w-screen flex-col items-center justify-center gap-2 overflow-hidden p-2.5">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-[var(--workbench-surface)] p-1" aria-label="视口调试器">
        <span className="mx-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Monitor size={14} aria-hidden="true" />
          视口调试器
        </span>
        {previewSizes.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={formFactor === id}
            className={"workbench-action " + (formFactor === id ? "workbench-action-primary" : "workbench-action-ghost")}
            onClick={() => onSetFormFactor?.(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        style={{ width, height }}
        className={"workbench-preview-frame flex flex-col overflow-hidden " + (formFactor === "full" ? "flex-1" : "rounded-xl")}
      >
        {workbench}
      </div>
    </div>
  );
};
