// ==========================================================================
// ProcWeaver src-next 系统首选项与内核设置视图 (Settings View)
// 规范溯源: impeccable-design / taste-skill / tauri-desktop-layout-typography / typography-dark-mono-optics
// 风格约束: 严禁任何 Emoji，全量内联细线 SVG，四维工作台分栏，杜绝折行挤压，等宽排版
// ==========================================================================

import React, { useState, useEffect } from "react";
import { GeneralSettings, DEFAULT_GENERAL_SETTINGS } from "../../types/settings";
import { DnsSettings, DnsEnhancedMode, DEFAULT_DNS_SETTINGS } from "../../types/dns";
import {
  MihomoCoreDetail,
  GeoConfig,
  AppUpdateInfo,
  MihomoReleaseInfo,
} from "../../types/maintenance";
import {
  getGeneralSettings,
  saveGeneralSettings,
  exportConfigSnapshot,
  restoreConfigSnapshot,
  cleanWindivertResidualService,
} from "../../services/settingsService";
import {
  getDnsSettings,
  saveDnsSettings,
  flushDns,
  reloadCoreConfig,
} from "../../services/dnsService";
import {
  getMihomoCoreDetail,
  getGeoConfig,
  syncGeoResource,
  syncAllGeoResources,
  checkAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  checkMihomoUpdate,
} from "../../services/maintenanceService";

interface SettingsViewProps {
  onShowNotice?: (msg: string) => void;
}

type SettingsSubTab = "general" | "dns" | "app" | "geo";

export const SettingsView: React.FC<SettingsViewProps> = ({ onShowNotice }) => {
  // 当前子工作台分栏
  const [activeTab, setActiveTab] = useState<SettingsSubTab>("general");

  // 1. 常规设置数据
  const [general, setGeneral] = useState<GeneralSettings>({ ...DEFAULT_GENERAL_SETTINGS });
  // 2. DNS 覆写设置数据
  const [dns, setDns] = useState<DnsSettings>({ ...DEFAULT_DNS_SETTINGS });
  // 3. 运维与离线数据
  const [coreDetail, setCoreDetail] = useState<MihomoCoreDetail | null>(null);
  const [geoConfig, setGeoConfig] = useState<GeoConfig | null>(null);

  // 4. 客户端应用更新状态 (Update Center)
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [isCheckingApp, setIsCheckingApp] = useState(false);
  const [isDownloadingApp, setIsDownloadingApp] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<string>("");
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [isInstallingApp, setIsInstallingApp] = useState(false);
  const [installedSuccess, setInstalledSuccess] = useState(false);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);

  // 5. Mihomo 代理内核版本与检测
  const [mihomoRelease, setMihomoRelease] = useState<MihomoReleaseInfo | null>(null);
  const [isCheckingMihomo, setIsCheckingMihomo] = useState(false);

  // 6. 窗口背景通透度与毛玻璃景深调节 (Window Optics & Transparency)
  const [windowOpacity, setWindowOpacity] = useState<number>(() => {
    const v = localStorage.getItem("procweaver_window_opacity");
    const num = v ? Math.round(parseFloat(v) * 100) : 95;
    return num < 85 ? 95 : num;
  });
  const [windowBlur, setWindowBlur] = useState<number>(() => {
    const v = localStorage.getItem("procweaver_window_blur");
    return v ? parseInt(v, 10) : 32;
  });

  const handleOpacityChange = (val: number) => {
    setWindowOpacity(val);
    const alpha = (val / 100).toFixed(2);
    document.documentElement.style.setProperty("--window-opacity", alpha);
    localStorage.setItem("procweaver_window_opacity", alpha);
  };

  const handleBlurChange = (val: number) => {
    setWindowBlur(val);
    document.documentElement.style.setProperty("--window-blur", `${val}px`);
    localStorage.setItem("procweaver_window_blur", String(val));
  };

  // 初始配置快照引用 (用于精细化脏检查与按需保存)
  const initialGeneralRef = React.useRef<string>("");
  const initialDnsRef = React.useRef<string>("");

  // 状态与加载指示
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isFlushingDns, setIsFlushingDns] = useState(false);
  const [isReloadingCore, setIsReloadingCore] = useState(false);
  const [syncingGeoId, setSyncingGeoId] = useState<string | null>(null);
  const [isSyncingAllGeo, setIsSyncingAllGeo] = useState(false);

  // 7. WinDivert 底层驱动服务清理状态与交互
  const [isCleaningDriver, setIsCleaningDriver] = useState(false);
  const [driverCleanResult, setDriverCleanResult] = useState<{ text: string; error?: boolean } | null>(null);

  const handleCleanDriverResidual = async () => {
    if (
      !window.confirm(
        "确定要清理 WinDivert 内核驱动残留服务及临时文件吗？\n此操作将停止并移除系统服务并清理已解压的驱动文件。"
      )
    ) {
      return;
    }
    setIsCleaningDriver(true);
    setDriverCleanResult(null);
    try {
      const res = await cleanWindivertResidualService();
      setDriverCleanResult({ text: res, error: false });
      if (onShowNotice) {
        onShowNotice(res);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setDriverCleanResult({ text: errMsg, error: true });
      if (onShowNotice) {
        onShowNotice(`清理残留驱动失败: ${errMsg}`);
      }
    } finally {
      setIsCleaningDriver(false);
    }
  };

  // DNS 新增 Filter 域名临时输入
  const [newFilterDomain, setNewFilterDomain] = useState("");

  // 加载全量设置
  const loadAllSettings = async () => {
    setIsLoading(true);
    try {
      const [g, d, c, geo] = await Promise.all([
        getGeneralSettings(),
        getDnsSettings(),
        getMihomoCoreDetail(),
        getGeoConfig(),
      ]);
      setGeneral(g);
      setDns(d);
      setCoreDetail(c);
      setGeoConfig(geo);
      initialGeneralRef.current = JSON.stringify(g);
      initialDnsRef.current = JSON.stringify(d);
      setHasChanges(false);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`加载设置失败: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllSettings();
  }, []);

  // 保存所有更改 (仅对实质改动的模块进行按需提交，杜绝无谓重启与跨模块级联故障)
  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const generalChanged = initialGeneralRef.current !== JSON.stringify(general);
      const dnsChanged = initialDnsRef.current !== JSON.stringify(dns);

      const tasks: Promise<any>[] = [];
      if (generalChanged) {
        tasks.push(saveGeneralSettings(general));
      }
      if (dnsChanged) {
        tasks.push(saveDnsSettings(dns));
      }

      if (tasks.length === 0) {
        setHasChanges(false);
        setIsSaving(false);
        if (onShowNotice) onShowNotice("配置未发生改动");
        return;
      }

      await Promise.all(tasks);
      initialGeneralRef.current = JSON.stringify(general);
      initialDnsRef.current = JSON.stringify(dns);
      setHasChanges(false);
      if (onShowNotice) {
        if (generalChanged && dnsChanged) {
          onShowNotice("系统首选项与 DNS 配置已成功保存生效");
        } else if (dnsChanged) {
          onShowNotice("DNS 配置已成功保存生效");
        } else {
          onShowNotice("常规系统首选项已成功保存生效");
        }
      }
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`保存失败: ${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 重置当前模块到默认值
  const handleResetCurrentTab = () => {
    if (activeTab === "general") {
      setGeneral({ ...DEFAULT_GENERAL_SETTINGS });
      setHasChanges(JSON.stringify(DEFAULT_GENERAL_SETTINGS) !== initialGeneralRef.current);
      if (onShowNotice) onShowNotice("常规设置已重置为官方推荐默认值");
    } else if (activeTab === "dns") {
      setDns({ ...DEFAULT_DNS_SETTINGS });
      setHasChanges(JSON.stringify(DEFAULT_DNS_SETTINGS) !== initialDnsRef.current);
      if (onShowNotice) onShowNotice("DNS 设置已重置为官方防污染推荐方案");
    }
  };

  // 更新常规设置字段
  const updateGeneral = <K extends keyof GeneralSettings>(key: K, val: GeneralSettings[K]) => {
    setGeneral((prev) => {
      const next = { ...prev, [key]: val };
      const generalChanged = JSON.stringify(next) !== initialGeneralRef.current;
      const dnsChanged = JSON.stringify(dns) !== initialDnsRef.current;
      setHasChanges(generalChanged || dnsChanged);
      return next;
    });
  };

  // 更新 DNS 设置字段
  const updateDns = <K extends keyof DnsSettings>(key: K, val: DnsSettings[K]) => {
    setDns((prev) => {
      const next = { ...prev, [key]: val };
      const generalChanged = JSON.stringify(general) !== initialGeneralRef.current;
      const dnsChanged = JSON.stringify(next) !== initialDnsRef.current;
      setHasChanges(generalChanged || dnsChanged);
      return next;
    });
  };

  // 添加 Fake-IP 过滤域名
  const handleAddFilterDomain = () => {
    const trimmed = newFilterDomain.trim().toLowerCase();
    if (!trimmed) return;
    if (dns.fakeIpFilter.includes(trimmed)) {
      if (onShowNotice) onShowNotice("该域名规则已存在于过滤列表中");
      return;
    }
    updateDns("fakeIpFilter", [...dns.fakeIpFilter, trimmed]);
    setNewFilterDomain("");
  };

  // 删除 Fake-IP 过滤域名
  const handleRemoveFilterDomain = (domain: string) => {
    updateDns("fakeIpFilter", dns.fakeIpFilter.filter((d) => d !== domain));
  };

  // 快捷网络急救（刷新 DNS 缓存）
  const handleFlushDns = async () => {
    setIsFlushingDns(true);
    try {
      await flushDns();
      if (onShowNotice) onShowNotice("网络急救完成: 本地 DNS 缓存已清空并恢复默认路由");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`网络急救失败: ${e?.message || e}`);
    } finally {
      setIsFlushingDns(false);
    }
  };

  // 重启核心
  const handleReloadCore = async () => {
    setIsReloadingCore(true);
    try {
      await reloadCoreConfig();
      if (onShowNotice) onShowNotice("代理核心已平滑重启并重载最新配置");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`重启核心失败: ${e?.message || e}`);
    } finally {
      setIsReloadingCore(false);
    }
  };

  // 单个更新 Geo 资源
  const handleSyncGeo = async (id: string) => {
    setSyncingGeoId(id);
    try {
      await syncGeoResource(id);
      const updated = await getGeoConfig();
      setGeoConfig(updated);
      if (onShowNotice) onShowNotice("离线特征数据库已更新完成");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`更新 Geo 失败: ${e?.message || e}`);
    } finally {
      setSyncingGeoId(null);
    }
  };

  // 全量更新 Geo 资源
  const handleSyncAllGeo = async () => {
    setIsSyncingAllGeo(true);
    try {
      const updated = await syncAllGeoResources();
      setGeoConfig(updated);
      if (onShowNotice) onShowNotice("全量 GeoIP / GeoSite 数据库已同步至最新");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`全量更新失败: ${e?.message || e}`);
    } finally {
      setIsSyncingAllGeo(false);
    }
  };

  // 检查客户端主程序更新
  const handleCheckAppUpdate = async () => {
    setIsCheckingApp(true);
    setAppUpdateError(null);
    try {
      const data = await checkAppUpdate();
      setAppUpdate(data);
      if (data.hasUpdate) {
        if (onShowNotice) onShowNotice(`发现 ProcWeaver 新版本: ${data.latestVersion}`);
      } else {
        if (onShowNotice) onShowNotice("ProcWeaver 当前已是最新版本");
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setAppUpdateError(msg);
      if (onShowNotice) onShowNotice(`检查客户端更新失败: ${msg}`);
    } finally {
      setIsCheckingApp(false);
    }
  };

  // 一键全自动平滑更新流水线（自动下载 -> 解压部署 -> 脚本接管无损重启）
  const handleOneClickAutoUpdate = async () => {
    if (!appUpdate?.downloadUrl) return;
    setIsDownloadingApp(true);
    setAppUpdateError(null);

    try {
      let localPath = downloadedPath;
      if (!localPath) {
        const fileName = appUpdate.assetName || "ProcWeaver_Portable.zip";
        setDownloadProgress(`正在下载便携更新包 (${appUpdate.assetSizeFormatted || "最新版"})...`);
        localPath = await downloadAppUpdate(appUpdate.downloadUrl, fileName);
        setDownloadedPath(localPath);
      }

      setIsDownloadingApp(false);
      setIsInstallingApp(true);
      setDownloadProgress("更新包校验通过，正在无损热替换并重启...");
      if (onShowNotice) onShowNotice("便携更新包已就绪，正在准备全量热替换并重启...");

      await installAppUpdate(localPath);
      setInstalledSuccess(true);
      setDownloadProgress("更新引擎已接管，主程序正在平滑重启...");
      if (onShowNotice) onShowNotice("主程序正在重启，即将载入新版本...");
    } catch (e: any) {
      const msg = e?.message || String(e);
      setAppUpdateError(msg);
      setDownloadProgress("");
      if (onShowNotice) onShowNotice(`自动更新失败: ${msg}`);
    } finally {
      setIsDownloadingApp(false);
      setIsInstallingApp(false);
    }
  };

  // 检查官方 Mihomo 内核新版本
  const handleCheckMihomo = async () => {
    setIsCheckingMihomo(true);
    try {
      const rel = await checkMihomoUpdate();
      setMihomoRelease(rel);
      if (onShowNotice) onShowNotice(`Mihomo 最新发行版: ${rel.latestVersion}`);
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`检查内核更新失败: ${e?.message || e}`);
    } finally {
      setIsCheckingMihomo(false);
    }
  };

  // 当用户切换到更新中心 Tab 时，自动进行一次检测（如果尚未检测）
  useEffect(() => {
    if (activeTab === "geo" && !appUpdate && !isCheckingApp) {
      handleCheckAppUpdate();
    }
  }, [activeTab]);

  // 导出配置快照
  const handleExportSnapshot = async () => {
    try {
      const json = await exportConfigSnapshot();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `procweaver-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (onShowNotice) onShowNotice("配置快照已成功导出");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`导出配置快照失败: ${e?.message || e}`);
    }
  };

  // 导入恢复配置快照
  const handleRestoreSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await restoreConfigSnapshot(text);
      await loadAllSettings();
      if (onShowNotice) onShowNotice("配置快照已恢复，设置已重新载入");
    } catch (e: any) {
      if (onShowNotice) onShowNotice(`恢复配置失败: ${e?.message || e}`);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-4 pb-12">
      {/* ============================================================== */}
      {/* 极简悬浮一体化工作台导航栏 (Linear / Raycast Segmented Control Bar) */}
      {/* 规范: distill 剔除冗余标题 / polish 微交互触觉回馈 / 脏数据脉冲感知 */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-1.5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] shadow-sm">
        {/* 左侧: 4 项紧凑无缝胶囊分段选项卡 (Segmented Track) */}
        <nav
          aria-label="设置分栏导航"
          className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-sunken)]/90 border border-white/5 overflow-x-auto scrollbar-none"
        >
          {[
            {
              id: "general" as const,
              label: "常规与测速",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              ),
            },
            {
              id: "dns" as const,
              label: "DNS 与 Fake-IP",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              ),
            },
            {
              id: "app" as const,
              label: "系统与托盘偏好",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              ),
            },
            {
              id: "geo" as const,
              label: "更新中心",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ),
            },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 active:scale-[0.97] select-none ${
                  isActive
                    ? "bg-white/10 dark:bg-white/[0.12] text-[var(--text-primary)] shadow-sm border border-white/10 ring-1 ring-white/10"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05] border border-transparent"
                }`}
              >
                <div
                  className={`transition-colors duration-150 ${
                    isActive ? "text-indigo-400 dark:text-indigo-300" : "text-[var(--text-muted)]"
                  }`}
                >
                  {tab.icon}
                </div>
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* 右侧: 全局操作按钮 (重置预设 + 脏数据高亮保存生效) */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 pr-1">
          {hasChanges && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20 animate-pulse whitespace-nowrap shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>有未保存改动</span>
            </span>
          )}

          {(activeTab === "general" || activeTab === "dns") && (
            <button
              type="button"
              onClick={handleResetCurrentTab}
              disabled={isLoading || isSaving}
              className="px-2.5 py-1.5 rounded-xl border border-[var(--glass-border-subtle)] bg-[var(--surface-sunken)] hover:bg-[var(--glass-hover)] active:scale-[0.97] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium transition cursor-pointer whitespace-nowrap shrink-0"
              title="重置当前分栏为官方推荐方案"
            >
              重置预设
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isLoading || isSaving || !hasChanges}
            className={`px-3.5 py-1.5 rounded-xl text-[12px] font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 active:scale-[0.97] ${
              hasChanges
                ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/25 border border-indigo-400/30"
                : "bg-[var(--surface-sunken)]/60 text-[var(--text-muted)] border border-[var(--glass-border-subtle)] opacity-60 cursor-not-allowed"
            }`}
          >
            {isSaving ? (
              <svg className="w-3.5 h-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span>{isSaving ? "正在应用..." : hasChanges ? "保存并生效" : "已是最新"}</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 子分栏 1: 常规网络与性能测速 (General & Core) */}
      {/* ============================================================== */}
      {activeTab === "general" && (
        <div className="space-y-4">
          {/* 卡片 1: 监听端口与网络共享 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
              <span>网络监听端口与出入站</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Mixed 本地混合端口 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-[var(--text-primary)]">
                    Mixed 混合代理端口
                  </label>
                  <span className="text-[10px] text-emerald-500 font-mono">SOCKS5 + HTTP</span>
                </div>
                <input
                  type="number"
                  value={general.mixedPort}
                  onChange={(e) => updateGeneral("mixedPort", Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)] text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-indigo-500 transition"
                  placeholder="7890"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  系统代理与各应用自动接入的统一本地监听端口
                </p>
              </div>

              {/* REST API 控制端口 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-[var(--text-primary)]">
                    API 外部控制端口
                  </label>
                  <button
                    type="button"
                    onClick={() => updateGeneral("enableControllerPort", !general.enableControllerPort)}
                    className="text-[11px] text-indigo-500 hover:text-indigo-400 font-medium cursor-pointer"
                  >
                    {general.enableControllerPort ? "已启用" : "已关闭"}
                  </button>
                </div>
                <input
                  type="number"
                  disabled={!general.enableControllerPort}
                  value={general.controllerPort}
                  onChange={(e) => updateGeneral("controllerPort", Number(e.target.value))}
                  className={`w-full px-3.5 py-2 rounded-xl border text-[var(--text-primary)] font-mono text-sm transition ${
                    general.enableControllerPort
                      ? "bg-[var(--surface-sunken)] border-[var(--glass-border-subtle)] focus:outline-none focus:border-indigo-500"
                      : "bg-[var(--surface-sunken)]/40 border-[var(--glass-border-subtle)] opacity-50 cursor-not-allowed"
                  }`}
                  placeholder="9090"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  供 Web 仪表盘与排障流实时读取会话数据的 RESTful API 端口
                </p>
              </div>
            </div>

            {/* 开关行: 局域网接入与 IPv6 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--glass-border-subtle)]">
              {/* Allow LAN */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    允许局域网连接 (Allow LAN)
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    同 WiFi 下手机等设备可填本机 IP 使用代理
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updateGeneral("allowLan", !general.allowLan)}
                  className={`w-10 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer shrink-0 ${
                    general.allowLan ? "bg-indigo-600" : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      general.allowLan ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* IPv6 支持 */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    IPv6 流量穿透
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    开启接收 IPv6；关闭可杜绝部分运营商握手黑洞
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updateGeneral("ipv6", !general.ipv6)}
                  className={`w-10 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer shrink-0 ${
                    general.ipv6 ? "bg-indigo-600" : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      general.ipv6 ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* 卡片 2: 内核加速与性能参数 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>内核运行加速与连接策略</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: "tcpConcurrent" as const,
                  title: "TCP 并发建连",
                  desc: "同时向域名解析的所有 IP 发起握手，采用首个响应连接，极速开屏。",
                  val: general.tcpConcurrent,
                  toggle: () => updateGeneral("tcpConcurrent", !general.tcpConcurrent),
                },
                {
                  id: "unifiedDelay" as const,
                  title: "统一握手延迟",
                  desc: "剔除不同代理协议（Shadowsocks / Vless）测量差异，数据更公允。",
                  val: general.unifiedDelay,
                  toggle: () => updateGeneral("unifiedDelay", !general.unifiedDelay),
                },
                {
                  id: "geoLowMemory" as const,
                  title: "Geo 内存低开销加载",
                  desc: "采用流式内存节约型 Geo 载入引擎，核心常驻占用可下降 40%。",
                  val: general.geoLowMemory,
                  toggle: () => updateGeneral("geoLowMemory", !general.geoLowMemory),
                },
                {
                  id: "autoCloseConnections" as const,
                  title: "切换节点自动断旧连接",
                  desc: "出站节点切换后强制切断存量连接，防止旧长连接串流遗留。",
                  val: general.autoCloseConnections,
                  toggle: () => updateGeneral("autoCloseConnections", !general.autoCloseConnections),
                },
              ].map((item) => (
                <div
                  key={item.id}
                  onClick={item.toggle}
                  className="p-3 rounded-xl bg-[var(--surface-sunken)]/40 border border-[var(--glass-border-subtle)] flex items-start justify-between gap-3 cursor-pointer hover:border-indigo-500/40 transition"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      {item.desc}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`w-9 h-5 rounded-full transition-colors relative p-0.5 shrink-0 mt-0.5 ${
                      item.val ? "bg-emerald-600" : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        item.val ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 卡片 3: 节点测速探针与并发调度 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>节点测速探针与并发调度</span>
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">HTTP 204 无负载极速探针</span>
            </div>

            {/* 测速 URL 预设选择 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  label: "Cloudflare 204",
                  url: "https://cp.cloudflare.com/generate_204",
                  badge: "默认推荐",
                  desc: "全球 Anycast 边缘网络，测速极速且波动极低",
                },
                {
                  label: "Google 204",
                  url: "https://www.google.com/generate_204",
                  badge: "真实外网",
                  desc: "直连海外核心网络骨干，真实反映国际通路质量",
                },
              ].map((preset) => {
                const isSelected = general.speedTestUrl === preset.url;
                return (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => updateGeneral("speedTestUrl", preset.url)}
                    className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 cursor-pointer ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                        : "border-[var(--glass-border-subtle)] bg-[var(--surface-sunken)]/50 text-[var(--text-secondary)] hover:border-slate-600"
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 font-semibold text-xs text-[var(--text-primary)]">
                        <span>{preset.label}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-400 font-mono">
                          {preset.badge}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">{preset.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 自定义探针输入 */}
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                自定义测速探针 URL:
              </label>
              <input
                type="text"
                value={general.speedTestUrl}
                onChange={(e) => updateGeneral("speedTestUrl", e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
                placeholder="https://cp.cloudflare.com/generate_204"
              />
            </div>

            {/* 测速并发数滑块 */}
            <div className="pt-3 border-t border-[var(--glass-border-subtle)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">节点延迟测速并发数</span>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    批量延迟测速并发工作线程数。推荐 8 ~ 16，过高可能引起本地宽带拥堵。
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 font-mono font-bold">
                  {general.speedTestConcurrency} 并发
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={general.speedTestConcurrency}
                  onChange={(e) => updateGeneral("speedTestConcurrency", Number(e.target.value))}
                  className="flex-1 h-1.5 bg-[var(--surface-sunken)] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex items-center gap-1 shrink-0">
                  {[8, 10, 16].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateGeneral("speedTestConcurrency", num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                        general.speedTestConcurrency === num
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--glass-border-subtle)] hover:text-[var(--text-secondary)]"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* IP 健康体检并发数滑块 */}
            <div className="pt-3 border-t border-[var(--glass-border-subtle)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">IP 健康体检并发数</span>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    节点出口 IP 深度扫描并发数。低并发（2~4）可杜绝端口竞争并防止外部查询限流（45次/分）。
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono font-bold">
                  {general.healthProbeConcurrency} 并发
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={general.healthProbeConcurrency}
                  onChange={(e) => updateGeneral("healthProbeConcurrency", Number(e.target.value))}
                  className="flex-1 h-1.5 bg-[var(--surface-sunken)] rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex items-center gap-1 shrink-0">
                  {[2, 4, 8].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateGeneral("healthProbeConcurrency", num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                        general.healthProbeConcurrency === num
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--glass-border-subtle)] hover:text-[var(--text-secondary)]"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 子分栏 2: DNS 引擎与防污染 (DNS & Fake-IP) */}
      {/* ============================================================== */}
      {activeTab === "dns" && (
        <div className="space-y-4">
          {/* 卡片 1: DNS 覆写总开关与运行模式 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>DNS 解析引擎与增强模式</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">覆写总开关</span>
                <button
                  type="button"
                  onClick={() => updateDns("enableOverride", !dns.enableOverride)}
                  className={`w-10 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer shrink-0 ${
                    dns.enableOverride ? "bg-indigo-600" : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      dns.enableOverride ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 解析模式三选一 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  mode: "fake-ip" as DnsEnhancedMode,
                  title: "Fake-IP (虚拟映射)",
                  badge: "默认推荐",
                  desc: "内核向客户端秒级下发 198.18 虚拟 IP，免除前置真实 DNS 查询，建连零延迟。",
                },
                {
                  mode: "redir-host" as DnsEnhancedMode,
                  title: "Redir-Host (真实重定向)",
                  badge: null,
                  desc: "先由内核解析真实 IP 再转发，兼容对虚拟 IP 敏感的旧式网络工具。",
                },
                {
                  mode: "normal" as DnsEnhancedMode,
                  title: "Normal (传统标准)",
                  badge: null,
                  desc: "标准传统 DNS 解析模式，严格遵循标准 DNS 协议报文流程。",
                },
              ].map((item) => {
                const isSelected = dns.enhancedMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => updateDns("enhancedMode", item.mode)}
                    className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                        : "border-[var(--glass-border-subtle)] bg-[var(--surface-sunken)]/40 text-[var(--text-secondary)] hover:border-slate-600"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-xs text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-mono">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Fake-IP 额外参数 */}
            {dns.enhancedMode === "fake-ip" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--glass-border-subtle)] text-xs">
                <div>
                  <label className="block text-[var(--text-muted)] font-medium mb-1">
                    Fake-IP 虚拟私有网段 CIDR:
                  </label>
                  <input
                    type="text"
                    value={dns.fakeIpRange}
                    onChange={(e) => updateDns("fakeIpRange", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)] font-mono text-[var(--text-primary)]"
                  />
                  <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                    标准保留网段：198.18.0.1/16，避免与局域网 IP 冲突
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] self-end">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">优先系统 Hosts</div>
                    <div className="text-[10px] text-[var(--text-muted)]">DNS 查询优先匹配本机 hosts 映射表</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateDns("useSystemHosts", !dns.useSystemHosts)}
                    className={`w-9 h-5 rounded-full transition-colors relative p-0.5 shrink-0 ${
                      dns.useSystemHosts ? "bg-indigo-600" : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        dns.useSystemHosts ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 卡片 2: Fake-IP 过滤黑名单 (白名单直通真实DNS) */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span>Fake-IP 过滤名单 (强制真实 DNS 解析)</span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  已内置 NTP 时间同步、局域网 mDNS、Windows 连通探测等条目，防止假 IP 导致系统服务故障
                </div>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--surface-sunken)] text-[var(--text-muted)] border border-[var(--glass-border-subtle)]">
                {dns.fakeIpFilter.length} 条
              </span>
            </div>

            {/* 标签云 */}
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 rounded-xl bg-[var(--surface-sunken)]/60 border border-[var(--glass-border-subtle)]">
              {dns.fakeIpFilter.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--surface-elevated)] border border-[var(--glass-border-subtle)] text-[11px] font-mono text-[var(--text-primary)]"
                >
                  <span>{domain}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFilterDomain(domain)}
                    className="text-[var(--text-muted)] hover:text-rose-400 transition cursor-pointer"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>

            {/* 动态输入新增条目 */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newFilterDomain}
                onChange={(e) => setNewFilterDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddFilterDomain()}
                placeholder="例如: *.mycompany.lan 或 time.windows.com"
                className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddFilterDomain}
                disabled={!newFilterDomain.trim()}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition cursor-pointer whitespace-nowrap shrink-0"
              >
                添加白名单
              </button>
            </div>
          </div>

          {/* 卡片 3: 上游防污染域名服务器矩阵 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>上游 Nameservers 防污染矩阵</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* 国内高速 Nameserver */}
              <div className="p-3.5 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-2">
                <div className="flex items-center justify-between font-semibold text-[var(--text-primary)]">
                  <span>国内高速 DoH 服务器</span>
                  <span className="text-[10px] text-emerald-400 font-mono">Nameservers</span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-[var(--text-muted)]">
                  {dns.nameserver.map((ns, idx) => (
                    <div key={idx} className="truncate">{ns}</div>
                  ))}
                </div>
              </div>

              {/* 境外防污染 Fallback */}
              <div className="p-3.5 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-2">
                <div className="flex items-center justify-between font-semibold text-[var(--text-primary)]">
                  <span>境外防投毒 Fallback DoH</span>
                  <span className="text-[10px] text-sky-400 font-mono">Fallback</span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-[var(--text-muted)]">
                  {dns.fallback.map((fb, idx) => (
                    <div key={idx} className="truncate">{fb}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 卡片 4: 网络急救箱与诊断 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>网络故障急救箱 (Emergency Repair)</span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                遇到 DNS 投毒、打不开网页或网卡解析异常时，可执行一键急救刷新本地缓存
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleFlushDns}
                disabled={isFlushingDns}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {isFlushingDns ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                <span>刷新 DNS 缓存</span>
              </button>

              <button
                type="button"
                onClick={handleReloadCore}
                disabled={isReloadingCore}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--glass-hover)] text-[var(--text-primary)] border border-[var(--glass-border-subtle)] text-xs font-medium transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {isReloadingCore ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                <span>重载代理核心</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 子分栏 3: 系统与托盘应用偏好 (App & Lifecycle) */}
      {/* ============================================================== */}
      {activeTab === "app" && (
        <div className="space-y-4">
          {/* 卡片 1: 系统生命周期与开机启动 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>系统启动与后台守护项</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  id: "autoStart" as const,
                  title: "登录自启动",
                  desc: "开机登录进入系统桌面后，后台自动拉起 ProcWeaver。",
                  val: general.autoStart,
                  toggle: () => updateGeneral("autoStart", !general.autoStart),
                },
                {
                  id: "silentStart" as const,
                  title: "静默启动 (后台)",
                  desc: "自启或打开时不弹出主窗口，仅在托盘常驻守护，无感运行。",
                  val: general.silentStart,
                  toggle: () => updateGeneral("silentStart", !general.silentStart),
                },
                {
                  id: "autoRun" as const,
                  title: "自动运行核心",
                  desc: "启动本程序时自动拉起代理内核；关闭则需手动在首页点启动。",
                  val: general.autoRun,
                  toggle: () => updateGeneral("autoRun", !general.autoRun),
                },
                {
                  id: "autoStartProcessRouting" as const,
                  title: "启动自动启动进程分流",
                  desc: "启动本程序时自动激活进程分流总控拦截，无需每次手动开启。",
                  val: general.autoStartProcessRouting,
                  toggle: () => updateGeneral("autoStartProcessRouting", !general.autoStartProcessRouting),
                },
              ].map((item) => (
                <div
                  key={item.id}
                  onClick={item.toggle}
                  className="p-3.5 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] flex flex-col justify-between cursor-pointer hover:border-indigo-500/40 transition"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      <button
                        type="button"
                        className={`w-8 h-4.5 rounded-full transition-colors relative p-0.5 shrink-0 ${
                          item.val ? "bg-indigo-600" : "bg-[var(--surface-sunken)] border border-[var(--glass-border-subtle)]"
                        }`}
                      >
                        <div
                          className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                            item.val ? "translate-x-3.5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 卡片 2: 关闭主窗口行为选择 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">关闭主窗口执行动作</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                点击窗口右上角“关闭”按钮或按快捷键关闭界面时的响应策略
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: "ask" as const,
                  title: "每次询问",
                  badge: "默认推荐",
                  desc: "弹出对话框由您决定最小化至托盘或完全退出",
                },
                {
                  id: "minimize" as const,
                  title: "最小化至托盘",
                  badge: "守护常驻",
                  desc: "隐藏主窗口并收起至系统任务栏托盘，代理持续生效",
                },
                {
                  id: "exit" as const,
                  title: "彻底退出程序",
                  badge: null,
                  desc: "停止代理内核、恢复系统网卡设置并完全关闭程序",
                },
              ].map((item) => {
                const isSelected = general.closeAction === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateGeneral("closeAction", item.id)}
                    className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                        : "border-[var(--glass-border-subtle)] bg-[var(--surface-sunken)]/40 text-[var(--text-secondary)] hover:border-slate-600"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-400 font-mono">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 卡片 3: Windows 离散进程接管垫片 (Shim Engine) */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <span>外部离散进程接管垫片 (Shim Engine)</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-mono">
                  Windows 专享
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                允许从外部终端、VSCode 插件或任务计划随意启动的工具程序自动接入业务包分流
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: "disabled" as const,
                  title: "仅主入口接管",
                  desc: "标准模式。仅接管由 ProcWeaver 自身直接拉起的应用进程树。",
                },
                {
                  id: "path" as const,
                  title: "PATH 命令行垫片",
                  desc: "免管理员权限！在用户 PATH 置入垫片，自动捕获终端中随意执行的程序。",
                },
                {
                  id: "ifeo" as const,
                  title: "IFEO 镜像劫持注入",
                  desc: "系统级底层注册，全生命周期无死角拦截并分流目标进程。",
                },
              ].map((item) => {
                const isSelected = general.shimMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateGeneral("shimMode", item.id)}
                    className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                        : "border-[var(--glass-border-subtle)] bg-[var(--surface-sunken)]/40 text-[var(--text-secondary)] hover:border-slate-600"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-xs text-[var(--text-primary)] mb-1">
                        {item.title}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 卡片: WinDivert 内核驱动服务治理与残留清理 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>WinDivert 内核驱动服务治理</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-500 font-mono">
                    便携免残留
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 max-w-xl leading-relaxed">
                  正常退出本软件会自动卸载驱动与注销服务。若遇系统残留占用、其它网络工具冲突或需彻底断开底层驱动，可点击一键停用注销服务并清理临时组件。
                </div>
              </div>

              <button
                type="button"
                onClick={handleCleanDriverResidual}
                disabled={isCleaningDriver}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-xs font-semibold transition shrink-0 cursor-pointer disabled:opacity-50"
              >
                {isCleaningDriver ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
                <span>{isCleaningDriver ? "正在注销驱动与服务..." : "清理残留驱动服务"}</span>
              </button>
            </div>

            {driverCleanResult && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center gap-2 border ${
                  driverCleanResult.error
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-500"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                }`}
              >
                {driverCleanResult.error ? (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className="font-mono text-[11px]">{driverCleanResult.text}</span>
              </div>
            )}
          </div>

          {/* 卡片 4: 视窗光学与背景透明度调校 (Window Optics & Transparency) */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <svg className="w-4 h-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                <span>界面背景通透度与毛玻璃调校</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300 font-bold">
                120 FPS 物理无感响应
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 控制项 1: 背景不透明度 */}
              <div className="p-4 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">窗口背景不透明度</span>
                  <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                    {windowOpacity}%
                  </span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="95"
                  step="1"
                  value={windowOpacity}
                  onChange={(e) => handleOpacityChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-300 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
                <div className="flex items-center gap-1.5 pt-1">
                  {[
                    { label: "极透 (35%)", val: 35 },
                    { label: "标准 (60%)", val: 60 },
                    { label: "厚实 (90%)", val: 90 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => handleOpacityChange(preset.val)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition cursor-pointer ${
                        windowOpacity === preset.val
                          ? "bg-sky-500/20 text-sky-600 dark:text-sky-400 border-sky-500/40 font-bold"
                          : "bg-[var(--surface-card)] text-[var(--text-muted)] border-[var(--glass-border-subtle)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 控制项 2: 毛玻璃景深模糊度 */}
              <div className="p-4 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">毛玻璃景深模糊</span>
                  <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                    {windowBlur}px
                  </span>
                </div>
                <input
                  type="range"
                  min="8"
                  max="48"
                  step="2"
                  value={windowBlur}
                  onChange={(e) => handleBlurChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-300 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
                <div className="flex items-center gap-1.5 pt-1">
                  {[
                    { label: "轻雾 (16px)", val: 16 },
                    { label: "标准 (32px)", val: 32 },
                    { label: "深沉 (48px)", val: 48 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => handleBlurChange(preset.val)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition cursor-pointer ${
                        windowBlur === preset.val
                          ? "bg-sky-500/20 text-sky-600 dark:text-sky-400 border-sky-500/40 font-bold"
                          : "bg-[var(--surface-card)] text-[var(--text-muted)] border-[var(--glass-border-subtle)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              拖动滑块即可零延迟实时感受窗口背光透射效果；设定自动持久化存储，重启后无缝保持。
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 子分栏 4: 更新中心 (Update Center - 客户端主版本 / 内核 / 规则库) */}
      {/* ============================================================== */}
      {activeTab === "geo" && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* 卡片 1: ProcWeaver 客户端自身版本更新 (Hero 主推卡片) */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--glass-specular)] to-transparent pointer-events-none" />
            
            {/* 顶栏：标题 + 状态胶囊 + 检查更新按钮 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-500/20 shadow-xs">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <span>ProcWeaver 客户端</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-bold">
                        {appUpdate?.currentVersion || "V2.3.4"}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      官方通道自动检测，专注绿色便携版无损平滑热更新
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* 状态徽标 */}
                {isCheckingApp ? (
                  <span className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[var(--surface-sunken)]">
                    <svg className="w-3.5 h-3.5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <span>正在检测通道...</span>
                  </span>
                ) : appUpdate?.hasUpdate ? (
                  <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-xl bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25 flex items-center gap-1.5 shadow-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                    <span>发现新版 {appUpdate.latestVersion}</span>
                  </span>
                ) : (
                  <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-1.5 shadow-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                    <span>已是最新版本</span>
                  </span>
                )}

                {/* 手动检测按钮 */}
                <button
                  type="button"
                  onClick={handleCheckAppUpdate}
                  disabled={isCheckingApp}
                  className="px-3 py-1.5 rounded-xl bg-[var(--surface-card)] hover:bg-[var(--glass-bg-hover)] text-[var(--text-primary)] border border-[var(--glass-border)] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs active:scale-[0.98] disabled:opacity-50"
                >
                  <svg className={`w-3.5 h-3.5 ${isCheckingApp ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>检查更新</span>
                </button>
              </div>
            </div>

            {/* 版本对比指标栏 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/60 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
                  <span>当前安装版本</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-slate-200 dark:bg-zinc-800 text-[var(--text-muted)]">
                    本地便携
                  </span>
                </div>
                <div className="font-mono font-bold text-sm text-[var(--text-primary)]">
                  {appUpdate?.currentVersion || "V2.3.4"}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/60 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
                  <span>云端最新发行版</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    GitHub Release
                  </span>
                </div>
                <div className="font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                  {appUpdate?.latestVersion || "已同步"}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/60 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
                  <span>便携包体规格</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-slate-200 dark:bg-zinc-800 text-[var(--text-muted)]">
                    x64 Portable
                  </span>
                </div>
                <div className="font-mono font-bold text-sm text-[var(--text-primary)]">
                  {appUpdate?.assetSizeFormatted || "约 18.0 MB"}
                </div>
              </div>
            </div>

            {/* 错误信息展示条 */}
            {appUpdateError && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="flex-1 truncate">{appUpdateError}</span>
              </div>
            )}

            {/* 发现新版本时的更新详情区 */}
            {appUpdate?.hasUpdate && (
              <div className="p-4 rounded-xl bg-[var(--surface-sunken)]/70 border border-indigo-500/20 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-semibold text-[var(--text-primary)]">
                    {appUpdate.releaseName || `ProcWeaver ${appUpdate.latestVersion}`}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] font-mono">
                    发布于: {new Date(appUpdate.publishedAt || Date.now()).toLocaleDateString()}
                  </div>
                </div>

                {/* 更新日志详情 */}
                {appUpdate.releaseNotes && (
                  <div className="text-xs text-[var(--text-secondary)] whitespace-pre-line bg-[var(--surface-card)] p-3 rounded-lg border border-[var(--glass-border-subtle)] font-mono leading-relaxed max-h-36 overflow-y-auto scrollbar-none">
                    {appUpdate.releaseNotes}
                  </div>
                )}

                {/* 操作栏与进度条 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="text-[11px] text-[var(--text-muted)] font-mono truncate flex items-center gap-2">
                    {(isDownloadingApp || isInstallingApp || installedSuccess) && (
                      <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping shrink-0" />
                    )}
                    <span>
                      {downloadProgress ||
                        (downloadedPath
                          ? "更新包已就绪，点击即可一键部署并重启"
                          : "点击一键平滑更新，全自动下载并热替换")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={appUpdate.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-[var(--surface-card)] hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border-subtle)] text-xs font-semibold transition cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <span>发布页</span>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>

                    <button
                      type="button"
                      onClick={handleOneClickAutoUpdate}
                      disabled={isDownloadingApp || isInstallingApp || installedSuccess}
                      className={`px-4 py-1.5 rounded-xl text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-[0.98] disabled:opacity-60 ${
                        installedSuccess
                          ? "bg-emerald-600"
                          : isInstallingApp
                          ? "bg-purple-600"
                          : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-indigo-500/20 shadow-md"
                      }`}
                    >
                      {isDownloadingApp || isInstallingApp ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      ) : installedSuccess ? (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                      <span>
                        {installedSuccess
                          ? "正在重启新版本..."
                          : isInstallingApp
                          ? "正在热替换并重启..."
                          : isDownloadingApp
                          ? "正在高速下载..."
                          : downloadedPath
                          ? "一键部署更新并重启"
                          : "一键平滑更新"}
                      </span>
                    </button>
                  </div>
                </div>

                {/* 绿色便携模式保障标签 */}
                <div className="pt-2 border-t border-[var(--glass-border-subtle)]/60 flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 font-mono">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>绿色便携隔离保护：更新全程严格排除并保护 data/ 目录（订阅、节点与规则零丢失）</span>
                </div>
              </div>
            )}
          </div>

          {/* 卡片 2: Mihomo 代理内核运行详情与在线版本 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                <span>Mihomo 代理内核运行详情</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  {coreDetail?.coreVersionTag || "v1.19.2"}
                </span>
                <button
                  type="button"
                  onClick={handleCheckMihomo}
                  disabled={isCheckingMihomo}
                  className="px-2.5 py-1 rounded-lg bg-[var(--surface-sunken)] hover:bg-[var(--glass-hover)] text-xs text-[var(--text-secondary)] border border-[var(--glass-border-subtle)] font-medium transition cursor-pointer flex items-center gap-1"
                >
                  <svg className={`w-3 h-3 ${isCheckingMihomo ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>检测官方内核</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)]">核心架构</div>
                <div className="font-mono font-bold text-[var(--text-primary)]">
                  {coreDetail?.cpuArch || "x86_64"}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)]">AVX2 指令集支持</div>
                <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {coreDetail?.avx2Supported ? "已加速启用" : "标准指令集"}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)]">核心进程 PID</div>
                <div className="font-mono font-bold text-[var(--text-primary)]">
                  {coreDetail?.pid || "常驻守护"}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] space-y-1">
                <div className="text-[11px] text-[var(--text-muted)]">核心模式版本</div>
                <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase">
                  {coreDetail?.activeCoreMode || "Standard"}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface-sunken)]/60 border border-[var(--glass-border-subtle)] text-[11px] font-mono text-[var(--text-muted)]">
              <span className="truncate">{coreDetail?.coreVersionRaw || "Mihomo Meta v1.19.2 windows amd64"}</span>
              {mihomoRelease && (
                <span className="shrink-0 text-indigo-600 dark:text-indigo-400 font-semibold">
                  官方最新: {mihomoRelease.latestVersion}
                </span>
              )}
            </div>
          </div>

          {/* 卡片 3: Geo 离线特征规则库 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                  <span>GeoIP / GeoSite 离线数据库</span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  高精度离线 IP 归属与域名特征库，驱动分流规则毫秒级匹配
                </div>
              </div>

              <button
                type="button"
                onClick={handleSyncAllGeo}
                disabled={isSyncingAllGeo}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
              >
                {isSyncingAllGeo ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                <span>全量同步更新</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {geoConfig?.resources.map((res) => {
                const isSyncing = syncingGeoId === res.id;
                return (
                  <div
                    key={res.id}
                    className="p-3.5 rounded-xl bg-[var(--surface-sunken)]/50 border border-[var(--glass-border-subtle)] flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-[var(--text-primary)]">
                          {res.name}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {res.fileSizeFormatted}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                        {res.fileName}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--glass-border-subtle)] text-[11px]">
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{res.updatedAtRelative}</span>
                      <button
                        type="button"
                        onClick={() => handleSyncGeo(res.id)}
                        disabled={isSyncing}
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium transition cursor-pointer"
                      >
                        {isSyncing ? "更新中..." : "单个刷新"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 卡片 4: 配置灾备与快照迁移 */}
          <div className="p-5 rounded-2xl glass-surface border border-[var(--glass-border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <svg className="w-4 h-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span>全量配置快照导出与灾备恢复</span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                打包当前所有订阅、分流规则、业务包及 DNS 偏好设置，便于跨设备平滑迁移
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportSnapshot}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--glass-hover)] text-[var(--text-primary)] border border-[var(--glass-border-subtle)] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>导出快照</span>
              </button>

              <label className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>恢复备份</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleRestoreSnapshot}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
