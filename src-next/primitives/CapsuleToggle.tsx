// ==========================================================================
// ProcWeaver src-next 物理微动胶囊开关
// 规范溯源: tauri-linear-raycast-ui (高阻尼微动效)
// ==========================================================================

import React from "react";

interface CapsuleToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}

export const CapsuleToggle: React.FC<CapsuleToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  title,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`
        relative inline-flex items-center h-4 w-7 shrink-0 cursor-pointer rounded-full p-0.5
        transition-colors duration-200 ease-out
        disabled:opacity-40 disabled:cursor-not-allowed
        ${
          checked
            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.35)]"
            : "bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600"
        }
      `}
    >
      <span
        className={`
          pointer-events-none block h-3 w-3 rounded-full bg-white shadow-sm
          transition-transform duration-200 ease-out
          ${checked ? "translate-x-3" : "translate-x-0"}
        `}
      />
    </button>
  );
};
