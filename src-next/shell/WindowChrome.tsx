// ==========================================================================
// ProcWeaver src-next 自绘沉浸顶栏 (Frameless Chrome - 毛玻璃透光)
// 规范溯源: tauri-desktop-layout-typography / tauri-linear-raycast-ui
// ==========================================================================

import React from "react";
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

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleWindowDrag}
      className="h-10 w-full flex items-center justify-between px-3 select-none border-b border-[var(--glass-border-subtle)] glass-bar z-[var(--z-sticky)] cursor-default"
    >
      {/* 左侧：应用图标、信息与运行状态 */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 font-medium text-[12px] tracking-tight text-[var(--text-primary)] pointer-events-none">
          <img
            src={appIcon}
            alt="ProcWeaver"
            className="w-4 h-4 rounded-xs shrink-0 select-none object-contain shadow-2xs"
          />
          <span className="font-semibold">ProcWeaver</span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono hidden sm:inline">v2.4</span>
        </div>
        <StatusBadge
          status={isRunning ? "healthy" : "inactive"}
          label={isRunning ? "运行中" : "就绪 · 点击启动"}
          title={isRunning ? "网络核心服务正在运行中（点击停止）" : "网络核心尚未运行，点击立即启动"}
          onClick={onToggleCore ? () => onToggleCore(!isRunning) : undefined}
        />
      </div>

      {/* 右侧：形态切换/置顶 + 主题切换与 Windows 控制控件组 */}
      <div className="flex items-center gap-1">
        {/* 多尺寸形态切换与置顶控件 (绝无 Emoji) */}
        {isMini ? (
          <div className="flex items-center gap-0.5">
            {/* 迷你小挂件置顶图钉 */}
            {onTogglePinTop && (
              <button
                type="button"
                onClick={onTogglePinTop}
                className={`p-1.5 rounded-lg transition-colors ${
                  isPinnedTop
                    ? "text-blue-500 bg-blue-500/15 border border-blue-500/30"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)]"
                }`}
                title={isPinnedTop ? "已置顶常驻桌面 (点击取消)" : "置顶小挂件"}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v2a2 2 0 01-.586 1.414L16 11v6l2 2v1H6v-1l2-2v-6L5.586 8.414A2 2 0 015 7V5z" />
                </svg>
              </button>
            )}

            {/* 还原展开为标准工作台 */}
            {onSetFormFactor && (
              <button
                type="button"
                onClick={() => onSetFormFactor("standard")}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors"
                title="展开到标准工作台 (1160x740)"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          /* 大窗口形态：切换为 380x580 迷你桌面挂件 */
          onSetFormFactor && (
            <button
              type="button"
              onClick={() => onSetFormFactor("mini")}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border-subtle)] transition-colors"
              title="切换为轻量迷你小挂件 (380x580)"
            >
              <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h8m-8 6h16" />
              </svg>
              <span>桌面挂件</span>
            </button>
          )
        )}

        {/* 明暗模式切换 */}
        <button
          onClick={onToggleTheme}
          title={`当前主题: ${theme}`}
          className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors duration-120"
        >
          {theme === "dark" ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {/* 最小化 */}
        <button
          onClick={handleMinimize}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
            <rect y="5.5" width="12" height="1" />
          </svg>
        </button>

        {/* 最大化 / 还原 (Mini 模式下隐藏最大化) */}
        {!isMini && (
          <button
            onClick={handleMaximize}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor">
              <rect x="1.5" y="1.5" width="9" height="9" strokeWidth="1" />
            </svg>
          </button>
        )}

        {/* 关闭 */}
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-rose-600 hover:text-white transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor">
            <path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
};
