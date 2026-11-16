import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { BundleLocalInstance } from "../../types/businessBundle";
import { Network, X, Search, Check, Shield, Zap, ShieldCheck } from "lucide-react";
import { testDelay, getPreferredSpeedTestUrl } from "../../api/mihomo";
import { getPersistedHealthCache, probeNodeHealthBatch, savePersistedHealthCache } from "../../api/nodeHealth";
import type { IpHealthInfo } from "../../types";
import { usePlatform } from "../../context/PlatformContext";

interface Props {
  isOpen: boolean;
  instance: BundleLocalInstance | null;
  availableProxies: string[];
  proxyLabels?: Record<string, string>;
  onConfirm: (instanceId: string, mainExit: string | null, dnsExit?: string | null) => void;
  onCancel: () => void;
}

export const SelectExitModal: React.FC<Props> = ({
  isOpen,
  instance,
  availableProxies,
  proxyLabels = {},
  onConfirm,
  onCancel,
}) => {
  const remoteDns = usePlatform().os === "windows";
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedMain, setSelectedMain] = useState<string | null>(null);
  const [followMainDns, setFollowMainDns] = useState(true);
  const [selectedDns, setSelectedDns] = useState<string | null>(null);

  // 延迟测速状态 (套用节点管理)
  const [delayMap, setDelayMap] = useState<Record<string, number | null>>({});
  const [testingNodes, setTestingNodes] = useState<Record<string, boolean>>({});

  // 健康分与体检状态 (套用节点管理)
  const [healthMap, setHealthMap] = useState<Record<string, IpHealthInfo>>({});
  const [probingNodes, setProbingNodes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (instance && isOpen) {
      const currentMain = instance.slotBindings.main || null;
      setSelectedMain(currentMain);
      const dns = instance.slotBindings.dns;
      setFollowMainDns(!dns || dns === "FOLLOW_MAIN");
      setSelectedDns(dns && dns !== "FOLLOW_MAIN" ? dns : null);
      setSearchQuery("");

      // 弹窗打开时加载本地持久化健康分缓存
      void getPersistedHealthCache().then((cache) => {
        if (cache) setHealthMap(cache);
      });
    }
  }, [instance, isOpen]);

  // 监听全局体检结果更新事件，保持跨界面实时同步
  useEffect(() => {
    const handleHealthUpdated = (e: any) => {
      const { node, health } = e.detail || {};
      if (node && health) {
        setHealthMap((prev) => ({ ...prev, [node]: health }));
      }
    };
    window.addEventListener("netbox-node-health-updated", handleHealthUpdated);
    return () => {
      window.removeEventListener("netbox-node-health-updated", handleHealthUpdated);
    };
  }, []);

  // 单节点延迟测试
  const handleTestDelay = async (nodeName: string) => {
    if (testingNodes[nodeName]) return;
    setTestingNodes((prev) => ({ ...prev, [nodeName]: true }));
    try {
      const endpoint = getPreferredSpeedTestUrl();
      const delay = await testDelay(nodeName, endpoint, 3000);
      setDelayMap((prev) => ({ ...prev, [nodeName]: delay ?? 0 }));
    } catch {
      setDelayMap((prev) => ({ ...prev, [nodeName]: 0 }));
    } finally {
      setTestingNodes((prev) => ({ ...prev, [nodeName]: false }));
    }
  };

  // 单节点健康分体检
  const handleProbeHealth = async (nodeName: string) => {
    if (probingNodes[nodeName]) return;
    setProbingNodes((prev) => ({ ...prev, [nodeName]: true }));
    try {
      await probeNodeHealthBatch([nodeName], (node, result) => {
        if (result) {
          setHealthMap((prev) => {
            const next = { ...prev, [node]: result };
            void savePersistedHealthCache(next);
            return next;
          });
          window.dispatchEvent(new CustomEvent("netbox-node-health-updated", { detail: { node, health: result } }));
        }
      });
    } catch (err) {
      console.warn("单节点体检失败:", err);
    } finally {
      setProbingNodes((prev) => ({ ...prev, [nodeName]: false }));
    }
  };

  // 过滤后的节点列表
  const filteredProxies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableProxies;
    return availableProxies.filter((p) => {
      const label = (proxyLabels[p] || p).toLowerCase();
      return label.includes(q) || p.toLowerCase().includes(q);
    });
  }, [availableProxies, proxyLabels, searchQuery]);

  if (!isOpen || !instance) return null;

  const def = instance.definition;

  const handleSave = () => {
    onConfirm(instance.instanceId, selectedMain, remoteDns ? undefined : followMainDns ? "FOLLOW_MAIN" : selectedDns);
    onCancel();
  };

  const handleDoubleSelect = (proxyName: string) => {
    setSelectedMain(proxyName);
    onConfirm(instance.instanceId, proxyName, remoteDns ? undefined : followMainDns ? "FOLLOW_MAIN" : selectedDns);
    onCancel();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 font-sans" data-no-drag>
      <div className="w-full max-w-xl bg-white/95 dark:bg-[#0d1015]/95 backdrop-blur-2xl border border-slate-200 dark:border-white/10 rounded-2xl shadow-[-25px_25px_60px_-10px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.06)] overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* 头部 (Raycast 风格) */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between bg-slate-50/80 dark:bg-black/30">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/[0.08] flex items-center justify-center text-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]">
              {def.icon || "🌐"}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  选择业务出口 · {def.packageName}
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-zinc-400 border border-slate-200/80 dark:border-white/[0.08]">
                  {def.packageVersion}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                为该业务规则包指定专属出站落地节点，实现独立通道隔离
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-white/5 border border-white/10 rounded">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white p-1 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/[0.08] transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 搜索与快捷过滤 (黑曜石微凹槽) */}
        <div className="p-4 border-b border-slate-100 dark:border-white/[0.06] space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索节点名称、地区关键词（如 香港、JP、US、专线）..."
              className="w-full bg-slate-100/80 dark:bg-black/45 border border-slate-200/80 dark:border-white/[0.08] shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.3)] rounded-xl pl-9 pr-8 py-2 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-200 text-xs p-0.5 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* 解除绑定快捷项 */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-zinc-400 text-[11px]">
              双击任意节点可直接快速选定并生效
            </span>
            <button
              type="button"
              onClick={() => setSelectedMain(null)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                selectedMain === null
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold"
                  : "text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              }`}
            >
              ⚪ 不绑定出口 (跟随系统默认)
            </button>
          </div>
        </div>

        {/* 节点列表展示区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-[220px] max-h-[340px]">
          {filteredProxies.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-zinc-500 space-y-2">
              <Network className="w-8 h-8 mx-auto text-slate-300 dark:text-zinc-600" />
              <p className="text-xs">未找到匹配的出站节点</p>
            </div>
          ) : (
            filteredProxies.map((proxy) => {
              const isSelected = selectedMain === proxy;
              const label = proxyLabels[proxy] || proxy;

              // 延迟状态与样式 (套用节点管理)
              const delay = delayMap[proxy] ?? null;
              const isTesting = Boolean(testingNodes[proxy]);
              const delayText = isTesting ? "测速中" : delay === null ? "未测速" : delay <= 0 ? "超时" : `${delay}ms`;
              const delayColor =
                delay === null
                  ? "text-slate-400 dark:text-zinc-500"
                  : delay <= 0 || delay >= 500
                  ? "text-rose-500 font-bold"
                  : delay < 200
                  ? "text-emerald-600 dark:text-emerald-400 font-bold"
                  : "text-amber-600 dark:text-amber-400 font-semibold";

              // 健康分状态与样式 (套用节点管理)
              const health = healthMap[proxy];
              const isProbing = Boolean(probingNodes[proxy]);
              const fraudScore = health?.fraudScore;
              const scoreBadgeClass =
                fraudScore == null
                  ? ""
                  : fraudScore <= 25
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300/80"
                  : fraudScore <= 60
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300/80"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300/80";

              return (
                <div
                  key={proxy}
                  onClick={() => setSelectedMain(proxy)}
                  onDoubleClick={() => handleDoubleSelect(proxy)}
                  className={`px-3 py-2 rounded-xl text-xs flex items-center justify-between border cursor-pointer select-none transition ${
                    isSelected
                      ? "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                      : "bg-white dark:bg-[#121316]/50 border-slate-200/70 dark:border-white/[0.06] hover:border-slate-300 dark:hover:border-white/[0.15] hover:bg-slate-50 dark:hover:bg-white/[0.04] text-slate-700 dark:text-zinc-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
                  }`}
                >
                  {/* 左侧：状态圆点 + 节点标签 */}
                  <div className="flex items-center space-x-2.5 truncate mr-2 min-w-0">
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isSelected ? "bg-emerald-500 ring-2 ring-emerald-500/20" : "bg-slate-300 dark:bg-zinc-600"
                      }`}
                    />
                    <span className="truncate font-mono text-xs">{label}</span>
                  </div>

                  {/* 右侧：延迟 + 健康分 + 操作图标 */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {/* 健康分徽标 (若有数据) */}
                    {fraudScore != null && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md border font-semibold ${scoreBadgeClass}`}
                        title={`欺诈风险分: ${fraudScore}${health?.country ? ` (${health.country})` : ""}`}
                      >
                        {fraudScore}分
                      </span>
                    )}

                    {/* 延迟数值展示 */}
                    <span className={`text-[11px] font-mono flex items-center space-x-0.5 ${delayColor}`}>
                      <Zap className={`w-3 h-3 ${isTesting ? "animate-bounce text-amber-500" : ""}`} />
                      <span>{delayText}</span>
                    </span>

                    {/* 行内单测延迟图标按钮 */}
                    <button
                      type="button"
                      title={isTesting ? "测速中…" : "测此节点延迟"}
                      disabled={isTesting}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleTestDelay(proxy);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="p-1 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer disabled:opacity-50"
                    >
                      <Zap className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-amber-500" : ""}`} />
                    </button>

                    {/* 行内单测健康分体检图标按钮 */}
                    <button
                      type="button"
                      title={isProbing ? "体检中…" : "检测 IP 风险与健康分"}
                      disabled={isProbing}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleProbeHealth(proxy);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="p-1 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer disabled:opacity-50"
                    >
                      <ShieldCheck className={`w-3.5 h-3.5 ${isProbing ? "animate-pulse text-sky-400" : ""}`} />
                    </button>

                    {/* 已选指示标签 */}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500 text-white flex items-center space-x-0.5 shadow-xs ml-1">
                        <Check className="w-3 h-3" />
                        <span>已选</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 业务 DNS 与连接共享主出口 */}
        <div className="p-3.5 bg-slate-50/90 dark:bg-black/30 border-t border-slate-200/80 dark:border-white/[0.08] text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-bold text-slate-800 dark:text-zinc-200 text-[11px]">
                {remoteDns ? "业务域名通过所选主出口交远端解析" : "域名 DNS 解析出口插槽"}
              </span>
            </div>
          </div>

          {remoteDns ? <p className="text-[11px] text-slate-500 dark:text-zinc-400">不使用公共 DNS 上游；旧独立 DNS 插槽保留为历史配置，不参与运行。</p> : <>
            <label className="flex gap-2 items-center text-slate-700 dark:text-zinc-300"><input type="checkbox" checked={followMainDns} onChange={e => setFollowMainDns(e.target.checked)} />跟随主业务出口</label>
            {!followMainDns && <select value={selectedDns ?? ""} onChange={e => setSelectedDns(e.target.value || null)} className="w-full p-2 rounded-lg bg-slate-100 dark:bg-black/45 border border-slate-200/80 dark:border-white/[0.08] text-slate-800 dark:text-zinc-200">
              <option value="">跟随核心默认</option>
              {availableProxies.map(proxy => <option key={proxy} value={proxy}>{proxyLabels[proxy] || proxy}</option>)}
            </select>}
          </>}
        </div>

        {/* 底部按钮栏 */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between bg-white dark:bg-black/40">
          <div className="text-xs text-slate-500 dark:text-zinc-400 truncate max-w-[280px]">
            {selectedMain ? (
              <span>当前选定：<strong className="text-emerald-600 dark:text-emerald-400 font-mono">{proxyLabels[selectedMain] || selectedMain}</strong></span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">将停用专属出口 (跟随系统)</span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.8)] active:scale-95 transition cursor-pointer flex items-center space-x-1"
            >
              <span>确认应用</span>
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
