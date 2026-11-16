// ==========================================================================
// ProcWeaver src-next 统一进程分流/业务套件模态弹窗 (ProcessBundleModal)
// 规范溯源: tauri-linear-raycast-ui / typography-dark-mono-optics / taste-skill
// 风格约束: 严禁任何 Emoji，全量采用专业内联 SVG 与清晰分层排版
// 全功能对齐: 接管模式 (Strict vs Sandbox) + 协议与安全 + DNS与局域网 + 目标与端口
// ==========================================================================

import React, { useState, useEffect, useMemo } from "react";
import {
  ProcessBundleItem,
  BundlePolicyConfig,
  BundleTrafficMode,
  BundleFallback,
  BundleStaleConnectionStrategy,
} from "../../types/processRouting";
import {
  chooseExecutableFile,
  OFFICIAL_PRESET_BUNDLES,
  cleanProxyOptions,
} from "../../services/processRoutingService";
import { RunningProcessPickerModal } from "./RunningProcessPickerModal";
import { ConsolidatedProcess } from "../../services/processDiscoveryService";
import { CustomSelect } from "../../primitives/CustomSelect";
import { ConfirmModal } from "../../primitives/ConfirmModal";

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
  onResetPreset?: (bundleId: string) => Promise<void>;
}

export const ProcessBundleModal: React.FC<ProcessBundleModalProps> = ({
  isOpen,
  mode,
  bundle,
  availableProxies,
  onClose,
  onSave,
  onResetPreset,
}) => {
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
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // 3. 高级策略与 Tab（默认展开，确保接管与防护策略一目了然）
  const [activePolicyTab, setActivePolicyTab] = useState<"protocol" | "dns" | "filter">("protocol");
  const [isPolicyExpanded, setIsPolicyExpanded] = useState(true);
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
        setTargetProxy(bundle.targetProxy || availableProxies[0] || "Proxy");
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
  }, [isOpen, mode, bundle, availableProxies]);

  if (!isOpen) return null;

  const isPreset =
    mode === "edit" && bundle
      ? OFFICIAL_PRESET_BUNDLES.some((p) => p.id === bundle.id)
      : false;

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

  const handleResetToDefault = () => {
    if (!onResetPreset || !bundle) return;
    setShowResetConfirm(true);
  };

  const handleExecuteReset = async () => {
    if (!onResetPreset || !bundle) return;
    setIsSaving(true);
    try {
      await onResetPreset(bundle.id);
      setShowResetConfirm(false);
      onClose();
    } finally {
      setIsSaving(false);
    }
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
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/30 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-[560px] rounded-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 shadow-2xl p-4 sm:p-5 text-left flex flex-col gap-3.5 max-h-[90vh] overflow-y-auto">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border-subtle)] pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-primary)] shrink-0">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                {mode === "create" ? "新建进程分流套件" : "编辑业务规则包"}
              </h3>
              {isPreset && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  官方预设
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isPreset && onResetPreset && (
              <button
                type="button"
                onClick={handleResetToDefault}
                disabled={isSaving}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-[var(--glass-border-subtle)] hover:border-amber-500/40 text-[var(--text-muted)] hover:text-amber-500 transition-all active:scale-95 cursor-pointer"
                title="恢复官方出厂默认配置"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>重置</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {formError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs animate-in fade-in duration-150">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{formError}</span>
            </div>
          )}

          {/* 1. 基础信息：名称与出口绑定双列合流 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                套件名称 / 规则别名
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full h-8 px-2.5 text-xs rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:bg-white dark:focus:bg-white/10 focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] transition-colors"
                placeholder="例如: 智能AI开发套件"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                绑定出口插槽
              </label>
              <CustomSelect
                value={targetProxy}
                onChange={setTargetProxy}
                options={structuredProxyOptions}
                placeholder="请选择出口插槽"
                size="md"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
              套件说明与用途
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:bg-white dark:focus:bg-white/10 focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] transition-colors"
              placeholder="例如: 专属分流，绑定独立低延迟专线"
            />
          </div>

          {/* 2. 接管模式与安全防线 (Strict vs Sandbox) */}
          <div className="p-3 rounded-xl bg-slate-100/70 dark:bg-black/40 border border-slate-200/80 dark:border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>2. 接管模式与安全防线</span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">Strict vs Sandbox</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* 强锁模式 (Strict) */}
              <button
                type="button"
                onClick={() => setTrafficMode("strict")}
                className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                  trafficMode === "strict"
                    ? "bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/80 ring-1 ring-blue-500/30 text-[var(--text-primary)]"
                    : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>强锁模式 (Strict)</span>
                    <span className="text-[9px] px-1 py-0.2 rounded font-mono bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">推荐</span>
                  </div>
                  {trafficMode === "strict" && (
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  强制仅走指定出口节点。节点故障或断网时立即物理阻断，绝对防止真实 IP 泄露，专为跨境办公与防封号设计。
                </div>
              </button>

              {/* 沙盒隔离 (Sandbox) */}
              <button
                type="button"
                onClick={() => setTrafficMode("sandbox")}
                className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                  trafficMode === "sandbox"
                    ? "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/80 ring-1 ring-emerald-500/30 text-[var(--text-primary)]"
                    : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <span>沙盒隔离 (Sandbox)</span>
                  </div>
                  {trafficMode === "sandbox" && (
                    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  弹性容错接管。允许在专属出口不可用或遇到无规则匹配时平滑回落至全局分流规则，适合普通开发与日常工具。
                </div>
              </button>
            </div>

            {/* 沙盒模式展开选项：未命中域名时 + 专属域名清单 */}
            {trafficMode === "sandbox" && (
              <div className="pt-2 border-t border-[var(--glass-border-subtle)] space-y-2 animate-in fade-in duration-150">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                    未命中域名时
                  </label>
                  <CustomSelect
                    value={fallback}
                    onChange={(val) => setFallback(val as BundleFallback)}
                    options={[
                      { value: "system", label: "跟随系统代理开关 (开启时走分流，关闭时直连)" },
                      { value: "rules", label: "始终沿用原规则 (始终按现有订阅和本地规则分流)" },
                      { value: "direct", label: "始终直连 (未命中清单的请求由本地核心直接直连)" },
                    ]}
                    size="sm"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    {fallback === "system"
                      ? "跟随 ProcWeaver 的系统代理开关：开启时按订阅和本地规则分流，关闭时直连。命中清单的请求不受影响。"
                      : fallback === "direct"
                      ? "未命中清单的请求由本地核心直接连接目标，不经过代理节点。"
                      : "未命中清单的请求始终按现有订阅和本地规则分流，与系统代理开关无关。"}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                      专属出口域名清单 (可选，每行一个)
                    </label>
                    <span className="text-[9px] text-[var(--text-muted)] font-mono">
                      *.example.com 包含根域名及子域名
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={domainsText}
                    onChange={(e) => setDomainsText(e.target.value)}
                    placeholder={"openai.com\nchatgpt.com\n*.oaistatic.com"}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:bg-white dark:focus:bg-white/10 focus:border-blue-500/50 focus:outline-none text-[var(--text-primary)] transition-colors"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 3. 纳管进程名单 */}
          <div className="space-y-2 pt-2 border-t border-[var(--glass-border-subtle)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  纳管进程名单
                </label>
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-slate-200/80 dark:bg-white/10 text-slate-700 dark:text-slate-300 font-semibold">
                  {exes.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowProcessPicker(true)}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors cursor-pointer"
                  title="从系统运行中进程树中选择"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                  <span>运行中进程</span>
                </button>

                <span className="text-[var(--text-muted)] text-[10px]">·</span>

                <button
                  type="button"
                  onClick={handleBrowseExe}
                  disabled={isChoosingFile}
                  className="flex items-center gap-1 text-[11px] font-medium text-blue-500 hover:text-blue-400 transition-colors cursor-pointer"
                  title="从 Windows 文件管理器定位并添加 .exe"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span>{isChoosingFile ? "浏览中..." : "浏览本地"}</span>
                </button>
              </div>
            </div>

            {/* 进程胶囊列表 */}
            <div className="flex flex-wrap gap-1 min-h-[34px] max-h-24 overflow-y-auto p-1.5 rounded-xl bg-slate-50/90 dark:bg-white/5 border border-slate-200 dark:border-white/10">
              {exes.length === 0 ? (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 py-0.5 px-1 font-mono">
                  暂未添加进程，可在下方手动输入或从右上角【运行中进程】选择
                </span>
              ) : (
                exes.map((exe, index) => (
                  <span
                    key={exe}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-white shadow-2xs font-medium"
                  >
                    <span className="text-[9px] text-slate-400">{index + 1}.</span>
                    <span>{exe}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveExe(exe)}
                      className="text-slate-400 hover:text-rose-500 transition-colors p-0.5 cursor-pointer"
                      title="移除该进程"
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* 宽幅一体化输入条 */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus-within:bg-white dark:focus-within:bg-white/10 focus-within:border-blue-500/50 transition-colors">
              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <input
                type="text"
                value={newExeInput}
                onChange={(e) => setNewExeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddExe())}
                placeholder="输入进程名 (如 test-proxy-aware.exe)，按 Enter 回车添加"
                className="flex-1 bg-transparent text-xs font-mono text-[var(--text-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddExe}
                disabled={!newExeInput.trim()}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono font-medium bg-slate-200 hover:bg-blue-600 hover:text-white dark:bg-white/10 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-30 disabled:pointer-events-none shrink-0 cursor-pointer"
                title="按 Enter 回车添加"
              >
                <span>添加</span>
                <span className="text-[9px] opacity-70">↵</span>
              </button>
            </div>

            {/* 常用快选药丸 */}
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-600 dark:text-slate-400 pt-0.5 font-medium">
              <span className="shrink-0">常用快选:</span>
              {["test-proxy-aware.exe", "test-proxy-direct.exe", "curl.exe"].map((quickExe) => (
                <button
                  key={quickExe}
                  type="button"
                  onClick={() => {
                    if (!exes.includes(quickExe)) {
                      setExes((prev) => [...prev, quickExe]);
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded-md font-mono border transition-all cursor-pointer ${
                    exes.includes(quickExe)
                      ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30"
                      : "bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10"
                  }`}
                  title={`点击一键加入 ${quickExe}`}
                >
                  +{quickExe}
                </button>
              ))}
            </div>
          </div>

          {/* 4. 高级网络与接管防护策略 (折叠 + 3 大 Tab 完整版) */}
          <div className="pt-2 border-t border-[var(--glass-border-subtle)]">
            <button
              type="button"
              onClick={() => setIsPolicyExpanded(!isPolicyExpanded)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] hover:border-black/20 dark:hover:border-white/20 transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <svg
                  className={`w-3.5 h-3.5 text-blue-400 transition-transform duration-200 ${
                    isPolicyExpanded ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  高级网络与接管防护策略
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {policy.proxyTcp ? "TCP" : "未代理TCP"} · {policy.dnsMode === "safe_pure" ? "纯净DNS" : policy.dnsMode === "fake_ip" ? "Fake-IP" : "系统DNS"}
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                {isPolicyExpanded ? "点击收起" : "展开配置全套安全防线"}
              </span>
            </button>

            {isPolicyExpanded && (
              <div className="mt-2.5 space-y-3 p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] animate-in fade-in duration-150">
                {/* 选项卡导航 */}
                <div className="flex border border-[var(--glass-border-subtle)] rounded-xl p-0.5 gap-1 bg-black/5 dark:bg-white/5">
                  <button
                    type="button"
                    onClick={() => setActivePolicyTab("protocol")}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activePolicyTab === "protocol"
                        ? "bg-white dark:bg-white/10 text-[var(--text-primary)] shadow-2xs font-semibold"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    <span>协议与安全</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActivePolicyTab("dns")}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activePolicyTab === "dns"
                        ? "bg-white dark:bg-white/10 text-[var(--text-primary)] shadow-2xs font-semibold"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <span>DNS 与局域网</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActivePolicyTab("filter")}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activePolicyTab === "filter"
                        ? "bg-white dark:bg-white/10 text-[var(--text-primary)] shadow-2xs font-semibold"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    <span>目标与端口</span>
                  </button>
                </div>

                {/* Tab 1: 协议与安全 */}
                {activePolicyTab === "protocol" && (
                  <div className="space-y-2">
                    {/* 代理 TCP 连接 */}
                    <div className="flex items-start justify-between p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                          代理 TCP 连接
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          透明重定向应用发起的外网 TCP 流量至本业务包专属出口 (建议始终开启)
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.proxyTcp}
                        onChange={(e) => setPolicy({ ...policy, proxyTcp: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 cursor-pointer"
                      />
                    </div>

                    {/* 阻止 IPv6 连接旁路 */}
                    <div className="flex items-start justify-between p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>阻止 IPv6 连接旁路</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            防泄漏
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          过滤 AAAA 记录并截断外网 IPv6 直连，彻底根绝本机公网 IPv6 旁路导致的真实 IP 泄露
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.blockIpv6}
                        onChange={(e) => setPolicy({ ...policy, blockIpv6: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 cursor-pointer"
                      />
                    </div>

                    {/* 禁止 UDP (最高优先级 · 强制覆写) */}
                    <div className="flex items-start justify-between p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>禁止 UDP (最高优先级 · 强制覆写)</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            防 QUIC 延迟
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          业务远端解析当前支持 TCP；UDP 保持阻断，避免出口在本地解析目标域名。历史 UDP 选择保留。
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.blockUdp}
                        onChange={(e) => setPolicy({ ...policy, blockUdp: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 cursor-pointer"
                      />
                    </div>

                    {/* 代理 UDP 数据报 (仅 SOCKS5 支持) */}
                    <div
                      className={`flex items-start justify-between p-2.5 rounded-xl border transition-colors ${
                        policy.blockUdp
                          ? "bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] opacity-50"
                          : "bg-white/40 dark:bg-white/5 border-[var(--glass-border-subtle)]"
                      }`}
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
                        <div className="text-[10px] text-[var(--text-muted)]">
                          当未开启「禁止 UDP」且出口支持 SOCKS5 时通过 UDP ASSOCIATE 转发；若上游不支持将平滑降级
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={policy.blockUdp}
                        checked={!policy.blockUdp && policy.proxyUdp}
                        onChange={(e) => setPolicy({ ...policy, proxyUdp: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 disabled:opacity-40 cursor-pointer"
                      />
                    </div>

                    {/* 代理衍生子进程 */}
                    <div className="flex items-start justify-between p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                          代理衍生子进程
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Detours 自动追踪主程序创建的渲染、网络与辅助子进程链条，保持完整的代理环境
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.proxySubprocesses}
                        onChange={(e) => setPolicy({ ...policy, proxySubprocesses: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 cursor-pointer"
                      />
                    </div>

                    {/* 禁用启动代理参数 */}
                    <div className="p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="space-y-0.5 pr-3">
                          <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                            <span>禁用启动代理参数 (--proxy-server)</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              安全自检兼容
                            </span>
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            禁止向应用启动命令行追加 --proxy-server 等参数。适用于 Google Gemini 等限制调试与网络覆盖开关的应用
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(policy.disallowProxyArgs)}
                          onChange={(e) => setPolicy({ ...policy, disallowProxyArgs: e.target.checked })}
                          className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 cursor-pointer"
                        />
                      </div>

                      {policy.disallowProxyArgs && (
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 leading-relaxed flex items-start gap-1.5">
                          <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>
                            开启此项后应用将以无参数启动；需配合 <strong>WinDivert 驱动</strong> 或 <strong>用户态 Hook</strong> 底层接管分流。若处于纯应用层代理模式，流量将直接直连。
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 存量旧长连接接管策略 (TCP Hot-Reset) */}
                    <div className="p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)] space-y-2">
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>存量旧长连接接管策略 (TCP Hot-Reset)</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            免重启自愈
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          开启分流或切换出口时处理已建立的长连接。迫使应用 0.1 秒内自动重连切入代理
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {[
                          { value: "prompt", label: "智能询问", desc: "检测到旧连接时弹窗" },
                          { value: "auto_reset", label: "自动热刷新", desc: "0ms 无感秒切免重启" },
                          { value: "ignore", label: "仅接管新连接", desc: "保持旧连接直连" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setPolicy({ ...policy, staleConnectionStrategy: opt.value as BundleStaleConnectionStrategy })}
                            className={`p-2 rounded-lg text-left border transition-all cursor-pointer ${
                              policy.staleConnectionStrategy === opt.value
                                ? "bg-blue-500/15 border-blue-500 text-[var(--text-primary)] font-medium ring-1 ring-blue-500/40"
                                : "bg-black/5 dark:bg-white/5 border-[var(--glass-border-subtle)] text-[var(--text-muted)] hover:border-black/20 dark:hover:border-white/20"
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
                              ? "bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/80 ring-1 ring-blue-500/30"
                              : "bg-white/40 dark:bg-white/5 border-[var(--glass-border-subtle)] hover:border-black/20 dark:hover:border-white/20"
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
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-blue-500/10 text-blue-400">
                                推荐 · 100% 兼容
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                              通过专用纯净解析通道向 DoH/DoT 安全上游获取真实公网 IP，SOCKS5 发送真实 IP；绝对兼容各类严苛软件，无任何假 IP 认知偏差
                            </div>
                          </div>
                        </label>

                        {/* fake_ip */}
                        <label
                          className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                            policy.dnsMode === "fake_ip"
                              ? "bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/80 ring-1 ring-blue-500/30"
                              : "bg-white/40 dark:bg-white/5 border-[var(--glass-border-subtle)] hover:border-black/20 dark:hover:border-white/20"
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
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-emerald-500/10 text-emerald-400">
                                秒开 · 零本地泄露
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                              本地 0ms 瞬间生成 198.18.x.x 假 IP，SOCKS5 CONNECT 报文携带原始域名（ATYP=0x03），远端节点解析；性能天花板，适合网页与 AI 工具
                            </div>
                          </div>
                        </label>

                        {/* system_native */}
                        <label
                          className={`flex items-start p-2.5 rounded-xl border transition-all cursor-pointer ${
                            policy.dnsMode === "system_native"
                              ? "bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/80 ring-1 ring-blue-500/30"
                              : "bg-white/40 dark:bg-white/5 border-[var(--glass-border-subtle)] hover:border-black/20 dark:hover:border-white/20"
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
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-black/10 dark:bg-white/10 text-[var(--text-muted)]">
                                直接放行
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                              完全不劫持 DNS 解析，直接使用系统物理网络配置的 DNS 服务器；适合无需 DNS 护航的特定内网环境
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* 绕过局域网与本地回环 */}
                    <div className="flex items-start justify-between p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
                      <div className="space-y-0.5 pr-3">
                        <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>本地回环与局域网直连绕过 (Bypass LAN)</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            开发者必备
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                          127.0.0.1、localhost 以及 RFC1918 私网段（192.168.x.x、10.x.x.x）直连放行，本地服务调试与内网调用不走代理
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={policy.bypassLan}
                        onChange={(e) => setPolicy({ ...policy, bypassLan: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded text-blue-500 focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {/* Tab 3: 目标与端口 */}
                {activePolicyTab === "filter" && (
                  <div className="space-y-3">
                    {/* 端口过滤 */}
                    <div className="space-y-2 p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
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
                            className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                          />
                          <p className="text-[9px] text-[var(--text-muted)] font-mono">
                            支持单端口（如 443）及端口区间（如 3000-3010）。
                          </p>
                        </div>
                      )}
                    </div>

                    {/* 目标域名/IP 过滤 */}
                    <div className="space-y-2 p-2.5 rounded-xl bg-white/40 dark:bg-white/5 border border-[var(--glass-border-subtle)]">
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
                            className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--glass-border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
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
          </div>

          {/* 5. 底部按钮栏 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3 py-1.5 text-xs font-medium rounded-xl border border-[var(--glass-border-subtle)] hover:border-black/20 dark:hover:border-white/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-1.5 text-xs font-medium rounded-xl bg-blue-500 hover:bg-blue-600 text-white shadow-[0_2px_10px_rgba(59,130,246,0.3)] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSaving && (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              <span>{isSaving ? "正在下发驱动..." : mode === "create" ? "创建并生效" : "保存并下发"}</span>
            </button>
          </div>
        </form>
      </div>

      {/* 运行中进程选择器弹窗 */}
      <RunningProcessPickerModal
        isOpen={showProcessPicker}
        onClose={() => setShowProcessPicker(false)}
        onSelect={handleSelectRunningProcess}
        existingExes={exes}
      />

      {/* 恢复出厂默认预设微晶确认模态窗 (替代原生 window.confirm) */}
      <ConfirmModal
        isOpen={showResetConfirm}
        title="恢复官方出厂默认预设？"
        description={
          <>
            确定要将业务套件{" "}
            <span className="font-semibold text-[var(--text-primary)]">
              [{bundle?.name}]
            </span>{" "}
            恢复为官方出厂默认预设吗？您在此套件中的自定义进程名单与防护修改将被覆盖。
          </>
        }
        confirmText="恢复预设"
        cancelText="取消"
        variant="warning"
        isLoading={isSaving}
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={handleExecuteReset}
      />
    </div>
  );
};
