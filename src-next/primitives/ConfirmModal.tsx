// ==========================================================================
// ProcWeaver src-next 通用微晶确认模态窗 (ConfirmModal)
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy / taste-skill
// 特性: 彻底替代原生 window.confirm，提供双层毛玻璃、1px微高光、键盘无障碍支持
// ==========================================================================

import React, { useEffect, useRef } from "react";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary";
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  variant = "danger",
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // 键盘快捷键监听：ESC 退出，Enter 确认
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !isLoading) {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // 打开时自动聚焦于确认按钮
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, isLoading, onCancel, onConfirm]);

  if (!isOpen) return null;

  // 变体配色映射
  const variantStyles = {
    danger: {
      iconBg: "bg-rose-500/10 border-rose-500/20 text-rose-500",
      btnBg: "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-500/25 active:scale-95",
      iconSvg: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
    },
    warning: {
      iconBg: "bg-amber-500/10 border-amber-500/20 text-amber-500",
      btnBg: "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/25 active:scale-95",
      iconSvg: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
    primary: {
      iconBg: "bg-blue-500/10 border-blue-500/20 text-blue-500",
      btnBg: "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/25 active:scale-95",
      iconSvg: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  }[variant];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 p-5 space-y-4 shadow-2xl text-left animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部微高光发丝线 */}
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        {/* 头部：图标 + 标题 */}
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl border shrink-0 ${variantStyles.iconBg}`}>
            {variantStyles.iconSvg}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h4 className="text-sm font-bold text-[var(--text-primary)] tracking-wide">
              {title}
            </h4>
            <div className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed break-words">
              {description}
            </div>
          </div>
        </div>

        {/* 底部按钮组 */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--glass-border-subtle)]">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 transition-all cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${variantStyles.btnBg} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isLoading && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            <span>{isLoading ? "处理中..." : confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
