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
  const variantStyles = {
    primary: "workbench-action-primary",
    secondary: "",
    danger: "workbench-action-danger",
    ghost: "workbench-action-ghost",
  }[variant];

  return (
    <button
      disabled={disabled || loading}
      data-size={size}
      className={`
        workbench-action
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
