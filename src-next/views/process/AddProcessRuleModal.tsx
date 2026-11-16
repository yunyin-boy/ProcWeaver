// ==========================================================================
// ProcWeaver src-next 添加自定义进程规则模态弹窗
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useMemo } from "react";
import { Modal } from "../../primitives/Modal";
import { ProcessRuleItem, ProcessMatchKind, ProcessRuleAction } from "../../types/processRouting";
import { chooseExecutableFile, cleanProxyOptions } from "../../services/processRoutingService";
import { RunningProcessPickerModal } from "./RunningProcessPickerModal";
import { ConsolidatedProcess } from "../../services/processDiscoveryService";
import { CustomSelect } from "../../primitives/CustomSelect";

interface AddProcessRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddRule: (rule: Omit<ProcessRuleItem, "id" | "createdAt">) => void;
  availableProxies: string[];
}

export const AddProcessRuleModal: React.FC<AddProcessRuleModalProps> = ({
  isOpen,
  onClose,
  onAddRule,
  availableProxies,
}) => {
  const [label, setLabel] = useState("");
  const [matchKind, setMatchKind] = useState<ProcessMatchKind>("process-name");
  const [matchValue, setMatchValue] = useState("");
  const [action, setAction] = useState<ProcessRuleAction>("proxy");
  const [targetProxy, setTargetProxy] = useState(availableProxies[0] || "Proxy");
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [showProcessPicker, setShowProcessPicker] = useState(false);

  // 清洗并丰富代理选项 (杜绝保留字)
  const cleanOptions = useMemo(() => {
    return cleanProxyOptions(availableProxies);
  }, [availableProxies]);

  const handleSelectRunningProcess = (proc: ConsolidatedProcess) => {
    if (proc.path) {
      setMatchKind("process-path");
      setMatchValue(proc.path);
    } else {
      setMatchKind("process-name");
      setMatchValue(proc.name);
    }
    setLabel(proc.friendlyName || proc.name);
    setIncludeDescendants(true);
    setShowProcessPicker(false);
  };

  const handleBrowseExe = async () => {
    try {
      const filePath = await chooseExecutableFile();
      if (filePath) {
        setMatchKind("process-path");
        setMatchValue(filePath);
        if (!label) {
          const fileName = filePath.split(/[/\\]/).pop() || "";
          setLabel(fileName);
        }
      }
    } catch (err) {
      console.warn("浏览文件失败:", err);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchValue.trim()) return;

    onAddRule({
      enabled: true,
      label: label.trim() || matchValue.trim(),
      matchKind,
      matchValue: matchValue.trim(),
      action,
      targetProxy: action === "proxy" ? targetProxy : undefined,
      includeDescendants,
    });

    // 重置并关闭
    setLabel("");
    setMatchValue("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="添加自定义进程规则"
      subtitle="指定应用程序的进程名或路径，精确分配代理出口或直连策略"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {/* 规则显示别名 */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            规则别名 / 应用名称
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如: Google Chrome / Git 客户端"
            className="w-full px-3 py-2 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)]"
          />
        </div>

        {/* 匹配类型与匹配目标 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              匹配方式
            </label>
            <CustomSelect
              value={matchKind}
              onChange={(val) => setMatchKind(val as ProcessMatchKind)}
              options={[
                { value: "process-name", label: "进程文件名" },
                { value: "process-path", label: "完整绝对路径" },
              ]}
              size="md"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                {matchKind === "process-name" ? "进程名 (如 chrome.exe)" : "绝对路径 (如 C:\\App\\app.exe)"}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowProcessPicker(true)}
                  className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  运行中选择
                </button>
                <span className="text-zinc-400">·</span>
                <button
                  type="button"
                  onClick={handleBrowseExe}
                  className="text-[11px] font-medium text-blue-500 hover:text-blue-400 transition-colors cursor-pointer"
                >
                  浏览文件
                </button>
              </div>
            </div>
            <input
              type="text"
              required
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              placeholder={matchKind === "process-name" ? "chrome.exe" : "C:\\Program Files\\App\\app.exe"}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)]"
            />
          </div>
        </div>

        {/* 路由动作选择 */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            路由执行动作
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "proxy", label: "代理分流", desc: "走指定出站节点" },
              { id: "direct", label: "国内直连", desc: "绕过代理直连" },
              { id: "reject", label: "阻断网络", desc: "丢弃网络包" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAction(item.id as ProcessRuleAction)}
                className={`p-2 rounded-xl text-left border transition-all text-xs ${
                  action === item.id
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-500 font-semibold"
                    : "bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <div>{item.label}</div>
                <div className="text-[10px] text-[var(--text-muted)] font-normal mt-0.5">{item.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 当动作为代理分流时：选择代理出口 */}
        {action === "proxy" && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              绑定代理出口
            </label>
            <CustomSelect
              value={targetProxy}
              onChange={setTargetProxy}
              options={cleanOptions}
              placeholder="选择代理出口"
              size="md"
            />
          </div>
        )}

        {/* 子进程递归选项 */}
        <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={includeDescendants}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
            className="rounded border-[var(--glass-border-subtle)] text-blue-500 focus:ring-0"
          />
          <span>递归接管该程序派生的所有子进程 (推荐开启)</span>
        </label>

        {/* 底部动作按钮 */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--glass-border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          >
            取消
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-blue-500 hover:bg-blue-600 text-white shadow-sm transition-all active:scale-95"
          >
            保存并立即生效
          </button>
        </div>
      </form>

      {/* 运行中进程选择器 */}
      <RunningProcessPickerModal
        isOpen={showProcessPicker}
        existingExes={matchValue ? [matchValue] : []}
        onClose={() => setShowProcessPicker(false)}
        onSelect={handleSelectRunningProcess}
      />
    </Modal>
  );
};
