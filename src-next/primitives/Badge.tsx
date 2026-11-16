// ==========================================================================
// ProcWeaver src-next 状态徽章与快捷键标签
// 规范溯源: taste-skill / tauri-desktop-layout-typography
// ==========================================================================

import React from "react";

interface StatusBadgeProps {
  status: "healthy" | "warning" | "error" | "inactive";
  label?: string;
  className?: string;
  onClick?: () => void;
  title?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  className = "",
  onClick,
  title,
}) => {
  const dotColor = {
    healthy: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
    warning: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]",
    error: "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]",
    inactive: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]",
  }[status];

  const Comp = onClick ? "button" : "span";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium tracking-tight bg-[var(--surface-hover)] border border-[var(--border-subtle)] transition-all ${
        onClick
          ? "cursor-pointer hover:border-blue-500/40 hover:bg-black/10 dark:hover:bg-white/10 active:scale-95"
          : ""
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label && <span className="text-[var(--text-secondary)]">{label}</span>}
    </Comp>
  );
};

interface KbdBadgeProps {
  keys: string[];
  className?: string;
}

export const KbdBadge: React.FC<KbdBadgeProps> = ({ keys, className = "" }) => {
  return (
    <kbd
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium text-[var(--text-muted)] bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded shadow-sm ${className}`}
    >
      {keys.map((k, idx) => (
        <span key={idx}>{k}</span>
      ))}
    </kbd>
  );
};
