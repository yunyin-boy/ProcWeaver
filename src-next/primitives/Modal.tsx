// ==========================================================================
// ProcWeaver src-next 模态浮窗基座
// 规范溯源: ui-surface-elevation-hierarchy (--z-modal 标尺与 isolation 沙箱)
// ==========================================================================

import React, { useEffect, useId } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  wide = false,
  children,
}) => {
  const titleId = useId();
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 isolate">
      {/* 磨砂暗化高斯遮罩 */}
      <div
        onClick={onClose}
        className="workbench-dialog-backdrop absolute inset-0 transition-opacity duration-150"
      />

      <div
        className={`workbench-dialog relative w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 ${wide ? "max-w-3xl" : "max-w-lg"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="workbench-panel-title [overflow-wrap:anywhere] text-[var(--text-primary)]">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-[11px] leading-relaxed [overflow-wrap:anywhere] text-[var(--text-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="workbench-title-button shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor">
              <path d="M2 2L10 10M10 2L2 10" strokeWidth="1.2" />
            </svg>
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
};
