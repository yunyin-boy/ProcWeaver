import React from "react";
import { Expand, Minus, Monitor, Moon, PanelsTopLeft, Pin, Square, Sun, X } from "lucide-react";
import { version as appVersion } from "../../package.json";
import appIcon from "../assets/app-icon.png";
import { StatusBadge } from "../primitives/Badge";
import { FormFactor } from "../utils/useWindowFormFactor";
import {
  windowMinimize,
  windowToggleMaximize,
  windowClose,
  windowStartDragging,
} from "../services/windowService";

interface WindowChromeProps {
  isRunning: boolean;
  onToggleCore?: (start: boolean) => void;
  theme: "light" | "dark" | "system";
  onToggleTheme: () => void;
  formFactor?: FormFactor;
  onSetFormFactor?: (factor: FormFactor) => void;
  isPinnedTop?: boolean;
  onTogglePinTop?: () => void;
  sidebarToggle?: React.ReactNode;
}

export const WindowChrome: React.FC<WindowChromeProps> = ({
  isRunning,
  onToggleCore,
  theme,
  onToggleTheme,
  formFactor = "standard",
  onSetFormFactor,
  isPinnedTop = false,
  onTogglePinTop,
  sidebarToggle,
}) => {
  const isMini = formFactor === "mini";

  const handleMinimize = async () => {
    try {
      await windowMinimize();
    } catch (err) {
      console.error("最小化窗口失败:", err);
    }
  };

  const handleMaximize = async () => {
    try {
      await windowToggleMaximize();
    } catch (err) {
      console.error("切换窗口最大化失败:", err);
    }
  };

  const handleClose = async () => {
    try {
      await windowClose();
    } catch (err) {
      console.error("关闭窗口失败:", err);
    }
  };

  const handleWindowDrag = async (e: React.MouseEvent) => {
    // 仅响应鼠标左键按下
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 排除交互控件 (按钮、输入框、可点击标签等)
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest("a") ||
      target.closest("[data-no-drag]")
    ) {
      return;
    }
    // 双击顶栏空白处切换窗口最大化 / 还原
    if (e.detail === 2) {
      try {
        await windowToggleMaximize();
      } catch (err) {
        console.error("切换窗口最大化失败:", err);
      }
      return;
    }
    // 单击按下时立即唤起 Rust 原生安全窗口拖拽
    try {
      await windowStartDragging();
    } catch (err) {
      console.error("启动窗口拖拽失败:", err);
    }
  };

  const ThemeIcon = theme === "dark" ? Sun : theme === "system" ? Monitor : Moon;
  const themeLabel = { light: "浅色", dark: "深色", system: "跟随系统" }[theme];

  return (
    <header data-tauri-drag-region onMouseDown={handleWindowDrag} className="workbench-titlebar">
      <div className="flex min-w-0 items-center gap-2">
        {sidebarToggle}
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
          <span className="workbench-mark shrink-0"><img src={appIcon} alt="" className="size-4" /></span>
          <span className="truncate">ProcWeaver</span>
          <span className="hidden font-mono text-[11px] font-normal text-[var(--text-muted)] sm:inline">v{appVersion}</span>
        </div>
        <StatusBadge
          status={isRunning ? "healthy" : "inactive"}
          label={isRunning ? "核心运行中" : "核心就绪"}
          title={isRunning ? "停止网络核心" : "启动网络核心"}
          onClick={onToggleCore ? () => onToggleCore(!isRunning) : undefined}
          className="shrink-0 whitespace-nowrap"
        />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {isMini && onTogglePinTop && (
          <button
            type="button"
            className="workbench-title-button"
            onClick={() => onTogglePinTop()}
            aria-label="置顶桌面挂件"
            aria-pressed={isPinnedTop}
            title={isPinnedTop ? "取消置顶" : "置顶桌面挂件"}
          >
            <Pin size={14} aria-hidden="true" />
          </button>
        )}
        {onSetFormFactor && (
          <button
            type="button"
            className="workbench-title-button"
            onClick={() => onSetFormFactor(isMini ? "standard" : "mini")}
            aria-label={isMini ? "展开标准工作台" : "切换到桌面挂件"}
            title={isMini ? "展开标准工作台" : "桌面挂件"}
          >
            {isMini ? <Expand size={14} aria-hidden="true" /> : <PanelsTopLeft size={14} aria-hidden="true" />}
            {!isMini && <span className="workbench-title-label">桌面挂件</span>}
          </button>
        )}
        <button
          type="button"
          className="workbench-title-button"
          onClick={onToggleTheme}
          aria-label={"切换主题，当前" + themeLabel}
          title={"当前主题 · " + themeLabel}
        >
          <ThemeIcon size={15} aria-hidden="true" />
        </button>
        <button type="button" className="workbench-title-button" onClick={handleMinimize} aria-label="最小化" title="最小化">
          <Minus size={15} aria-hidden="true" />
        </button>
        {!isMini && (
          <button type="button" className="workbench-title-button" onClick={handleMaximize} aria-label="最大化或还原" title="最大化或还原">
            <Square size={13} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="workbench-title-button workbench-close" onClick={handleClose} aria-label="关闭" title="关闭">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
