// ==========================================================================
// ProcWeaver src-next 订阅源快速切换抽屉
// 规范溯源: tauri-linear-raycast-ui / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useEffect } from "react";
import { Modal } from "../../primitives/Modal";
import { ProfileItem } from "../../types/proxy";
import { fetchProfiles, switchProfile } from "../../services/proxyService";

interface ProfileSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileSwitched: () => void;
  onShowNotice?: (msg: string) => void;
}

export const ProfileSwitchModal: React.FC<ProfileSwitchModalProps> = ({
  isOpen,
  onClose,
  onProfileSwitched,
  onShowNotice,
}) => {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchProfiles().then(setProfiles);
    }
  }, [isOpen]);

  const handleSelect = async (profile: ProfileItem) => {
    if (profile.active || switchingId) return;
    setSwitchingId(profile.id);

    try {
      await switchProfile(profile.id);
      if (onShowNotice) onShowNotice(`已切换激活订阅: ${profile.name}`);
      onProfileSwitched();
      onClose();
    } finally {
      setSwitchingId(null);
    }
  };

  const formatGb = (bytes?: number) => {
    if (!bytes) return "0 GB";
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="切换当前订阅源配置"
      subtitle="即时流转不同机场节点矩阵，切换后自动重新载入大盘"
    >
      <div className="space-y-3 pt-2">
        {profiles.map((p) => {
          const used = p.usedBytes || 0;
          const total = p.totalBytes || 1;
          const pct = Math.min(100, Math.round((used / total) * 100));

          return (
            <div
              key={p.id}
              onClick={() => handleSelect(p)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none text-left ${
                p.active
                  ? "bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_16px_rgba(16,185,129,0.12)]"
                  : "glass-surface border-[var(--glass-border-subtle)] hover:border-blue-500/40 hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {/* 顶栏：名称 + 激活指示 */}
              <div className="flex items-center justify-between pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-[var(--text-primary)]">
                    {p.name}
                  </span>
                  {p.active && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-500 border border-emerald-500/30">
                      当前生效
                    </span>
                  )}
                </div>
                {p.nodeCount !== undefined && (
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    {p.nodeCount} 个节点
                  </span>
                )}
              </div>

              {/* 流量使用进度条 */}
              {p.totalBytes && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                    <span>已用 {formatGb(p.usedBytes)} / {formatGb(p.totalBytes)}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 底栏：更新时间 */}
              {p.updatedAt && (
                <div className="mt-2 pt-1.5 border-t border-[var(--glass-border-subtle)] text-[10px] text-[var(--text-muted)] flex items-center justify-between">
                  <span>最近同步: {p.updatedAt}</span>
                  {p.active ? (
                    <span className="text-emerald-500 font-semibold text-[11px]">✓ 正在使用</span>
                  ) : (
                    <span className="text-blue-500 text-[11px]">点击切换 ➔</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
