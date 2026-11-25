// ==========================================================================
// ProcWeaver src-next 统一进程分流/业务套件模态弹窗 (ProcessBundleModal)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 风格约束: 严禁任何 Emoji，全量采用专业内联 SVG 与清晰分层排版
// 全功能对齐: 接管模式 (Strict vs Sandbox) + 协议与安全 + DNS与局域网 + 目标与端口
// ==========================================================================

import React, { useState, useEffect, useMemo, useId } from "react";
import { Check, ChevronDown, Cpu, FolderOpen, X } from "lucide-react";
import {
  ProcessBundleItem,
  BundlePolicyConfig,
  BundleTrafficMode,
  BundleFallback,
  BundleStaleConnectionStrategy,
  usesExistingBundleRules,
} from "../../types/processRouting";
import {
  chooseExecutableFile,
  cleanProxyOptions,
} from "../../services/processRoutingService";
import { RunningProcessPickerModal } from "./RunningProcessPickerModal";
import { ConsolidatedProcess } from "../../services/processDiscoveryService";
import { CustomSelect } from "../../primitives/CustomSelect";
import { Button } from "../../primitives/Button";

const trafficModeOptions = [
  { value: "strict", label: "强锁模式", detail: "仅通过专用出口连接。出口不可用时阻断该套件的连接。" },
  { value: "sandbox", label: "沙盒隔离", detail: "可按现有规则分流，也可为指定域名配置专用出口。" },
] as const;

const policyTabs = [
  { value: "protocol", label: "协议与安全" },
  { value: "dns", label: "DNS 与局域网" },
  { value: "filter", label: "目标与端口" },
] as const;

export interface BundleFormData {
  id?: string;
  name: string;
  description: string;
  targetProxy: string;
  mainExe: string;
  exes: string[];
  mode: BundleTrafficMode;
  fallback: BundleFallback;
  domains: string[];
  policy: BundlePolicyConfig;
}

interface ProcessBundleModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  bundle?: ProcessBundleItem | null;
  availableProxies: string[];
  onClose: () => void;
  onSave: (data: BundleFormData) => Promise<void>;
}

export const ProcessBundleModal: React.FC<ProcessBundleModalProps> = ({
  isOpen,
  mode,
  bundle,
  availableProxies,
  onClose,
  onSave,
}) => {
  const formId = useId();
  // 1. 基础信息
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetProxy, setTargetProxy] = useState("");
  const [trafficMode, setTrafficMode] = useState<BundleTrafficMode>("strict");
  const [fallback, setFallback] = useState<BundleFallback>("rules");
  const [domainsText, setDomainsText] = useState("");

  // 2. 进程名单
  const [exes, setExes] = useState<string[]>([]);
  const [newExeInput, setNewExeInput] = useState("");

  // 3. 高级策略与 Tab
  const [activePolicyTab, setActivePolicyTab] = useState<"protocol" | "dns" | "filter">("protocol");
  const [isPolicyExpanded, setIsPolicyExpanded] = useState(false);
  const [policy, setPolicy] = useState<BundlePolicyConfig>({
    proxyTcp: true,
    blockIpv6: true,
    blockUdp: true,
    proxyUdp: false,
    proxySubprocesses: true,
    bypassLan: true,
    dnsMode: "safe_pure",
    portFilterMode: "all",
    customPorts: "",
    targetFilterMode: "all",
    targetRules: [],
    disallowProxyArgs: false,
    staleConnectionStrategy: "prompt",
  });
  const [targetRulesText, setTargetRulesText] = useState("");
  const useExistingRules = usesExistingBundleRules({ mode: trafficMode, policy });

  // 辅助状态
  const [isSaving, setIsSaving] = useState(false);
  const [isChoosingFile, setIsChoosingFile] = useState(false);
  const [showProcessPicker, setShowProcessPicker] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 格式化出站代理插槽选项
  const structuredProxyOptions = useMemo(() => {
    return cleanProxyOptions(availableProxies);
  }, [availableProxies]);

  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && bundle) {
        setName(bundle.name);
        setDescription(bundle.description || "");
        setTargetProxy(bundle.targetProxy);
        setTrafficMode(bundle.mode || "strict");
        setFallback(bundle.fallback || "rules");
        setDomainsText((bundle.domains || []).join("\n"));
        setExes([...bundle.exes]);

        const p = bundle.policy || {};
        setPolicy({
          proxyTcp: p.proxyTcp ?? true,
          blockIpv6: p.blockIpv6 ?? true,
          blockUdp: p.blockUdp ?? true,
          proxyUdp: p.proxyUdp ?? false,
          proxySubprocesses: p.proxySubprocesses ?? true,
          bypassLan: p.bypassLan ?? true,
          dnsMode: p.dnsMode || "safe_pure",
          portFilterMode: p.portFilterMode || "all",
          customPorts: p.customPorts || "",
          targetFilterMode: p.targetFilterMode || "all",
          targetRules: Array.isArray(p.targetRules) ? p.targetRules : [],
          disallowProxyArgs: Boolean(p.disallowProxyArgs),
          staleConnectionStrategy: p.staleConnectionStrategy || "prompt",
          useExistingRules: p.useExistingRules === true,
        });
        setTargetRulesText((p.targetRules || []).join("\n"));
      } else {
        // 新建模式初始化
        setName("");
        setDescription("");
        setTargetProxy("");
        setTrafficMode("strict");
        setFallback("rules");
        setDomainsText("");
        setExes([]);
        setPolicy({
          proxyTcp: true,
          blockIpv6: true,
          blockUdp: true,
          proxyUdp: false,
          proxySubprocesses: true,
          bypassLan: true,
          dnsMode: "safe_pure",
          portFilterMode: "all",
          customPorts: "",
          targetFilterMode: "all",
          targetRules: [],
          disallowProxyArgs: false,
          staleConnectionStrategy: "prompt",
        });
        setTargetRulesText("");
      }
      setNewExeInput("");
      setIsPolicyExpanded(false);
      setShowProcessPicker(false);
      setActivePolicyTab("protocol");
      setFormError(null);
    }
  }, [isOpen, mode, bundle]);

  if (!isOpen) return null;

  // 手动输入添加 exe
  const handleAddExe = () => {
    const trimmed = newExeInput.trim();
    if (!trimmed) return;
    const cleanExe = trimmed.toLowerCase().endsWith(".exe") ? trimmed : `${trimmed}.exe`;
    if (!exes.some((e) => e.toLowerCase() === cleanExe.toLowerCase())) {
      setExes([...exes, cleanExe]);
    }
    setNewExeInput("");
  };

  // 从运行中进程树中选入主程序
  const handleSelectRunningProcess = (proc: ConsolidatedProcess) => {
    const cleanExe = proc.name.toLowerCase().endsWith(".exe")
      ? proc.name
      : `${proc.name}.exe`;

    if (!exes.some((e) => e.toLowerCase() === cleanExe.toLowerCase())) {
      setExes([...exes, cleanExe]);
    }

    setPolicy((prev) => ({
      ...prev,
      proxySubprocesses: true,
    }));

    if (!name.trim()) {
      setName(proc.friendlyName || proc.name.replace(/\.exe$/i, ""));
    }
  };

  // 原生 Windows 文件选择框
  const handleBrowseExe = async () => {
    setIsChoosingFile(true);
    try {
      const selectedPath = await chooseExecutableFile();
      if (selectedPath) {
        const parts = selectedPath.split(/[/\\]/);
        const fileName = parts[parts.length - 1];
        if (fileName && !exes.some((e) => e.toLowerCase() === fileName.toLowerCase())) {
          setExes([...exes, fileName]);
          if (!name.trim()) {
            setName(fileName.replace(/\.exe$/i, ""));
          }
        }
      }
    } finally {
      setIsChoosingFile(false);
    }
  };

  const handleRemoveExe = (target: string) => {
    if (mode === "edit" && exes.length <= 1) {
      setFormError("业务包至少需保留一个目标进程！");
      return;
    }
    setExes(exes.filter((e) => e !== target));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("套件名称不能为空，请输入规则集名称");
      return;
    }
    if (exes.length === 0) {
      setFormError("请至少添加一个目标可执行文件进程（例如 chrome.exe）");
      return;
    }
    if (!targetProxy.trim() && (mode === "create" || bundle?.enabled)) {
      setFormError("请先绑定出口插槽");
      return;
    }
    setFormError(null);

    // 格式化域名列表
    const parsedDomains = domainsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    // 格式化目标过滤规则列表
    const parsedTargetRules = targetRulesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    setIsSaving(true);
    try {
      await onSave({
        id: bundle?.id,
        name: name.trim(),
        description: description.trim() || `${name.trim()} 专属进程分流套件`,
        targetProxy,
        mainExe: exes[0],
        exes,
        mode: trafficMode,
        fallback,
        domains: parsedDomains,
        policy: {
          ...policy,
          targetRules: parsedTargetRules,
        },
      });
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="workbench-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="workbench-dialog workbench-bundle-dialog relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[640px] flex-col overflow-hidden text-left sm:max-h-[calc(100dvh-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={formId + "-title"}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 id={formId + "-title"} className="text-[17px] font-semibold leading-tight text-[var(--text-primary)]">
              {mode === "create" ? "新建进程分流套件" : "编辑业务规则包"}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="workbench-title-button" onClick={onClose} aria-label="关闭">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <form id={formId} onSubmit={handleSubmit} className="workbench-bundle-form grid min-h-0 flex-auto content-start gap-5 overflow-y-auto overscroll-contain px-5 pb-2 pt-1 sm:px-6">
          <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={formId + "-name"} className="text-[13px] font-semibold">套件名称</label>
              <input
                id={formId + "-name"}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="min-h-9 w-full px-3 text-[13px]"
                placeholder="例如 智能开发套件"
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-semibold">绑定出口插槽</span>
              <CustomSelect
                value={targetProxy}
                onChange={setTargetProxy}
                options={structuredProxyOptions}
                placeholder="请选择出口插槽"
              />
            </div>
            <div className="grid min-w-0 gap-1.5 sm:col-span-2">
              <label htmlFor={formId + "-description"} className="text-[13px] font-semibold">套件说明</label>
              <input
                id={formId + "-description"}
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-9 w-full px-3 text-[13px]"
                placeholder="可选，说明套件用途"
              />
            </div>
          </div>

          <section className="grid min-w-0 gap-2.5" aria-labelledby={formId + "-mode"}>
            <h4 id={formId + "-mode"} className="text-sm font-semibold">接管模式</h4>
            <div className="grid gap-2.5 sm:grid-cols-2" role="group" aria-labelledby={formId + "-mode"}>
              {trafficModeOptions.map(({ value, label, detail }) => (
                <button
                  key={value}
                  type="button"
                  className="workbench-bundle-option"
                  aria-pressed={trafficMode === value}
                  onClick={() => setTrafficMode(value)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{label}</span>
                    {trafficMode === value && <Check size={15} className="shrink-0 text-[var(--workbench-accent)]" aria-hidden="true" />}
                  </span>
                  <span className="text-xs leading-relaxed text-[var(--text-muted)]">{detail}</span>
                </button>
              ))}
            </div>
            {trafficMode === "sandbox" && (
              <div className="grid min-w-0 gap-3 pt-1">
                <div className="grid min-w-0 gap-1.5">
                  <span className="text-[13px] font-semibold">分流依据</span>
                  <CustomSelect
                    value={useExistingRules ? "existing" : "domains"}
                    onChange={(value) => setPolicy((current) => ({ ...current, useExistingRules: value === "existing" }))}
                    options={[
                      { value: "existing", label: "使用现有规则分流" },
                      { value: "domains", label: "指定域名走专用出口" },
                    ]}
                  />
                  {useExistingRules && <p className="text-xs leading-relaxed text-[var(--text-muted)]">命中代理规则时使用套件出口，直连和拒绝按现有规则执行。</p>}
                </div>
                {!useExistingRules && (
                  <>
                    <div className="grid min-w-0 gap-1.5">
                      <span className="text-[13px] font-semibold">未命中域名时</span>
                      <CustomSelect
                        value={fallback}
                        onChange={(value) => setFallback(value as BundleFallback)}
                        options={[
                          { value: "system", label: "跟随系统代理开关" },
                          { value: "rules", label: "始终沿用原规则" },
                          { value: "direct", label: "始终直连" },
                        ]}
                      />
                      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                        {fallback === "system"
                          ? "开启系统代理时按订阅和本地规则分流，关闭时直连。"
                          : fallback === "direct"
                          ? "未命中清单的请求由本地核心直接连接目标。"
                          : "未命中清单的请求按现有订阅和本地规则分流。"}
                      </p>
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <label htmlFor={formId + "-domains"} className="text-[13px] font-semibold">专用出口域名</label>
                      <textarea
                        id={formId + "-domains"}
                        rows={3}
                        value={domainsText}
                        onChange={(event) => setDomainsText(event.target.value)}
                        placeholder={"example.com\n*.example.org"}
                        className="w-full resize-y px-3 py-2 font-mono text-xs"
                      />
                      <p className="text-xs leading-relaxed text-[var(--text-muted)]">可选，每行一个域名。*.example.com 包含根域名及子域名。</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="grid min-w-0 gap-2.5" aria-labelledby={formId + "-processes"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h4 id={formId + "-processes"} className="text-sm font-semibold">纳管进程名单</h4>
                <span className="text-xs tabular-nums text-[var(--text-muted)]">{exes.length} 个</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowProcessPicker(true)}>
                  <Cpu size={14} aria-hidden="true" />运行中进程
                </Button>
                <Button type="button" variant="ghost" size="sm" loading={isChoosingFile} onClick={handleBrowseExe}>
                  <FolderOpen size={14} aria-hidden="true" />{isChoosingFile ? "浏览中…" : "浏览文件"}
                </Button>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <input
                type="text"
                aria-label="进程名"
                value={newExeInput}
                onChange={(event) => setNewExeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  handleAddExe();
                }}
                placeholder="输入进程名，例如 chrome.exe"
                className="min-h-9 min-w-0 flex-1 px-3 text-[13px]"
              />
              <Button type="button" size="lg" onClick={handleAddExe} disabled={!newExeInput.trim()}>
                添加
              </Button>
            </div>
            {exes.length > 0 ? (
              <ul className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto py-1" aria-label="已添加的进程">
                {exes.map((exe, index) => (
                  <li key={exe} className="workbench-tag min-w-0 gap-1.5">
                    <span className="break-all font-mono">{exe}</span>
                    {index === 0 && <span className="shrink-0 text-[var(--text-muted)]">主进程</span>}
                    <button
                      type="button"
                      onClick={() => handleRemoveExe(exe)}
                      className="workbench-title-button shrink-0 !min-h-6 !min-w-6"
                      aria-label={"移除 " + exe}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">请添加至少一个进程。</p>
            )}
            <details className="workbench-bundle-shortcuts text-xs">
              <summary className="cursor-pointer rounded text-[var(--text-secondary)]">快捷添加</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["test-proxy-aware.exe", "test-proxy-direct.exe", "curl.exe"].map((exe) => (
                  <Button
                    key={exe}
                    type="button"
                    size="sm"
                    className="font-mono"
                    disabled={exes.includes(exe)}
                    onClick={() => setExes((previous) => [...previous, exe])}
                  >
                    {exe}
                  </Button>
                ))}
              </div>
            </details>
          </section>
          <section className="grid min-w-0 gap-3">
            <button
              type="button"
              className="workbench-bundle-disclosure"
              aria-expanded={isPolicyExpanded}
              aria-controls={formId + "-advanced"}
              onClick={() => setIsPolicyExpanded((expanded) => !expanded)}
            >
              <span className="text-[13px] font-semibold">高级策略</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">
                  {policy.proxyTcp ? "TCP 代理" : "未代理 TCP"} · {policy.dnsMode === "safe_pure" ? "纯净 DNS" : policy.dnsMode === "fake_ip" ? "Fake-IP" : "系统 DNS"}
                </span>
                <ChevronDown size={15} className={"shrink-0 " + (isPolicyExpanded ? "rotate-180" : "")} aria-hidden="true" />
              </span>
            </button>
            {isPolicyExpanded && (
              <div id={formId + "-advanced"} className="grid min-w-0 gap-3">
                <div className="workbench-segments" role="group" aria-label="高级策略分类">
                  {policyTabs.map(({ value, label }) => (
                    <button type="button" key={value} aria-pressed={activePolicyTab === value} onClick={() => setActivePolicyTab(value)}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* Tab 1: 协议与安全 */}
                {activePolicyTab === "protocol" && (
                  <div className="space-y-2">
                    {/* 代理 TCP 连接 */}
                    <div className="flex items-start justify-between workbench-bundle-policy-row">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                          代理 TCP 连接
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                          透明重定向应用发起的外网 TCP 流量至本业务包专属出口 (建议始终开启)
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.proxyTcp}
                        onChange={(e) => setPolicy({ ...policy, proxyTcp: e.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] cursor-pointer"
                      />
                    </div>

                    {/* 业务包 IPv6 策略 */}
                    <div className="flex items-start justify-between workbench-bundle-policy-row">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>阻止业务包公网 IPv6</span>
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                          阻断已确认归属本包的公网 IPv6 连接，并对本包接管的 AAAA 查询返回空应答。
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.blockIpv6}
                        onChange={(e) => setPolicy({ ...policy, blockIpv6: e.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] cursor-pointer"
                      />
                    </div>

                    {/* 禁止 UDP (最高优先级 · 强制覆写) */}
                    <div className="flex items-start justify-between workbench-bundle-policy-row">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>禁止 UDP (最高优先级 · 强制覆写)</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            防 QUIC 延迟
                          </span>
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                          业务远端解析当前支持 TCP；UDP 保持阻断，避免出口在本地解析目标域名。历史 UDP 选择保留。
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.blockUdp}
                        onChange={(e) => setPolicy({ ...policy, blockUdp: e.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] cursor-pointer"
                      />
                    </div>

                    {/* 代理 UDP 数据报 (仅 SOCKS5 支持) */}
                    <div
                      className={"workbench-bundle-policy-row flex items-start justify-between " + (policy.blockUdp ? "opacity-60" : "")}
                    >
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>代理 UDP 数据报 (仅 SOCKS5 支持)</span>
                          {policy.blockUdp && (
                            <span className="text-[9px] text-[var(--text-muted)] font-mono">
                              (已被「禁止 UDP」优先接管)
                            </span>
                          )}
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                          当未开启「禁止 UDP」且出口支持 SOCKS5 时通过 UDP ASSOCIATE 转发；若上游不支持将平滑降级
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={policy.blockUdp}
                        checked={!policy.blockUdp && policy.proxyUdp}
                        onChange={(e) => setPolicy({ ...policy, proxyUdp: e.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] disabled:opacity-40 cursor-pointer"
                      />
                    </div>

                    {/* 代理衍生子进程 */}
                    <div className="flex items-start justify-between workbench-bundle-policy-row">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                          代理衍生子进程
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                          Detours 自动追踪主程序创建的渲染、网络与辅助子进程链条，保持完整的代理环境
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.proxySubprocesses}
                        onChange={(e) => setPolicy({ ...policy, proxySubprocesses: e.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] cursor-pointer"
                      />
                    </div>

                    {/* 禁用启动代理参数 */}
                    <div className="workbench-bundle-policy-row space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="space-y-0.5 pr-3">
                          <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                            <span>禁用启动代理参数 (--proxy-server)</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              安全自检兼容
                            </span>
                          </div>
                          <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                            禁止向应用启动命令行追加 --proxy-server 等参数。适用于 Google Gemini 等限制调试与网络覆盖开关的应用
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(policy.disallowProxyArgs)}
                          onChange={(e) => setPolicy({ ...policy, disallowProxyArgs: e.target.checked })}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] cursor-pointer"
                        />
                      </div>

                      {policy.disallowProxyArgs && (
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 leading-relaxed flex items-start gap-1.5">
                          <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>
                            开启后沿用应用的启动参数。透明分流由 <strong>WinDivert 驱动</strong> 或 <strong>用户态 Hook</strong> 接管。
                            {trafficMode === "sandbox" && (useExistingRules
                              ? "加密握手隐藏目标域名时，域名规则可能无法命中。"
                              : "加密握手隐藏目标域名时，沙盒可能按回退设置处理连接。")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 存量旧长连接接管策略 (TCP Hot-Reset) */}
                    <div className="workbench-bundle-policy-row space-y-2">
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>存量旧长连接接管策略 (TCP Hot-Reset)</span>
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)]">
                          开启分流或切换出口后，可关闭待切换的 TCP 连接，由应用自行重连。
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {[
                          { value: "prompt", label: "智能询问", desc: "确认后刷新旧连接" },
                          { value: "auto_reset", label: "自动热刷新", desc: "新规则生效后刷新" },
                          { value: "ignore", label: "仅接管新连接", desc: "旧连接沿用原出口" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setPolicy({ ...policy, staleConnectionStrategy: opt.value as BundleStaleConnectionStrategy })}
                            className={`p-2 rounded-lg text-left border transition-all cursor-pointer ${
                              policy.staleConnectionStrategy === opt.value
                                ? "bg-[var(--workbench-selected)] text-[var(--text-primary)]"
                                : "bg-[var(--workbench-control)] text-[var(--text-secondary)] hover:bg-[var(--workbench-hover)]"
                            }`}
                          >
                            <div className="text-xs font-bold">{opt.label}</div>
                            <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: DNS 与局域网 */}
                {activePolicyTab === "dns" && (
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-[var(--text-primary)] block">
                        DNS 域名解析模式
                      </label>
                      <div className="grid grid-cols-1 gap-2">
                        {/* safe_pure */}
                        <label
                          className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                            policy.dnsMode === "safe_pure"
                              ? "bg-[var(--workbench-selected)]"
                              : "bg-[var(--workbench-row-hover)] hover:bg-[var(--workbench-hover)]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="dnsModeForm"
                            value="safe_pure"
                            checked={policy.dnsMode === "safe_pure"}
                            onChange={() => setPolicy({ ...policy, dnsMode: "safe_pure" })}
                            className="mt-0.5 mr-2.5 text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                              <span>安全纯净解析</span>
                            </div>
                            <div className="text-xs leading-relaxed text-[var(--text-muted)] leading-relaxed">
                              经套件指定出口使用 DoH。沙盒及需要域名匹配的套件返回映射地址，分流时还原域名。其余强锁套件可返回真实 IP。
                            </div>
                          </div>
                        </label>

                        {/* fake_ip */}
                        <label
                          className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                            policy.dnsMode === "fake_ip"
                              ? "bg-[var(--workbench-selected)]"
                              : "bg-[var(--workbench-row-hover)] hover:bg-[var(--workbench-hover)]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="dnsModeForm"
                            value="fake_ip"
                            checked={policy.dnsMode === "fake_ip"}
                            onChange={() => setPolicy({ ...policy, dnsMode: "fake_ip" })}
                            className="mt-0.5 mr-2.5 text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                              <span>Fake-IP 极速模式</span>
                            </div>
                            <div className="text-xs leading-relaxed text-[var(--text-muted)] leading-relaxed">
                              先返回映射地址，连接时还原原始域名。规则或出口需要真实 IP 时，经套件指定出口查询。
                            </div>
                          </div>
                        </label>

                        {/* system_native */}
                        <label
                          className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                            policy.dnsMode === "system_native"
                              ? "bg-[var(--workbench-selected)]"
                              : "bg-[var(--workbench-row-hover)] hover:bg-[var(--workbench-hover)]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="dnsModeForm"
                            value="system_native"
                            checked={policy.dnsMode === "system_native"}
                            onChange={() => setPolicy({ ...policy, dnsMode: "system_native" })}
                            className="mt-0.5 mr-2.5 text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                              <span>系统原生解析</span>
                            </div>
                            <div className="text-xs leading-relaxed text-[var(--text-muted)] leading-relaxed">
                              使用 Windows 配置的 DNS 服务器。解析直接走本机网络，应用连接仍按套件规则分流。
                            </div>
                          </div>
                        </label>
                      </div>
                      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                        Hook 在套件重新启动应用后应用新设置。WinDivert 对已确认属于套件的新查询生效，Windows 共享 DNS 服务的查询由系统处理。
                      </p>
                    </div>

                    {/* 绕过局域网与本地回环 */}
                    <div className="flex items-start justify-between workbench-bundle-policy-row">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>本地回环与局域网直连绕过 (Bypass LAN)</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            开发者必备
                          </span>
                        </div>
                        <div className="text-xs leading-relaxed text-[var(--text-muted)] leading-relaxed">
                          127.0.0.1、localhost 以及 RFC1918 私网段（192.168.x.x、10.x.x.x）直连放行，本地服务调试与内网调用不走代理
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.bypassLan}
                        onChange={(e) => setPolicy({ ...policy, bypassLan: e.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--workbench-accent-solid)] cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {/* Tab 3: 目标与端口 */}
                {activePolicyTab === "filter" && (
                  <div className="space-y-3">
                    {/* 端口过滤 */}
                    <div className="space-y-2 workbench-bundle-policy-row">
                      <div className="text-xs font-bold text-[var(--text-primary)]">
                        端口黑白名单过滤 (Port Filter)
                      </div>
                      <div className="flex items-center space-x-4 text-xs">
                        <label className="flex items-center space-x-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="portFilterModeForm"
                            value="all"
                            checked={policy.portFilterMode === "all"}
                            onChange={() => setPolicy({ ...policy, portFilterMode: "all" })}
                            className="text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-[var(--text-secondary)]">代理全部端口</span>
                        </label>
                        <label className="flex items-center space-x-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="portFilterModeForm"
                            value="web_only"
                            checked={policy.portFilterMode === "web_only"}
                            onChange={() => setPolicy({ ...policy, portFilterMode: "web_only" })}
                            className="text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-[var(--text-secondary)]">仅 Web 端口 (80, 443)</span>
                        </label>
                        <label className="flex items-center space-x-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="portFilterModeForm"
                            value="custom"
                            checked={policy.portFilterMode === "custom"}
                            onChange={() => setPolicy({ ...policy, portFilterMode: "custom" })}
                            className="text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-[var(--text-secondary)]">自定义端口范围</span>
                        </label>
                      </div>

                      {policy.portFilterMode === "custom" && (
                        <div className="pt-1.5 space-y-1 animate-in fade-in duration-150">
                          <input
                            type="text"
                            value={policy.customPorts ?? ""}
                            onChange={(e) => setPolicy({ ...policy, customPorts: e.target.value })}
                            placeholder="例如：80, 443, 8000-8080 (逗号或短横线)"
                            className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg text-[var(--text-primary)]"
                          />
                          <p className="text-[9px] text-[var(--text-muted)] font-mono">
                            支持单端口（如 443）及端口区间（如 3000-3010）。
                          </p>
                        </div>
                      )}
                    </div>

                    {/* 目标域名/IP 过滤 */}
                    <div className="space-y-2 workbench-bundle-policy-row">
                      <div className="text-xs font-bold text-[var(--text-primary)]">
                        目标域名 / IP 过滤规则 (Target Filter)
                      </div>
                      <div className="flex items-center space-x-4 text-xs">
                        <label className="flex items-center space-x-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="targetFilterModeForm"
                            value="all"
                            checked={policy.targetFilterMode === "all"}
                            onChange={() => setPolicy({ ...policy, targetFilterMode: "all" })}
                            className="text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-[var(--text-secondary)]">代理全部外网目标</span>
                        </label>
                        <label className="flex items-center space-x-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="targetFilterModeForm"
                            value="include"
                            checked={policy.targetFilterMode === "include"}
                            onChange={() => setPolicy({ ...policy, targetFilterMode: "include" })}
                            className="text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-[var(--text-secondary)]">仅代理匹配目标 (白名单)</span>
                        </label>
                        <label className="flex items-center space-x-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="targetFilterModeForm"
                            value="exclude"
                            checked={policy.targetFilterMode === "exclude"}
                            onChange={() => setPolicy({ ...policy, targetFilterMode: "exclude" })}
                            className="text-blue-500 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-[var(--text-secondary)]">排除匹配目标 (黑名单直连)</span>
                        </label>
                      </div>

                      {policy.targetFilterMode !== "all" && (
                        <div className="pt-1.5 space-y-1 animate-in fade-in duration-150">
                          <textarea
                            rows={3}
                            value={targetRulesText}
                            onChange={(e) => setTargetRulesText(e.target.value)}
                            placeholder={"api.openai.com\n*.google.com\n1.1.1.1"}
                            className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg text-[var(--text-primary)]"
                          />
                          <p className="text-[9px] text-[var(--text-muted)] font-mono">
                            支持通配符域名与 IP 地址段，每行一个。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </form>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-6">
          {formError && (
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--workbench-danger)]" role="alert">
              {formError}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="lg" onClick={onClose} disabled={isSaving}>取消</Button>
            <Button type="submit" form={formId} variant="primary" size="lg" loading={isSaving}>
              {isSaving ? "正在保存…" : mode === "create" ? "创建并生效" : "保存并下发"}
            </Button>
          </div>
        </footer>
      </div>

      {/* 运行中进程选择器弹窗 */}
      <RunningProcessPickerModal
        isOpen={showProcessPicker}
        onClose={() => setShowProcessPicker(false)}
        onSelect={handleSelectRunningProcess}
        existingExes={exes}
      />

    </div>
  );
};
