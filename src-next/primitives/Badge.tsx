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
  const tone = {
    healthy: "workbench-tag-positive",
    warning: "workbench-tag-warning",
    error: "bg-[var(--workbench-danger-bg)] text-[var(--workbench-danger)]",
    inactive: "",
  }[status];

  const Comp = onClick ? "button" : "span";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`workbench-tag !rounded-full !px-2.5 !py-1 ${tone} ${onClick ? "hover:brightness-95" : ""} ${className}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
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
      className={`workbench-key inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono font-medium ${className}`}
    >
      {keys.map((k, idx) => (
        <span key={idx}>{k}</span>
      ))}
    </kbd>
  );
};
