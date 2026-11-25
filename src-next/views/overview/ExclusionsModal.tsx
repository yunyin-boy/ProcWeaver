// ==========================================================================
// ProcWeaver src-next 排除代理名单配置弹窗 (Feature 9)
// ==========================================================================

import React, { useState } from "react";
import { Modal } from "../../primitives/Modal";
import { Button } from "../../primitives/Button";

interface ExclusionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bypassList: string[];
  onSave: (newList: string[]) => Promise<void>;
}

export const ExclusionsModal: React.FC<ExclusionsModalProps> = ({
  isOpen,
  onClose,
  bypassList,
  onSave,
}) => {
  const [text, setText] = useState(bypassList.join("\n"));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const items = text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await onSave(items);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="排除代理名单 (Bypass Exclusions)">
      <div className="space-y-3">
        <p className="text-[12px] text-[var(--text-muted)]">
          配置直连绕过代理的域名后缀、局域网网段或 IP 地址，每行一条规则：
        </p>

        <textarea
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如:&#10;*.cn&#10;10.0.0.0/8&#10;192.168.0.0/16&#10;localhost"
          className="w-full rounded-lg p-3 text-[12px] font-mono leading-relaxed bg-black/[0.04] dark:bg-white/[0.03] border border-[var(--glass-border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-white/30 resize-none transition-colors"
        />

        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-[var(--text-muted)] font-mono">
            {text.split("\n").filter((l) => l.trim()).length} 条规则
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              保存并应用
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
