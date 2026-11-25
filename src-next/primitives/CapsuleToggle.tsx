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
      aria-label={title}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="workbench-switch"
    >
      <span aria-hidden="true" />
    </button>
  );
};
