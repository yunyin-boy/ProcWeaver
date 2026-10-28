import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { BundleLocalInstance } from "../../types/businessBundle";
import { Network, X, Search, Check, Shield, Zap, ShieldCheck } from "lucide-react";
import { testDelay, getPreferredSpeedTestUrl } from "../../api/mihomo";
import { getPersistedHealthCache, probeNodeHealthBatch, savePersistedHealthCache } from "../../api/nodeHealth";
import type { IpHealthInfo } from "../../types";

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
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedMain, setSelectedMain] = useState<string | null>(null);
  const [followMainDns, setFollowMainDns] = useState<boolean>(true);
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
      const currentDns = instance.slotBindings.dns || null;
      setSelectedMain(currentMain);
      if (!currentDns || currentDns === "FOLLOW_MAIN") {
        setFollowMainDns(true);
        setSelectedDns(null);
      } else {
        setFollowMainDns(false);
        setSelectedDns(currentDns);
      }
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
    const finalDns = followMainDns ? "FOLLOW_MAIN" : selectedDns;
    onConfirm(instance.instanceId, selectedMain, finalDns);
    onCancel();
  };

  const handleDoubleSelect = (proxyName: string) => {
    setSelectedMain(proxyName);
    const finalDns = followMainDns ? "FOLLOW_MAIN" : selectedDns;
    onConfirm(instance.instanceId, proxyName, finalDns);
    onCancel();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" data-no-drag>
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in duration-150">
        
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl shadow-inner">
              {def.icon || "🌐"}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  选择业务出口 · {def.packageName}
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {def.packageVersion}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                为该业务规则包指定专属出站落地节点，实现独立通道隔离
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 搜索与快捷过滤 */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索节点名称、地区关键词（如 香港、JP、US、专线）..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-0.5 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* 解除绑定快捷项 */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">
              双击任意节点可直接快速选定并生效
            </span>
            <button
              type="button"
              onClick={() => setSelectedMain(null)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                selectedMain === null
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              ⚪ 不绑定出口 (跟随系统默认)
            </button>
          </div>
        </div>

        {/* 节点列表展示区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-[220px] max-h-[340px]">
          {filteredProxies.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Network className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
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
                  ? "text-slate-400 dark:text-slate-500"
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
                      ? "bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500/60 dark:border-indigo-500/60 text-indigo-900 dark:text-indigo-200 font-bold shadow-2xs"
                      : "bg-white dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {/* 左侧：状态圆点 + 节点标签 */}
                  <div className="flex items-center space-x-2.5 truncate mr-2 min-w-0">
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isSelected ? "bg-emerald-500 ring-2 ring-emerald-500/20" : "bg-slate-300 dark:bg-slate-600"
                      }`}
                    />
                    <span className="truncate font-mono text-xs">{label}</span>
                  </div>

                  {/* 右侧：延迟 + 健康分 + 操作图标 (方案 B：仅行内图标，双击防误触) */}
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

                    {/* 行内单测延迟图标按钮 (严格阻断冒泡防误触) */}
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
                      className="p-1 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                    >
                      <Zap className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-amber-500" : ""}`} />
                    </button>

                    {/* 行内单测健康分体检图标按钮 (严格阻断冒泡防误触) */}
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
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                    >
                      <ShieldCheck className={`w-3.5 h-3.5 ${isProbing ? "animate-pulse text-indigo-500" : ""}`} />
                    </button>

                    {/* 已选指示标签 */}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-600 text-white flex items-center space-x-0.5 shadow-xs ml-1">
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

        {/* DNS 出口联动配置区 */}
        <div className="p-3.5 bg-slate-50/90 dark:bg-slate-950/70 border-t border-slate-200/80 dark:border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="w-3.5 h-3.5 text-indigo-500" />
              <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                域名 DNS 解析出口插槽:
              </span>
            </div>
            <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] text-slate-600 dark:text-slate-300 select-none">
              <input
                type="checkbox"
                checked={followMainDns}
                onChange={(e) => {
                  setFollowMainDns(e.target.checked);
                  if (e.target.checked) {
                    setSelectedDns(null);
                  }
                }}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>跟随主业务出口（推荐）</span>
            </label>
          </div>

          {!followMainDns && (
            <div className="pt-1.5 flex items-center space-x-2 animate-in fade-in">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">独立 DNS 节点:</span>
              <select
                value={selectedDns || ""}
                onChange={(e) => setSelectedDns(e.target.value || null)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 font-bold focus:outline-none focus:border-indigo-500"
              >
                <option value="">未指定独立 DNS 节点 (跟随核心默认)</option>
                {availableProxies.map((p) => (
                  <option key={p} value={p}>
                    {proxyLabels[p] || p}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
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
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition cursor-pointer flex items-center space-x-1"
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
