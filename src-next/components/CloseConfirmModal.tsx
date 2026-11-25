// ==========================================================================
// ProcWeaver src-next 关闭确认模态对话框 (Linear / Raycast 极简毛玻璃)
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { windowExecuteClose } from "../services/windowService";
import { isTauriEnvironment } from "../services/client";

export interface CloseConfirmModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const CloseConfirmModal: React.FC<CloseConfirmModalProps> = ({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

  const [selectedAction, setSelectedAction] = useState<"minimize" | "exit">("minimize");
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 监听后端 request-close-action 事件与前端 netbox-request-close
  useEffect(() => {
    const handleOpen = () => {
      setInternalOpen(true);
    };

    window.addEventListener("netbox-request-close", handleOpen);
    window.addEventListener("request-close-action", handleOpen);

    let unlisten: (() => void) | undefined;
    if (isTauriEnvironment()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("request-close-action", handleOpen).then((un) => {
          unlisten = un;
        });
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener("netbox-request-close", handleOpen);
      window.removeEventListener("request-close-action", handleOpen);
      if (unlisten) unlisten();
    };
  }, []);

  const handleClose = () => {
    if (controlledOnClose) {
      controlledOnClose();
    } else {
      setInternalOpen(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedAction("minimize");
      setRememberChoice(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // 键盘快捷键监听: Escape 取消，Enter 提交
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedAction, rememberChoice, isSubmitting]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await windowExecuteClose(selectedAction, rememberChoice);
      handleClose();
    } catch (err) {
      console.error("执行窗口关闭失败:", err);
      setIsSubmitting(false);
    }
  };

  const handleDoubleClickAction = async (action: "minimize" | "exit") => {
    if (isSubmitting) return;
    setSelectedAction(action);
    setIsSubmitting(true);
    try {
      await windowExecuteClose(action, rememberChoice);
      handleClose();
    } catch (err) {
      console.error("执行窗口关闭失败:", err);
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="workbench-dialog-backdrop fixed inset-0 z-[var(--z-modal,9999)] flex items-center justify-center p-4 font-sans select-none"
      onClick={handleClose}
    >
      <div
        className="workbench-dialog flex max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col space-y-4 overflow-auto p-5 text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="关闭 ProcWeaver"
      >
        {/* 顶部标题栏与关闭叉号 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
                关闭 ProcWeaver
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                请选择点击关闭窗口时的执行动作
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
              aria-label="关闭对话框"
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 选项组 */}
        <div className="grid grid-cols-1 gap-2.5 pt-1">
          {/* 选项 1：最小化到托盘 */}
          <div
            onClick={() => setSelectedAction("minimize")}
            onDoubleClick={() => handleDoubleClickAction("minimize")}
            className={`
              relative p-3 rounded-xl border cursor-pointer transition-all duration-120 flex items-center gap-3
              ${
                selectedAction === "minimize"
                  ? "bg-blue-500/10 border-blue-500/40 text-[var(--text-primary)] shadow-xs"
                  : "bg-[var(--glass-bg-subtle)] border-[var(--glass-border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)]"
              }
            `}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                selectedAction === "minimize"
                  ? "bg-blue-500 text-white border-blue-400"
                  : "bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--text-muted)]"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium text-[var(--text-primary)]">
                  最小化到系统托盘
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-500 font-mono font-medium border border-blue-500/20">
                  推荐
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                保持后台网络分流与规则代理继续运行
              </div>
            </div>
          </div>

          {/* 选项 2：彻底退出应用 */}
          <div
            onClick={() => setSelectedAction("exit")}
            onDoubleClick={() => handleDoubleClickAction("exit")}
            className={`
              relative p-3 rounded-xl border cursor-pointer transition-all duration-120 flex items-center gap-3
              ${
                selectedAction === "exit"
                  ? "bg-rose-500/10 border-rose-500/40 text-[var(--text-primary)] shadow-xs"
                  : "bg-[var(--glass-bg-subtle)] border-[var(--glass-border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)]"
              }
            `}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                selectedAction === "exit"
                  ? "bg-rose-500 text-white border-rose-400"
                  : "bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--text-muted)]"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[var(--text-primary)]">
                彻底退出 ProcWeaver
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                断开全部连接，关闭内核并释放全部系统资源
              </div>
            </div>
          </div>
        </div>

        {/* 记住选择勾选框 */}
        <div className="flex items-center justify-between pt-1 px-1">
          <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-[var(--glass-border)] text-blue-500 focus:ring-blue-500 focus:ring-offset-0 bg-transparent"
            />
            <span>记住我的选择，下次不再提示</span>
          </label>
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border-subtle)]">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 rounded-xl text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border-subtle)] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`px-4 py-1.5 rounded-xl text-[12px] font-medium text-white transition-all shadow-xs flex items-center gap-1.5 ${
              selectedAction === "exit"
                ? "bg-rose-600 hover:bg-rose-500 border border-rose-500/40"
                : "bg-blue-600 hover:bg-blue-500 border border-blue-500/40"
            }`}
          >
            {isSubmitting && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            <span>确定</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
