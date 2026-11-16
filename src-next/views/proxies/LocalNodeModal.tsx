// ==========================================================================
// ProcWeaver src-next 本地自建 VPS 节点管理弹窗
// 规范溯源: tauri-linear-raycast-ui / taste-skill
// ==========================================================================

import React, { useState, useEffect } from "react";
import { Modal } from "../../primitives/Modal";
import { LocalCustomNode } from "../../types/proxy";
import {
  getLocalCustomNodes,
  addLocalCustomNode,
  deleteLocalCustomNode,
} from "../../services/proxyService";

interface LocalNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNodesUpdated: () => void;
  onShowNotice?: (msg: string) => void;
}

export const LocalNodeModal: React.FC<LocalNodeModalProps> = ({
  isOpen,
  onClose,
  onNodesUpdated,
  onShowNotice,
}) => {
  const [nodes, setNodes] = useState<LocalCustomNode[]>([]);
  const [rawLink, setRawLink] = useState("");
  const [alias, setAlias] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reloadNodes = () => {
    setNodes(getLocalCustomNodes());
  };

  useEffect(() => {
    if (isOpen) {
      reloadNodes();
      setRawLink("");
      setAlias("");
      setErrorMsg(null);
    }
  }, [isOpen]);

  const handleAdd = () => {
    const link = rawLink.trim();
    if (!link) {
      setErrorMsg("请粘贴有效的节点分享链接");
      return;
    }

    if (!/^(hysteria2|hy2|vless|vmess|trojan|ss|wireguard):\/\//i.test(link)) {
      setErrorMsg("目前仅支持 hysteria2 / vless / vmess / trojan / ss 协议链接");
      return;
    }

    const newNode = addLocalCustomNode(link, alias.trim() || undefined);
    reloadNodes();
    setRawLink("");
    setAlias("");
    setErrorMsg(null);
    if (onShowNotice) onShowNotice(`已成功添加自建节点: ${newNode.alias}`);
    onNodesUpdated();
  };

  const handleDelete = (id: string, nodeAlias: string) => {
    deleteLocalCustomNode(id);
    reloadNodes();
    if (onShowNotice) onShowNotice(`已删除自建节点: ${nodeAlias}`);
    onNodesUpdated();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="本地自建 VPS 节点管理"
      subtitle="手动导入或维护自建节点，自建节点在订阅更新时永远保留"
    >
      <div className="space-y-4 pt-1 text-left">
        {/* 新增节点表单 */}
        <div className="p-3.5 rounded-xl border border-[var(--glass-border-subtle)] glass-surface space-y-2.5">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            导入新自建节点
          </div>

          <input
            type="text"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="自定义节点别名 (选填，默认从链接标签提取)"
            className="w-full px-3 py-1.5 text-xs rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />

          <textarea
            value={rawLink}
            onChange={(e) => {
              setRawLink(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            rows={2}
            placeholder="在此粘贴节点分享链接 (支持 hysteria2://、vless://、trojan://、ss:// 等)..."
            className="w-full px-3 py-1.5 text-xs rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono resize-none"
          />

          {errorMsg && (
            <div className="text-[11px] text-rose-500 font-medium">
              ⚠ {errorMsg}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAdd}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white transition-all shadow-sm active:scale-95"
            >
              解析并导入节点
            </button>
          </div>
        </div>

        {/* 已有自建节点列表 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--text-secondary)] flex items-center justify-between">
            <span>已有自建节点列表</span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              共 {nodes.length} 个
            </span>
          </div>

          {nodes.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)] glass-surface rounded-xl border border-[var(--glass-border-subtle)]">
              暂未添加任何本地自建节点
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
              {nodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center justify-between px-3 py-2 rounded-xl border border-[var(--glass-border-subtle)] glass-surface text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
                      {node.protocol}
                    </span>
                    <span className="font-medium truncate text-[var(--text-primary)]">
                      {node.alias}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDelete(node.id, node.alias)}
                    className="text-zinc-400 hover:text-rose-500 transition-colors text-xs px-2 py-1 rounded"
                    title="删除该自建节点"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
