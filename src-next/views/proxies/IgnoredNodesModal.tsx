// ==========================================================================
// ProcWeaver src-next 已忽略/隐藏节点管理弹窗
// 规范溯源: tauri-linear-raycast-ui / taste-skill
// ==========================================================================

import React, { useState, useEffect } from "react";
import { Modal } from "../../primitives/Modal";
import { getIgnoredNodes, toggleIgnoreNode, clearIgnoredNodes } from "../../services/proxyService";

interface IgnoredNodesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIgnoredUpdated: () => void;
  onShowNotice?: (msg: string) => void;
}

export const IgnoredNodesModal: React.FC<IgnoredNodesModalProps> = ({
  isOpen,
  onClose,
  onIgnoredUpdated,
  onShowNotice,
}) => {
  const [ignoredList, setIgnoredList] = useState<string[]>([]);

  const reload = () => {
    setIgnoredList(Array.from(getIgnoredNodes()));
  };

  useEffect(() => {
    if (isOpen) {
      reload();
    }
  }, [isOpen]);

  const handleRestoreSingle = (name: string) => {
    toggleIgnoreNode(name);
    reload();
    if (onShowNotice) onShowNotice(`已恢复显示节点: ${name}`);
    onIgnoredUpdated();
  };

  const handleRestoreAll = () => {
    clearIgnoredNodes();
    reload();
    if (onShowNotice) onShowNotice("已恢复所有被隐藏的节点");
    onIgnoredUpdated();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="已忽略/隐藏的节点管理"
      subtitle="在此查看被您手动收起的节点，可随时一键恢复到大盘视图"
    >
      <div className="space-y-4 pt-1 text-left">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>被隐藏节点总数: {ignoredList.length}</span>
          {ignoredList.length > 0 && (
            <button
              type="button"
              onClick={handleRestoreAll}
              className="text-blue-500 hover:text-blue-400 font-medium transition-colors"
            >
              全部解除隐藏
            </button>
          )}
        </div>

        {ignoredList.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--text-muted)] glass-surface rounded-xl border border-[var(--glass-border-subtle)]">
            当前没有隐藏任何节点
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
            {ignoredList.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between px-3 py-2 rounded-xl border border-[var(--glass-border-subtle)] glass-surface text-xs"
              >
                <span className="font-medium truncate text-[var(--text-primary)] pr-2">
                  {name}
                </span>

                <button
                  type="button"
                  onClick={() => handleRestoreSingle(name)}
                  className="px-2 py-1 rounded text-blue-500 hover:bg-blue-500/10 transition-colors text-xs shrink-0"
                >
                  恢复显示
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
