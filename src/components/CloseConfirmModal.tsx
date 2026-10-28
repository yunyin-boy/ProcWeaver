import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Minimize2, Power, X, Check, HelpCircle } from "lucide-react";
import { windowExecuteClose, isTauri } from "../api";

export interface CloseConfirmModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  appName?: string;
}

export const CloseConfirmModal: React.FC<CloseConfirmModalProps> = ({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  appName = "ProcWeaver",
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

  const [selectedAction, setSelectedAction] = useState<"minimize" | "exit">("minimize");
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 内部监听关闭请求事件 (用于非受控或直接广播)
  useEffect(() => {
    const handleOpen = () => {
      setInternalOpen(true);
    };

    window.addEventListener("netbox-request-close", handleOpen);
    window.addEventListener("request-close-action", handleOpen);

    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("request-close-action", handleOpen).then((un) => {
          unlisten = un;
        });
      });
    }

    return () => {
      window.removeEventListener("netbox-request-close", handleOpen);
      window.removeEventListener("request-close-action", handleOpen);
      if (unlisten) unlisten();
    };
  }, []);

  const handleClose = () => {
    if (controlledOnClose) {
      controlledOnClose();
    } else {
      setInternalOpen(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedAction("minimize");
      setRememberChoice(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // 键盘快捷键监听
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedAction, rememberChoice, isSubmitting]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await windowExecuteClose(selectedAction, rememberChoice);
      handleClose();
    } catch (err) {
      console.error("执行窗口关闭失败:", err);
      setIsSubmitting(false);
    }
  };

  const handleDoubleClickAction = async (action: "minimize" | "exit") => {
    if (isSubmitting) return;
    setSelectedAction(action);
    setIsSubmitting(true);
    try {
      await windowExecuteClose(action, rememberChoice);
      handleClose();
    } catch (err) {
      console.error("执行窗口关闭失败:", err);
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 font-sans select-none"
      data-tauri-drag-region="false"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col p-5 space-y-4 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题与关闭按钮 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                关闭 {appName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                请选择关闭主窗口时的操作方式
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title="取消"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 选项卡片区域 */}
        <div className="space-y-2.5 pt-1">
          {/* 选项 1: 最小化到系统托盘 */}
          <div
            onClick={() => setSelectedAction("minimize")}
            onDoubleClick={() => handleDoubleClickAction("minimize")}
            className={`flex items-start justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedAction === "minimize"
                ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-100 ring-1 ring-indigo-600 shadow-xs"
                : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300"
            }`}
          >
            <div className="flex items-start space-x-3">
              <div
                className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                  selectedAction === "minimize"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }`}
              >
                <Minimize2 className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    最小化到系统托盘
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                    推荐
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  程序在后台继续守护网络代理与规则防护，可随时从系统托盘图标唤醒主界面。
                </p>
              </div>
            </div>
            <div className="ml-2 shrink-0 pt-1">
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center transition ${
                  selectedAction === "minimize"
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-300 dark:border-slate-700"
                }`}
              >
                {selectedAction === "minimize" && <Check className="w-3 h-3 stroke-[3]" />}
              </div>
            </div>
          </div>

          {/* 选项 2: 完全退出程序 */}
          <div
            onClick={() => setSelectedAction("exit")}
            onDoubleClick={() => handleDoubleClickAction("exit")}
            className={`flex items-start justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedAction === "exit"
                ? "border-rose-500 bg-rose-50/60 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 ring-1 ring-rose-500 shadow-xs"
                : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300"
            }`}
          >
            <div className="flex items-start space-x-3">
              <div
                className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                  selectedAction === "exit"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }`}
              >
                <Power className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    完全退出程序
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  停止核心进程、断开所有代理连接并彻底释放系统资源。
                </p>
              </div>
            </div>
            <div className="ml-2 shrink-0 pt-1">
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center transition ${
                  selectedAction === "exit"
                    ? "border-rose-500 bg-rose-500 text-white"
                    : "border-slate-300 dark:border-slate-700"
                }`}
              >
                {selectedAction === "exit" && <Check className="w-3 h-3 stroke-[3]" />}
              </div>
            </div>
          </div>
        </div>

        {/* 底部复选框：记住我的选择，以后不再提示 */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <label className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>记住我的选择，以后不再提示</span>
          </label>
        </div>

        {/* 底部按钮 */}
        <div className="pt-2 flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium transition cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`px-4 py-1.5 rounded-xl text-white text-xs font-bold transition shadow-xs cursor-pointer flex items-center space-x-1.5 ${
              selectedAction === "exit"
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            <span>{isSubmitting ? "处理中..." : "确定执行"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
