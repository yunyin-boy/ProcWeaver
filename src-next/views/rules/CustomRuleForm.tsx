import { useId, useState, type FormEvent } from "react";
import { Button } from "../../primitives/Button";
import { CustomSelect } from "../../primitives/CustomSelect";
import { Modal } from "../../primitives/Modal";
import type { CustomRule, CustomRuleAction, RuleWorkbenchState } from "../../types/rules";

export type RuleDraft = Omit<CustomRule, "action"> & { action: CustomRuleAction | null };

const MATCH_TYPES = [
  { value: "DOMAIN", label: "完整域名" },
  { value: "DOMAIN-SUFFIX", label: "域名后缀" },
  { value: "DOMAIN-KEYWORD", label: "域名关键词" },
  { value: "IP-CIDR", label: "IPv4 网段" },
  { value: "IP-CIDR6", label: "IPv6 网段" },
  { value: "DST-PORT", label: "目标端口" },
  { value: "RULE-SET", label: "规则集" },
] as const;

const EXAMPLES: Record<string, string> = {
  DOMAIN: "www.example.com",
  "DOMAIN-SUFFIX": "example.com",
  "DOMAIN-KEYWORD": "example",
  "IP-CIDR": "203.0.113.0/24",
  "IP-CIDR6": "2001:db8::/32",
  "DST-PORT": "443 或 8000-8010",
};

function bindingKey(target: RuleWorkbenchState["outlets"][number]["target"]) {
  return [target.profileId, target.kind, target.name].join("\n");
}

interface CustomRuleFormProps {
  title: string;
  context: RuleWorkbenchState;
  initial: RuleDraft;
  saving: boolean;
  apply: boolean;
  onClose: () => void;
  onSave: (rule: CustomRule) => Promise<void>;
}

export function CustomRuleForm({ title, context, initial, saving, apply, onClose, onSave }: CustomRuleFormProps) {
  const inputId = useId();
  const [condition, setCondition] = useState(initial.condition);
  const [action, setAction] = useState(initial.action?.kind ?? "");
  const [allProfiles, setAllProfiles] = useState(initial.profileId === null);
  const [outlet, setOutlet] = useState(initial.action?.kind === "outlet" ? bindingKey(initial.action.target) : "");
  const [error, setError] = useState("");
  const types = MATCH_TYPES.some(({ value }) => value === condition.kind)
    ? [...MATCH_TYPES] : [...MATCH_TYPES, { value: condition.kind, label: condition.kind }];
  const target = context.outlets.find((item) => bindingKey(item.target) === outlet)?.target;
  const noResolve = ["IP-CIDR", "IP-CIDR6", "GEOIP", "IP-ASN", "RULE-SET"].includes(condition.kind);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    let nextAction: CustomRuleAction;
    if (action === "direct" || action === "reject") nextAction = { kind: action };
    else if (action === "outlet" && target) nextAction = { kind: "outlet", target };
    else {
      setError(action === "outlet" ? "请选择当前方案的出口。" : "请选择规则动作。");
      return;
    }
    setError("");
    try {
      await onSave({
        ...initial, action: nextAction,
        profileId: allProfiles && action !== "outlet" ? null : context.profileId,
        condition: { ...condition, value: condition.value.trim() },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <Modal isOpen title={title} onClose={() => { if (!saving) onClose(); }}>
      <form className="grid min-w-0 gap-4" onSubmit={submit}>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div role="group" aria-label="匹配类型" className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-semibold">匹配类型</span>
            <CustomSelect value={condition.kind} options={types} disabled={saving}
              onChange={(kind) => setCondition((current) => ({ ...current, kind, options: [] }))} />
          </div>
          <div role="group" aria-label="规则动作" className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-semibold">动作</span>
            <CustomSelect value={action} placeholder="选择动作" disabled={saving} options={[
              { value: "direct", label: "直连" },
              { value: "reject", label: "拒绝" },
              { value: "outlet", label: "指定出口" },
            ]} onChange={(value) => {
              setAction(value);
              if (value === "outlet") setAllProfiles(false);
            }} />
          </div>
        </div>
        <label className="grid min-w-0 gap-1.5 text-[13px] font-semibold" htmlFor={inputId}>
          匹配条件
          <input id={inputId} autoFocus required maxLength={2048} value={condition.value} disabled={saving}
            className="min-h-9 min-w-0 px-3 font-mono text-xs font-normal"
            placeholder={EXAMPLES[condition.kind]}
            onChange={(event) => setCondition({ ...condition, value: event.target.value })} />
        </label>
        {noResolve && (
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={condition.options.includes("no-resolve")} disabled={saving}
              onChange={(event) => setCondition({ ...condition, options: event.target.checked
                ? [...condition.options, "no-resolve"]
                : condition.options.filter((option) => option !== "no-resolve") })} />
            仅匹配已解析 IP（no-resolve）
          </label>
        )}
        {action === "outlet" && (
          <div role="group" aria-label="指定出口" className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-semibold">出口</span>
            <CustomSelect value={outlet} disabled={saving} onChange={setOutlet} placeholder="选择当前方案出口"
              options={context.outlets.map((item) => ({ value: bindingKey(item.target), label: item.label }))} />
          </div>
        )}
        <div role="group" aria-label="作用范围" className="grid min-w-0 gap-1.5">
          <span className="text-[13px] font-semibold">作用范围</span>
          <CustomSelect value={allProfiles ? "all" : "current"}
            onChange={(value) => setAllProfiles(value === "all")} disabled={saving}
            options={[
              { value: "current", label: "当前方案 · " + context.profileName },
              ...(action === "outlet" ? [] : [{ value: "all", label: "所有方案" }]),
            ]} />
        </div>
        {error && <p className="text-xs text-[var(--workbench-danger)]" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button type="submit" variant="primary" loading={saving}>{apply ? "保存并应用" : "保存规则"}</Button>
        </div>
      </form>
    </Modal>
  );
}
