import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Zap, Clock, ShieldAlert, X } from "lucide-react";
import type { BundleLocalInstance } from "../../types/businessBundle";

export interface StaleTcpConnectionItem {
  pid: u32;
  processName: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
}

type u32 = number;

interface Props {
  isOpen: boolean;
  instance: BundleLocalInstance | null;
  connections: StaleTcpConnectionItem[];
  onConfirmReset: (rememberChoice: boolean) => void;
  onIgnore: () => void;
  onClose: () => void;
}

export const StaleConnectionsModal: React.FC<Props> = ({
  isOpen,
  instance,
  connections,
  onConfirmReset,
  onIgnore,
  onClose,
}) => {
  const [remember, setRemember] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  if (!isOpen || !instance) return null;

  const def = instance.definition;

  // 聚合进程与连接数
  const processMap = new Map<string, { pid: number; name: string; count: number }>();
  for (const c of connections) {
    const key = `${c.processName}_${c.pid}`;
    const existing = processMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      processMap.set(key, { pid: c.pid, name: c.processName, count: 1 });
    }
  }
  const processList = Array.from(processMap.values());

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await onConfirmReset(remember);
    } finally {
      setIsResetting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans animate-in fade-in duration-150"
      data-no-drag
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>存量直连通道热刷新提示</span>
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 px-1.5 py-0.2 rounded-full bg-slate-200/60 dark:bg-slate-800">
                  {def.packageName}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                检测到该规则包管辖的目标应用已存在直连长连接
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              发现以下进程存在存量直连连接（共 {connections.length} 条）：
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
              {processList.map((p) => (
                <div
                  key={`${p.name}_${p.pid}`}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/40 text-xs"
                >
                  <div className="flex items-center gap-2 font-mono text-slate-800 dark:text-slate-200 truncate">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-[10px] text-slate-400">(PID: {p.pid})</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                    {p.count} 条直连长连接
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            <strong className="text-slate-700 dark:text-slate-200">ℹ️ 原理解释：</strong>
            受 TCP 协议状态机限制，分流开启前已建立的长连接无法中途转向新代理。执行微秒热刷新将释放旧连接，<strong>无需关闭应用</strong>，应用将在 0.1 秒内自动重连切入代理。
          </div>

          {/* 勾选框 */}
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600"
            />
            <span>记住此规则包选择，下次切换出口时自动热刷新</span>
          </label>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onIgnore}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>稍后处理 (仅新连接生效)</span>
          </button>
          <button
            type="button"
            disabled={isResetting}
            onClick={handleReset}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{isResetting ? "正在重置..." : "立即微秒热刷新 (推荐)"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
