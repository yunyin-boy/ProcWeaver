// ==========================================================================
// ProcWeaver src-next 模态浮窗基座
// 规范溯源: ui-surface-elevation-hierarchy (--z-modal 标尺与 isolation 沙箱)
// ==========================================================================

import React, { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
}) => {
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
        className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-xs transition-opacity duration-150"
      />

      {/* 模态卡片主体 (实心纯白扎实底垫，阻断暗色遮罩黑雾穿透，提供高洁文字底衬) */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-[#0f172a] p-6 shadow-2xl border border-slate-200 dark:border-white/10 transition-all duration-180 ease-[var(--ease-out-expo)] animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3.5 border-b border-[var(--glass-border-subtle)]">
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors"
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
