import { useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Download, Shield } from "lucide-react";
import { Button } from "../../../src-next/primitives/Button";
import { Modal } from "../../../src-next/primitives/Modal";
import { CapsuleToggle } from "../../../src-next/primitives/CapsuleToggle";
import { type BundleLocalInstance, type BundleTrafficMode, normalizeBundlePolicy } from "../../types/businessBundle";
import { createCustomBundleInstance, exportBundlePackage } from "../../services/bundleStorage";
import { saveTextFile } from "../../services/fileExport";
import { bundleExes, bundleProcesses, matchingBindings, processKey, processMembers, processNames, validateProcessBindings } from "../../utils/bundlePlatform";
import { BundleDiscoveryTools } from "./BundleDiscoveryTools";
import { BundlePolicyForm } from "./BundlePolicyForm";

interface Props {
  instance: BundleLocalInstance | null;
  isHttpUpstream?: boolean;
  processTreeSupported: boolean;
  onClose: () => void;
  onSave: (instance: BundleLocalInstance) => Promise<void>;
}

const modeOptions = [
  { value: "strict", label: "强锁模式", description: "已接入且匹配套件规则的流量使用专用出口。" },
  { value: "sandbox", label: "沙盒隔离", description: "匹配套件域名时使用专用出口，其他流量按未命中策略处理。" },
] as const;

const inputClass = "workbench-field min-h-9 w-full px-3 text-[13px]";

export function ProcessBundleEditor({ instance, isHttpUpstream, processTreeSupported, onClose, onSave }: Props) {
  const formId = useId();
  const definition = instance?.definition;
  const [name, setName] = useState(definition?.packageName ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [mode, setMode] = useState<BundleTrafficMode>(definition?.mode ?? "strict");
  const [exesText, setExesText] = useState(() => definition
    ? [...new Map(bundleExes(definition, "windows").map(exe => [processKey(exe, "windows"), exe])).values()].join("\n")
    : "");
  const [domainsText, setDomainsText] = useState(definition?.domains?.join("\n") ?? "");
  const [bindings, setBindings] = useState(instance?.processBindings?.windows ?? []);
  const [policy, setPolicy] = useState(() => normalizeBundlePolicy(instance?.policy ?? definition?.policy));
  const [showPolicy, setShowPolicy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const draftIdentity = useRef<Pick<BundleLocalInstance, "instanceId" | "createdAt"> & { packageId: string }>();

  const buildInstance = () => {
    const exes = processNames(exesText);
    if (!name.trim()) throw new Error("请输入套件名称");
    if (!exes.length) throw new Error("请至少添加一个进程");
    const domains = processNames(domainsText);
    const selectedBindings = matchingBindings(bindings, exes, "windows");
    validateProcessBindings(selectedBindings, "windows");
    const processBindings = { ...instance?.processBindings, windows: selectedBindings };
    const changes = { mode, description: description.trim(), policy };
    if (!instance) {
      const created = createCustomBundleInstance(name.trim(), exes, domains, "windows", processBindings, changes);
      const identity = draftIdentity.current ??= {
        instanceId: created.instanceId, createdAt: created.createdAt, packageId: created.definition.packageId,
      };
      return {
        ...created, backend: "external" as const, instanceId: identity.instanceId, createdAt: identity.createdAt,
        definition: { ...created.definition, packageId: identity.packageId },
      };
    }
    return {
      ...instance,
      definition: {
        ...instance.definition, ...changes, packageName: name.trim(), domains,
        processes: processMembers(exes, bundleProcesses(instance.definition, "windows"), selectedBindings, "windows"),
        additionalExes: instance.definition.additionalExes?.filter(exe =>
          exes.some(name => processKey(name, "windows") === processKey(exe, "windows"))),
      },
      processBindings, policy, updatedAt: Date.now(), isModified: true,
    };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try { await onSave(buildInstance()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  };

  const exportDraft = async () => {
    setError("");
    try {
      const draft = buildInstance();
      await saveTextFile(draft.definition.packageId + ".pwpack.json", JSON.stringify(exportBundlePackage(draft), null, 2), "application/json");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return (
    <Modal isOpen wide title={instance ? "编辑业务套件" : "新建业务套件"} onClose={() => { if (!pending) onClose(); }}>
      <form onSubmit={submit} className="workbench-bundle-form grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="workbench-settings-field">
            套件名称
            <input value={name} onChange={event => setName(event.target.value)} className={inputClass} required placeholder="例如 浏览器分流" />
          </label>
          <label className="workbench-settings-field">
            套件说明
            <input value={description} onChange={event => setDescription(event.target.value)} className={inputClass} placeholder="可选，说明套件用途" />
          </label>
        </div>

        <section className="grid gap-2.5" aria-labelledby={formId + "-mode"}>
          <h3 className="text-sm font-semibold" id={formId + "-mode"}>接管模式</h3>
          <div className="grid gap-2.5 sm:grid-cols-2" role="group" aria-label="接管模式">
            {modeOptions.map(option => (
              <button type="button" key={option.value} className="workbench-bundle-option" aria-pressed={mode === option.value} onClick={() => setMode(option.value)}>
                <span className="text-[13px] font-semibold">{option.label}</span>
                <span className="text-xs leading-relaxed text-[var(--text-muted)]">{option.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <label className="workbench-settings-field">
            进程名单
            <textarea value={exesText} onChange={event => setExesText(event.target.value)} rows={3} className={inputClass + " py-2 font-mono"}
              placeholder="每行一个进程名，例如 msedge.exe" />
          </label>
          <div className="workbench-control-row justify-between">
            <span className="text-[13px] font-semibold">包含子进程</span>
            <CapsuleToggle checked={policy.proxySubprocesses} title="包含子进程" onChange={proxySubprocesses => setPolicy({ ...policy, proxySubprocesses })} />
          </div>
          {processTreeSupported && (
            <BundleDiscoveryTools
              platform="windows" bundleId={instance?.instanceId} members={definition?.processes}
              exesText={exesText} domainsText={domainsText} bindings={bindings}
              onProcesses={(text, selected) => { setExesText(text); setBindings(selected); }} onDomains={setDomainsText}
              workbench
            />
          )}
        </section>

        <label className="workbench-settings-field">
          {mode === "sandbox" ? "专用出口域名" : "DNS 策略域名清单"}
          <textarea value={domainsText} onChange={event => setDomainsText(event.target.value)} rows={2} className={inputClass + " py-2 font-mono"}
            placeholder="可选，每行一个域名或后缀" />
        </label>

        <section className="workbench-bundle-policy">
          <button type="button" className="workbench-bundle-disclosure w-full text-[13px] font-semibold" aria-expanded={showPolicy}
            aria-controls={formId + "-policy"} onClick={() => setShowPolicy(!showPolicy)}>
            <span className="inline-flex items-center gap-2"><Shield size={15} aria-hidden="true" /> 高级网络与接管防护</span>
            <ChevronDown size={14} className={showPolicy ? "rotate-180" : ""} aria-hidden="true" />
          </button>
          <div id={formId + "-policy"} hidden={!showPolicy} className="mt-2">
            <BundlePolicyForm policy={policy} onChange={setPolicy} isHttpUpstream={isHttpUpstream} workbench />
          </div>
        </section>

        {error && <p role="alert" className="workbench-setting-feedback">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!instance && <Button type="button" variant="ghost" className="mr-auto" disabled={pending} onClick={() => void exportDraft()}>
            <Download size={14} aria-hidden="true" /> 导出规则包
          </Button>}
          <Button type="button" disabled={pending} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={pending}>{instance ? "保存并应用" : "创建套件"}</Button>
        </div>
      </form>
    </Modal>
  );
}
