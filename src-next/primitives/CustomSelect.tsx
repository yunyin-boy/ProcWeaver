// ==========================================================================
// ProcWeaver src-next 现代极简毛玻璃下拉选择器 (CustomSelect)
// 规范溯源: tauri-linear-raycast-ui / taste-skill / ui-surface-elevation-hierarchy
// 彻底废除 Windows 原生白灰直角 select，与黑曜石毛玻璃体系无缝融合
// ==========================================================================

import React, { useState, useRef, useEffect, useMemo } from "react";

export interface SelectOption {
  value: string;
  label: string;
  badge?: string;
  description?: string;
}

export interface CustomSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: (string | SelectOption)[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  placement?: "auto" | "top" | "bottom";
  className?: string;
  dropdownClassName?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "请选择...",
  disabled = false,
  size = "md",
  placement = "auto",
  className = "",
  dropdownClassName = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 展开时智能检测弹出方向
  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen) {
      if (placement === "top") {
        setOpenUpward(true);
      } else if (placement === "bottom") {
        setOpenUpward(false);
      } else if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenUpward(spaceBelow < 230);
      }
    }
    setIsOpen(!isOpen);
  };

  // 归一化选项列表
  const normalizedOptions: SelectOption[] = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === "string") {
        return { value: opt, label: opt };
      }
      return opt;
    });
  }, [options]);

  // 找到当前选中的选项对象
  const currentOption = useMemo(() => {
    return normalizedOptions.find((opt) => opt.value === value);
  }, [normalizedOptions, value]);

  // 点击外部收起
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const sizeClasses = {
    sm: "h-7 text-[11px] px-2 rounded-lg gap-1.5",
    md: "h-8 text-xs px-2.5 rounded-xl gap-2",
  }[size];

  const handleSelect = (val: string) => {
    if (disabled) return;
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block w-full text-left ${isOpen ? "z-[100]" : "z-10"} ${className}`}
    >
      {/* 触发器按键 (明亮白瓷与暗曜石双轨光学适配) */}
      <button
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        onClick={toggleOpen}
        className={`
          workbench-picker-trigger w-full flex items-center justify-between
          bg-slate-50/90 hover:bg-white dark:bg-[#141720]/80 dark:hover:bg-[#1a1e28]
          border border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20
          text-slate-800 dark:text-zinc-200
          transition-all duration-150 ease-out
          focus:outline-none
          disabled:opacity-40 disabled:cursor-not-allowed
          cursor-pointer select-none
          ${isOpen ? "border-blue-500 ring-2 ring-blue-500/15 dark:border-blue-500/60 dark:ring-1 dark:ring-blue-500/40" : ""}
          ${sizeClasses}
        `}
      >
        <span className="truncate flex-1 text-left font-medium">
          {currentOption ? currentOption.label : <span className="text-slate-500 dark:text-zinc-400 font-normal">{placeholder}</span>}
        </span>

        {/* 细线箭头 */}
        <svg
          className={`w-3.5 h-3.5 text-slate-500 dark:text-zinc-400 shrink-0 transition-transform duration-200 ease-out ${
            isOpen ? "rotate-180 text-blue-600 dark:text-blue-400" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉浮层 (纯白实心白瓷底垫与黑曜石双轨融合，彻底阻断黑雾穿透与文字融底硬伤) */}
      {isOpen && (
        <div
          className={`
            workbench-menu absolute z-[999] left-0 right-0
            ${openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"}
            bg-white dark:bg-[#0f172a]
            border border-slate-200/90 dark:border-white/15
            rounded-2xl shadow-2xl shadow-slate-900/15 dark:shadow-black/90
            p-1.5 max-h-64 overflow-y-auto
            animate-in fade-in zoom-in-95 duration-100 ease-out
            ${dropdownClassName}
          `}
          style={{
            scrollbarWidth: "thin",
          }}
        >
          {normalizedOptions.length === 0 ? (
            <div className="py-2.5 px-3 text-center text-xs text-slate-500 dark:text-zinc-400">
              暂无可用选项
            </div>
          ) : (
            normalizedOptions.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  className={`
                    w-full flex items-center justify-between
                    px-2.5 py-2 my-0.5 rounded-xl
                    text-xs transition-colors cursor-pointer select-none
                    ${
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-400 font-semibold border border-blue-200/80 dark:border-blue-500/30 shadow-2xs"
                        : "text-slate-700 dark:text-zinc-300 font-medium hover:bg-slate-100/90 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white"
                    }
                  `}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="truncate">{opt.label}</span>
                    {opt.description && (
                      <span className={`text-[10px] font-mono truncate mt-0.5 ${
                        isSelected
                          ? "text-blue-600/80 dark:text-blue-300/80"
                          : "text-slate-500 dark:text-zinc-400"
                      }`}>
                        {opt.description}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {opt.badge && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                        isSelected
                          ? "bg-blue-100 dark:bg-blue-500/25 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-transparent"
                          : "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-zinc-300 border border-slate-200/80 dark:border-transparent"
                      }`}>
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && (
                      <svg
                        className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
