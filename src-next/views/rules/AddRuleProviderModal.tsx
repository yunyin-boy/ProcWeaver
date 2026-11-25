import React, { useId, useState } from "react";
import { Button } from "../../primitives/Button";
import { CustomSelect } from "../../primitives/CustomSelect";
import { Modal } from "../../primitives/Modal";
import type { RuleProviderItem } from "../../types/rules";

interface AddRuleProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (provider: Omit<RuleProviderItem, "ruleCount">) => Promise<void>;
}

export const AddRuleProviderModal: React.FC<AddRuleProviderModalProps> = ({ isOpen, onClose, onAdd }) => {
  const formId = useId();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [behavior, setBehavior] = useState("domain");
  const [format, setFormat] = useState("mrs");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const close = () => {
    if (isSaving) return;
    setFormError("");
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!name.trim() || !url.trim()) {
      setFormError("请输入规则集名称和地址。");
      return;
    }
    if (behavior === "classical" && format === "mrs") {
      setFormError("综合规则集请选择 YAML 或文本格式。");
      return;
    }
    setFormError("");
    setIsSaving(true);
    try {
      await onAdd({ name: name.trim(), url: url.trim(), behavior, format, type: "Rule", vehicleType: "HTTP" });
      setName("");
      setUrl("");
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="添加外部规则集">
      <form onSubmit={handleSubmit} className="grid min-w-0 gap-4">
        <label htmlFor={formId + "-name"} className="grid gap-1.5 text-[13px] font-semibold">
          规则集名称
          <input
            id={formId + "-name"}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isSaving}
            placeholder="例如 custom-direct-rules"
            className="min-h-9 w-full px-3 font-mono text-xs font-normal"
          />
        </label>
        <label htmlFor={formId + "-url"} className="grid gap-1.5 text-[13px] font-semibold">
          规则集地址
          <input
            id={formId + "-url"}
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={isSaving}
            placeholder="https://example.com/rules.mrs"
            className="min-h-9 w-full px-3 font-mono text-xs font-normal"
          />
        </label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-semibold">行为</span>
            <CustomSelect value={behavior} onChange={setBehavior} disabled={isSaving} options={[
              { value: "domain", label: "域名" },
              { value: "ipcidr", label: "IP 网段" },
              { value: "classical", label: "综合规则" },
            ]} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-semibold">格式</span>
            <CustomSelect value={format} onChange={setFormat} disabled={isSaving} options={[
              { value: "mrs", label: "MRS" },
              { value: "yaml", label: "YAML" },
              { value: "text", label: "纯文本" },
            ]} />
          </div>
        </div>
        {formError && <p className="text-xs text-[var(--workbench-danger)]" role="alert">{formError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={isSaving}>取消</Button>
          <Button type="submit" variant="primary" loading={isSaving}>保存规则集</Button>
        </div>
      </form>
    </Modal>
  );
};
