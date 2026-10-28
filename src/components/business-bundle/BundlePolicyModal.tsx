import React, { useState, useEffect } from "react";
import type { BundleLocalInstance, BundlePolicy } from "../../types/businessBundle";
import { defaultBundlePolicy, normalizeBundlePolicy } from "../../utils/bundlePolicy";
import { Shield, RotateCcw, Check, X } from "lucide-react";
import { BundlePolicyForm } from "./BundlePolicyForm";

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>接管与网络防护策略</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full bg-slate-200/60 dark:bg-slate-800">
                  {def.packageName}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                精细控制该套件的协议捕获、DNS解析模式与过滤规则，策略独立生效
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 主体设置表单 */}
        <div className="flex-1 overflow-y-auto p-6">
          <BundlePolicyForm
            policy={policy}
            onChange={setPolicy}
            isHttpUpstream={isHttpUpstream}
          />
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置为推荐标准策略</span>
          </button>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>保存策略</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
