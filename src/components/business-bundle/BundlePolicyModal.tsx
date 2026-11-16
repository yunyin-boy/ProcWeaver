import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { BundleLocalInstance, BundlePolicy } from "../../types/businessBundle";
import { defaultBundlePolicy, normalizeBundlePolicy } from "../../utils/bundlePolicy";
import { Shield, RotateCcw, Check, X } from "lucide-react";
import { BundlePolicyForm } from "./BundlePolicyForm";
import { usePlatform } from "../../context/PlatformContext";

interface Props {
  isOpen: boolean;
  instance: BundleLocalInstance | null;
  onSave: (policy: BundlePolicy) => void;
  onCancel: () => void;
}

export const BundlePolicyModal: React.FC<Props> = ({
  isOpen,
  instance,
  onSave,
  onCancel,
}) => {
  const platform = usePlatform();
  const [policy, setPolicy] = useState<BundlePolicy>(defaultBundlePolicy());

  useEffect(() => {
    if (instance) {
      setPolicy(normalizeBundlePolicy(instance.policy ?? instance.definition.policy));
    }
  }, [instance, isOpen]);

  if (!isOpen || !instance) return null;

  const def = instance.definition;
  const isHttpUpstream = instance.backend === "external"; // 独立代理可能为 HTTP

  const handleReset = () => {
    setPolicy(defaultBundlePolicy());
  };

  const handleSave = () => {
    onSave(policy);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md font-sans" data-no-drag>
      <div
        className="w-full max-w-xl bg-white/95 dark:bg-[#0d1015]/95 backdrop-blur-2xl rounded-2xl shadow-[-25px_25px_60px_-10px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)] border border-slate-200 dark:border-white/10 flex flex-col overflow-hidden max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-black/30">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/[0.08] text-indigo-600 dark:text-sky-400 flex items-center justify-center text-xl shrink-0 shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                <span>接管与网络防护策略</span>
                <span className="text-xs font-normal text-slate-500 dark:text-zinc-400 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.08]">
                  {def.packageName}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                精细控制该套件的协议捕获、DNS解析模式与过滤规则，策略独立生效
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-white/5 border border-white/10 rounded">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 主体设置表单 */}
        <div className="flex-1 overflow-y-auto p-6">
          <BundlePolicyForm
            policy={policy}
            onChange={setPolicy}
            isHttpUpstream={isHttpUpstream}
            remoteDns={platform.os === "windows" && instance.backend !== "external"}
          />
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-black/40">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置为推荐标准策略</span>
          </button>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-white/[0.08] rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 text-zinc-950" />
              <span>保存策略</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
