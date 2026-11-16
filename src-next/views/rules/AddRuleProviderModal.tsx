// ==========================================================================
// ProcWeaver src-next 添加外部规则集模态弹窗 (Add Rule Provider Modal)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 风格约束: 严禁任何 Emoji，双列紧凑，无断字折行
// ==========================================================================

import React, { useState } from "react";
import { RuleProviderItem } from "../../types/rules";
import { CustomSelect } from "../../primitives/CustomSelect";

interface AddRuleProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (provider: Omit<RuleProviderItem, "ruleCount">) => Promise<void>;
}

export const AddRuleProviderModal: React.FC<AddRuleProviderModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [behavior, setBehavior] = useState<"domain" | "ipcidr" | "classical">("domain");
  const [format, setFormat] = useState<"mrs" | "yaml" | "text">("mrs");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setFormError("规则集名称和订阅 URL 不能为空");
      return;
    }
    setFormError(null);

    setIsSaving(true);
    try {
      await onAdd({
        name: name.trim(),
        url: url.trim(),
        behavior,
        format,
        type: "Rule",
        vehicleType: "HTTP",
      });
      setName("");
      setUrl("");
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-[460px] rounded-2xl glass-surface border border-[var(--glass-border-medium)] shadow-2xl p-4 sm:p-5 text-left flex flex-col gap-3">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                添加自定义外部规则集
              </h3>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                接入开源或自建规则订阅，由内核按策略差分拉取并解析
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs animate-in fade-in duration-150">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{formError}</span>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
              规则集名称 / 标识
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: custom-direct-rules"
              className="w-full h-8 px-2.5 text-xs font-mono rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
              规则订阅 URL 地址
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/.../rules.mrs"
              className="w-full h-8 px-2.5 text-xs font-mono rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)]"
            />
          </div>

          {/* 行为模式与格式双列并排 */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                行为模式 (Behavior)
              </label>
              <CustomSelect
                value={behavior}
                onChange={(val) => setBehavior(val as any)}
                options={[
                  { value: "domain", label: "domain (纯域名集)" },
                  { value: "ipcidr", label: "ipcidr (IP网段集)" },
                  { value: "classical", label: "classical (综合规则集)" },
                ]}
                size="md"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                存储格式 (Format)
              </label>
              <CustomSelect
                value={format}
                onChange={(val) => setFormat(val as any)}
                options={[
                  { value: "mrs", label: "mrs (高性能二进制)" },
                  { value: "yaml", label: "yaml (文本标准)" },
                  { value: "text", label: "text (逐行纯文本)" },
                ]}
                size="md"
              />
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-1 text-xs font-semibold rounded-xl border border-[var(--glass-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)] transition-all cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-1 text-xs font-semibold rounded-xl bg-blue-500 hover:bg-blue-600 active:scale-95 text-white transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? "保存中..." : "保存并启用"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
