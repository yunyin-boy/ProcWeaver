// ==========================================================================
// ProcWeaver src-next 真实物理级双层毛玻璃卡片
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// ==========================================================================

import React from "react";

interface GlassCardProps {
  children: React.ReactNode;
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  interactive = false,
  onClick,
  className = "",
}) => {
  return (
    <div
      onClick={onClick}
      className={`
        relative isolate rounded-xl glass-surface
        ${
          interactive
            ? "glass-surface-hover cursor-pointer active:scale-[0.99] active:translate-y-[0.5px]"
            : ""
        }
        ${className}
      `}
    >
      {children}
    </div>
  );
};
