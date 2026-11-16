import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  Zap,
  Search,
  Minimize2,
  Pin,
  Expand,
  Minus,
  Square,
  Copy,
  X,
} from "lucide-react";
import {
  windowMinimize,
  windowToggleMaximize,
  windowIsMaximized,
  windowClose,
  windowStartDragging,
} from "../../api";
import { ThemeToggle } from "../ThemeToggle";
import type { FormFactor } from "../../hooks/useWindowFormFactor";

interface WindowHeaderProps {
  coreRunning: boolean;
  mode: "rule" | "global" | "direct" | "";
  activeNodeName?: string;
  latencyMs?: number | null;
  formFactor: FormFactor;
  setFormFactor: (factor: FormFactor) => void;
  isPinnedTop?: boolean;
  togglePinTop?: () => void;
  onOpenSearch?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const WindowHeader: React.FC<WindowHeaderProps> = ({
  coreRunning,
  mode,
  activeNodeName,
  latencyMs,
  formFactor,
  setFormFactor,
  isPinnedTop = false,
  togglePinTop,
  onOpenSearch,
  onNavigateTab,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    windowIsMaximized().then(setIsMaximized).catch(() => {});
    const handleResize = () => {
      windowIsMaximized().then(setIsMaximized).catch(() => {});
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleWindowDrag = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest("a") ||
      target.closest("[data-no-drag]")
    ) {
      return;
    }
    if (e.detail === 2) {
      try {
        const next = await windowToggleMaximize();
        setIsMaximized(next);
      } catch (err) {
        console.error("切换窗口最大化失败:", err);
      }
      return;
    }
    try {
      await windowStartDragging();
    } catch (err) {
      console.error("启动窗口拖拽失败:", err);
    }
  };

  const isMini = formFactor === "mini";

  return (
    <header
      id="window-titlebar"
      data-tauri-drag-region
      onMouseDown={handleWindowDrag}
      className="h-10 px-3.5 flex items-center justify-between border-b hairline-divider select-none relative z-30 shrink-0 bg-white/70 dark:bg-slate-900/50 backdrop-blur-md transition-colors"
    >
      {/* 顶栏左侧：Logo、呼吸状态、模式徽标 */}
      <div
        className="flex items-center space-x-2.5 min-w-0 cursor-pointer group"
        onClick={() => onNavigateTab?.("proxies")}
        title="点击快速查看节点线路"
      >
        <div className="flex items-center space-x-2 shrink-0">
          <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-xs tracking-tight text-slate-900 dark:text-white">
            ProcWeaver
          </span>
        </div>

        {/* 核心运行状态呼吸徽标 */}
        <span
          className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-semibold flex items-center gap-1.5 shrink-0 transition-colors ${
            coreRunning
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-slate-500/10 text-slate-500 dark:text-slate-400"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              coreRunning ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
            }`}
          />
          <span>{coreRunning ? "CORE ACTIVE" : "STANDBY"}</span>
        </span>

        {/* 分流模式胶囊 */}
        {!isMini && (
          <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 font-mono text-[9px] font-bold shrink-0 uppercase">
            {mode === "global" ? "GLOBAL" : mode === "direct" ? "DIRECT" : "RULE"}
          </span>
        )}
      </div>

      {/* 顶栏中央：Raycast 搜索胶囊 (大窗口展示，Mini 挂件隐藏) */}
      {!isMini && (
        <div
          id="titlebar-center-search"
          onClick={() => {
            if (onOpenSearch) onOpenSearch();
            else onNavigateTab?.("proxies");
          }}
          className="max-w-xs w-full cursor-pointer group mx-3"
        >
          <div className="py-1 px-3 rounded-full bg-slate-100 hover:bg-slate-200/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border hairline-divider transition flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center space-x-1.5 truncate">
              <Search className="w-3 h-3 text-sky-500 dark:text-sky-400" />
              <span className="text-[11px] truncate">
                {activeNodeName ? `当前节点: ${activeNodeName}` : "检索线路或触发操作..."}
              </span>
            </div>
            <div className="flex items-center space-x-1 shrink-0">
              <span className="key-cap">Ctrl</span>
              <span className="key-cap">K</span>
            </div>
          </div>
        </div>
      )}

      {/* 顶栏右侧：延迟徽标 + 挂件切换/置顶 + 主题切换 + 窗口操作按键 */}
      <div className="flex items-center space-x-1.5 shrink-0" data-tauri-drag-region="false">
        {/* 延迟胶囊 */}
        {coreRunning && (
          <span
            className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
              (latencyMs ?? 0) > 0 && (latencyMs ?? 0) < 180
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                : (latencyMs ?? 0) >= 180
                ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
                : "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/[0.04]"
            }`}
          >
            <Zap className="w-2.5 h-2.5" />
            <span>{(latencyMs ?? 0) > 0 ? `${latencyMs}ms` : "在线"}</span>
          </span>
        )}

        {/* 快速深浅主题切换 */}
        <ThemeToggle compact />

        {/* 迷你挂件专享功能：置顶图钉 & 还原大窗口 */}
        {isMini ? (
          <div className="flex items-center space-x-0.5">
            {togglePinTop && (
              <button
                type="button"
                onClick={togglePinTop}
                className={`p-1 rounded transition cursor-pointer ${
                  isPinnedTop
                    ? "text-sky-600 bg-sky-500/15"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-white ghost-hover"
                }`}
                title={isPinnedTop ? "已置顶 (点击取消)" : "置顶小挂件"}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setFormFactor("standard")}
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white ghost-hover transition cursor-pointer"
              title="展开到完整窗口 (1160×740)"
            >
              <Expand className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          /* 大窗口下：显性【桌面挂件】切换胶囊 */
          <button
            type="button"
            onClick={() => setFormFactor("mini")}
            id="btn-switch-to-mini"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer border hairline-divider"
            title="切换为轻量桌面小挂件 (380×580)"
          >
            <Minimize2 className="w-3.5 h-3.5 text-sky-500" />
            <span className="hidden sm:inline">桌面挂件</span>
          </button>
        )}

        {/* 分隔发丝线 */}
        <div className="h-3.5 w-px hairline-divider mx-0.5" />

        {/* Windows 11 原生控制三连击 */}
        <div className="flex items-center space-x-0.5">
          <button
            type="button"
            onClick={() => windowMinimize().catch(console.error)}
            title="最小化"
            className="win-caption-btn"
          >
            <Minus className="w-3.5 h-3.5 stroke-[2]" />
          </button>
          {!isMini && (
            <button
              type="button"
              onClick={async () => {
                const next = await windowToggleMaximize().catch(() => isMaximized);
                setIsMaximized(next);
              }}
              title={isMaximized ? "向下还原" : "最大化"}
              className="win-caption-btn"
            >
              {isMaximized ? (
                <Copy className="w-3 h-3 stroke-[2] rotate-90" />
              ) : (
                <Square className="w-3 h-3 stroke-[2]" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => windowClose().catch(console.error)}
            title="关闭"
            className="win-caption-btn win-close"
          >
            <X className="w-3.5 h-3.5 stroke-[2]" />
          </button>
        </div>
      </div>
    </header>
  );
};
