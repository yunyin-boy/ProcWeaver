// ==========================================================================
// ProcWeaver src-next 测速目标端点设置弹窗
// 规范溯源: tauri-linear-raycast-ui / taste-skill
// ==========================================================================

import React, { useState, useEffect } from "react";
import { Modal } from "../../primitives/Modal";
import {
  SPEEDTEST_ENDPOINTS,
  getSpeedtestUrl,
  setSpeedtestUrl,
} from "../../services/proxyService";

interface SpeedtestEndpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEndpointChanged: () => void;
  onShowNotice?: (msg: string) => void;
}

export const SpeedtestEndpointModal: React.FC<SpeedtestEndpointModalProps> = ({
  isOpen,
  onClose,
  onEndpointChanged,
  onShowNotice,
}) => {
  const [currentUrl, setCurrentUrl] = useState("");
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    if (isOpen) {
      const u = getSpeedtestUrl();
      setCurrentUrl(u);
      setCustomInput(u);
    }
  }, [isOpen]);

  const handleSelectPreset = (url: string, name: string) => {
    setSpeedtestUrl(url);
    setCurrentUrl(url);
    setCustomInput(url);
    if (onShowNotice) onShowNotice(`测速端点已切换至: ${name}`);
    onEndpointChanged();
    onClose();
  };

  const handleApplyCustom = () => {
    const u = customInput.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://")) {
      return;
    }
    setSpeedtestUrl(u);
    setCurrentUrl(u);
    if (onShowNotice) onShowNotice(`已应用自定义测速端点: ${u}`);
    onEndpointChanged();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="测速目标端点配置"
      subtitle="选择并发测速时请求的目标测试服务器，解决单一目标受限问题"
    >
      <div className="space-y-4 pt-1 text-left">
        {/* 预设列表 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--text-secondary)]">
            标准预设端点
          </div>
          <div className="space-y-1.5">
            {SPEEDTEST_ENDPOINTS.map((ep) => {
              const isSelected = currentUrl === ep.url;
              return (
                <div
                  key={ep.id}
                  onClick={() => handleSelectPreset(ep.url, ep.name)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer select-none text-xs ${
                    isSelected
                      ? "bg-blue-500/10 border-blue-500/40 text-blue-500 dark:text-blue-300 shadow-sm"
                      : "glass-surface border-[var(--glass-border-subtle)] hover:border-blue-500/30 hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between font-medium">
                    <span>{ep.name}</span>
                    {isSelected && <span className="font-bold text-blue-500">✓ 当前生效</span>}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] font-mono truncate mt-0.5">
                    {ep.url}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 自定义端点输入 */}
        <div className="p-3 rounded-xl border border-[var(--glass-border-subtle)] glass-surface space-y-2">
          <div className="text-xs font-semibold text-[var(--text-secondary)]">
            自定义测试 URL (须返回 204/200)
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="https://your-test-domain.com/generate_204"
              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] font-mono"
            />
            <button
              type="button"
              onClick={handleApplyCustom}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white transition-all shrink-0 active:scale-95"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
