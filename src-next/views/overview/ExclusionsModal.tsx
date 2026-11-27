// ==========================================================================
// ProcWeaver src-next 排除代理名单配置弹窗 (Feature 9)
// ==========================================================================

import React, { useEffect, useState } from "react";
import { Modal } from "../../primitives/Modal";
import { Button } from "../../primitives/Button";
import { getBypassList } from "../../services/settingsService";

interface ExclusionsModalProps {
  onClose: () => void;
  onLoad: (list: string[]) => void;
  onSave: (newList: string[]) => Promise<void>;
}

export const ExclusionsModal: React.FC<ExclusionsModalProps> = ({
  onClose,
  onLoad,
  onSave,
}) => {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const items = (text ?? "").split("\n").map((item) => item.trim()).filter(Boolean);

  useEffect(() => {
    let active = true;
    void getBypassList().then((list) => {
      if (!active) return;
      setText(list.join("\n"));
      onLoad(list);
    }, (cause) => {
      if (active) setError("读取排除名单失败，" + (cause instanceof Error ? cause.message : String(cause)));
    });
    return () => { active = false; };
  }, [onLoad]);

  const handleClose = () => {
    if (!saving) onClose();
  };

  const handleSave = async () => {
    if (text === null || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(items);
      onClose();
    } catch (cause) {
      setError("保存排除名单失败，" + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={handleClose} title="排除代理名单 (Bypass Exclusions)">
      <div className="space-y-3">
        <p className="text-[12px] text-[var(--text-muted)]">
          配置直连绕过代理的域名后缀、局域网网段或 IP 地址，每行一条规则：
        </p>

        <textarea
          rows={7}
          value={text ?? ""}
          onChange={(e) => setText(e.target.value)}
          disabled={text === null || saving}
          aria-label="排除规则"
          placeholder={text === null ? undefined : "例如：\n*.cn\n10.0.0.0/8\n192.168.0.0/16\nlocalhost"}
          className="w-full rounded-lg p-3 text-[12px] font-mono leading-relaxed bg-black/[0.04] dark:bg-white/[0.03] border border-[var(--glass-border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-white/30 resize-none transition-colors"
        />

        {error && <p role="alert" className="workbench-setting-feedback">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-[var(--text-muted)] font-mono" aria-live="polite">
            {text !== null ? `${items.length} 条规则` : error ? "" : "正在读取排除名单…"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={handleClose}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={text === null} loading={saving} onClick={handleSave}>
              保存并应用
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
