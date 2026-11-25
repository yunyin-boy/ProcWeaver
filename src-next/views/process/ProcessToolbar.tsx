import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Package, Plus, Search, ShieldAlert, Upload } from "lucide-react";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import {
  ProcessRoutingState,
  ProcessTrafficDriver,
  PROCESS_DRIVER_OPTIONS,
} from "../../types/processRouting";

export type ProcessSubTab = "bundles" | "rules" | "live";

interface ProcessToolbarProps {
  currentSubTab: ProcessSubTab;
  onSelectSubTab: (tab: ProcessSubTab) => void;
  state: ProcessRoutingState;
  bundleCount: number;
  ruleCount: number;
  liveCount: number;
  onToggleMaster: () => void;
  onSwitchDriver: (driver: ProcessTrafficDriver) => Promise<void>;
  onElevateAdmin: () => Promise<void>;
  isPending: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAddModal: () => void;
  onImportBundle?: (file: File) => void;
  onOpenGithubModal?: () => void;
}

export const ProcessToolbar: React.FC<ProcessToolbarProps> = ({
  currentSubTab,
  onSelectSubTab,
  state,
  bundleCount,
  ruleCount,
  liveCount,
  onToggleMaster,
  onSwitchDriver,
  onElevateAdmin,
  isPending,
  searchQuery,
  onSearchChange,
  onOpenAddModal,
  onImportBundle,
  onOpenGithubModal,
}) => {
  const [driverDropdownOpen, setDriverDropdownOpen] = useState(false);
  const [isSwitchingDriver, setIsSwitchingDriver] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 外部点击自动收起下拉面板
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDriverDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDriverDropdownOpen(false);
    };
    if (driverDropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [driverDropdownOpen]);

  // 当前驱动的配置定义
  const currentOption =
    PROCESS_DRIVER_OPTIONS.find((opt) => opt.id === state.engineMode) ||
    PROCESS_DRIVER_OPTIONS[0];

  const handleSelectDriver = async (driverId: ProcessTrafficDriver) => {
    if (driverId === state.engineMode || isSwitchingDriver) {
      setDriverDropdownOpen(false);
      return;
    }
    setIsSwitchingDriver(true);
    try {
      await onSwitchDriver(driverId);
    } finally {
      setIsSwitchingDriver(false);
      setDriverDropdownOpen(false);
    }
  };

  const handleElevate = async () => {
    try {
      await onElevateAdmin();
    } catch (e) {
      console.error("提权启动失败:", e);
    }
  };

  const needsElevation = state.engineMode === "windivert_v1" && !state.isAdmin;
  const captureLabel = isPending
    ? "切换中…"
    : !state.processEnabled
      ? "已暂停"
      : state.driverActive ? "已就绪" : "待就绪";
  const tabs: { id: ProcessSubTab; label: string; count: number }[] = [
    { id: "bundles", label: "业务规则包", count: bundleCount },
    { id: "rules", label: "自定义进程", count: ruleCount },
    { id: "live", label: "运行进程", count: liveCount },
  ];
  const searchLabel = {
    bundles: "搜索业务套件或进程",
    rules: "搜索进程规则或路径",
    live: "搜索运行进程",
  }[currentSubTab];

  return (
    <section className="workbench-panel relative z-20 grid gap-3.5 p-4" aria-label="进程分流控制">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-x-5 gap-y-2.5">
          <div className="workbench-control-row">
            <div>
              <p>进程捕获</p>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={state.processEnabled && state.driverActive ? "!text-[var(--workbench-positive)]" : ""}>{captureLabel}</span>
                <span className="tabular-nums">{state.matchedProcessCount} 个匹配进程</span>
              </div>
            </div>
            <CapsuleToggle
              checked={state.processEnabled}
              disabled={isPending}
              title="进程分流总开关"
              onChange={onToggleMaster}
            />
          </div>

          <div className="relative grid min-w-0 gap-0.5" ref={dropdownRef}>
            <span className="text-[11px] text-[var(--text-muted)]">捕获方式</span>
            <button
              type="button"
              className="workbench-action justify-between text-left"
              onClick={() => setDriverDropdownOpen(!driverDropdownOpen)}
              disabled={isSwitchingDriver}
              aria-expanded={driverDropdownOpen}
              aria-label={"捕获方式 " + currentOption.title}
            >
              <span>{currentOption.title} · {currentOption.subLabel}</span>
              <ChevronDown size={14} aria-hidden="true" className={driverDropdownOpen ? "rotate-180 shrink-0" : "shrink-0"} />
            </button>
            {driverDropdownOpen && (
              <div className="workbench-menu workbench-driver-menu absolute left-0 top-full z-50 mt-1.5 grid gap-1 rounded-xl p-1.5">
                {PROCESS_DRIVER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelectDriver(option.id)}
                    aria-pressed={option.id === state.engineMode}
                    className={"grid w-full gap-1 rounded-lg p-2 text-left hover:bg-[var(--workbench-control)] " + (option.id === state.engineMode ? "bg-[var(--workbench-selected)]" : "")}
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                      {option.title}
                      <span className="workbench-tag">{option.tag}</span>
                      {option.requiresAdmin && !state.isAdmin && <span className="workbench-tag workbench-tag-warning">需管理员</span>}
                      {option.id === state.engineMode && <Check size={14} className="text-[var(--workbench-accent)]" aria-hidden="true" />}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">{option.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {needsElevation && (
            <button
              type="button"
              className="workbench-action workbench-action-warning"
              onClick={handleElevate}
              title="WinDivert 驱动需要管理员权限"
            >
              <ShieldAlert size={14} aria-hidden="true" /> UAC 提权
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="file"
            ref={fileInputRef}
            accept=".json,.pwpack.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && onImportBundle) onImportBundle(file);
              event.target.value = "";
            }}
          />
          {currentSubTab === "bundles" && onOpenGithubModal && (
            <button type="button" className="workbench-action" onClick={onOpenGithubModal}>
              <Package size={14} aria-hidden="true" /> GitHub 业务包
            </button>
          )}
          {currentSubTab === "bundles" && onImportBundle && (
            <button type="button" className="workbench-action" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} aria-hidden="true" /> 导入规则包
            </button>
          )}
          <button type="button" className="workbench-action workbench-action-primary" onClick={onOpenAddModal}>
            <Plus size={14} aria-hidden="true" /> {currentSubTab === "bundles" ? "新建业务套件" : "添加进程规则"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="workbench-segments workbench-process-tabs" role="group" aria-label="进程分流视图">
          {tabs.map(({ id, label, count }) => (
            <button type="button" key={id} aria-pressed={currentSubTab === id} onClick={() => onSelectSubTab(id)}>
              {label} <span className="tabular-nums">{count}</span>
            </button>
          ))}
        </div>
        <div className="workbench-field flex min-w-[min(100%,175px)] flex-1 items-center gap-2 px-2.5">
          <Search size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={searchLabel}
            placeholder={searchLabel}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px]"
          />
        </div>
      </div>
    </section>
  );
};
