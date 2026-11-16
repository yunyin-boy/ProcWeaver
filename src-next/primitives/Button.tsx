// ==========================================================================
// ProcWeaver src-next 克制操作按钮 (覆盖 4 态)
// 规范溯源: impeccable-design (Craft Floor) / taste-skill
// ==========================================================================

import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  ...props
}) => {
  const sizeStyles = {
    sm: "px-2.5 py-1 text-[12px] gap-1.5",
    md: "px-3.5 py-1.5 text-[13px] gap-2",
    lg: "px-4 py-2 text-[14px] gap-2.5",
  }[size];

  const variantStyles = {
    primary:
      "bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 border border-transparent shadow-sm",
    secondary:
      "bg-[var(--surface-base)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] shadow-[var(--card-shadow)]",
    danger:
      "bg-rose-600/10 text-rose-600 dark:text-rose-400 hover:bg-rose-600/20 border border-rose-500/30",
    ghost:
      "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-transparent",
  }[variant];

  return (
    <button
      disabled={disabled || loading}
      className={`
        relative inline-flex items-center justify-center rounded font-medium
        transition-all duration-120 ease-[var(--ease-out-expo)]
        active:scale-[0.98] active:translate-y-[0.5px]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:translate-y-0
        ${sizeStyles}
        ${variantStyles}
        ${className}
      `}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-3.5 w-3.5 text-current opacity-70"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
};
