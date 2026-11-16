import React, { useState } from "react";
import { useExclusions } from "./hooks/useExclusions";
import { MonitoringRuntime } from "./components/MonitoringRuntime";
import { ChannelDispatcherView } from "./views/ChannelDispatcherView";
import { TrafficRoutingView } from "./views/TrafficRoutingView";
import { BusinessBundleView } from "./views/BusinessBundleView";
import { RulesView } from "./views/RulesView";
import { ProfilesView } from "./views/ProfilesView";
import { SettingsView } from "./views/SettingsView";
import { AndroidSettingsView } from "./views/AndroidSettingsView";
import { AndroidApp } from "./views/AndroidApp";
import { MaintenanceView } from "./views/MaintenanceView";
import { ConnectionsView } from "./views/ConnectionsView";
import { LogsView } from "./views/LogsView";
import { OverviewView } from "./views/OverviewView";
import { useWindowFormFactor } from "./hooks/useWindowFormFactor";
import { WindowHeader } from "./components/layout/WindowHeader";
import { Sidebar } from "./components/layout/Sidebar";
import { useTrayManager } from "./hooks/useTrayManager";
import { useCoreMode } from "./hooks/useCoreMode";
import { useBundleRuntime } from "./hooks/useBusinessBundles";
import { useBundleTools } from "./hooks/useBundleTools";
import { BundleToolsDialog } from "./components/business-bundle/BundleToolsDialog";
import { CloseConfirmModal } from "./components/CloseConfirmModal";
import { useCoreStatus } from "./hooks/useCoreStatus";
import { appendAppLog } from "./api/logs";
import { getGeneralSettings } from "./api/settings";
import { getProfiles, isTauri } from "./api";
import { localNodesApi } from "./api/localNodes";
import type { LocalNodeSummary } from "./types/localNodes";
import { getHostsConflictWarning, clearHostsConflictWarning } from "./api/dns";
import {
  LayoutDashboard,
  Radio,
  ArrowRightLeft,
  Settings,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

// 页面级 ErrorBoundary，防止任何单个组件渲染错误导致应用崩溃白屏
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary 捕获到视图渲染异常:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-4 max-w-xl mx-auto my-12">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">视图渲染遇到异常</h3>
            <p className="text-xs text-rose-300/80 mt-1 font-mono">
              {this.state.error?.message || "未知错误"}
            </p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置此页面</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { TrayContextMenuView } from "./views/TrayContextMenuView";
import { usePlatform } from "./context/PlatformContext";

function DesktopTrayRuntime(props: Parameters<typeof useTrayManager>[0]) { useTrayManager(props); return null; }

export function App() {
  const isTrayMenuWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === "tray-menu";
  if (isTrayMenuWindow) return <TrayContextMenuView />;
  return (
    <ErrorBoundary>
      <FullApp />
    </ErrorBoundary>
  );
}

function FullApp() {
  const platform = usePlatform();
  const mobile = platform.os === "android";
  const [navigationOpen, setNavigationOpen] = useState(false);
  const isTrayMenuWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === "tray-menu";
  if (isTrayMenuWindow) {
    return <TrayContextMenuView />;
  }
  if (mobile) return <ErrorBoundary><AndroidApp /></ErrorBoundary>;

  const exclusions = useExclusions();
  const { formFactor, setFormFactor, isPinnedTop, togglePinTop } = useWindowFormFactor();
  useBundleRuntime();
  const bundleTools = useBundleTools();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [profileCount, setProfileCount] = useState<number | null>(null);
  const [localNodeSummaries, setLocalNodeSummaries] = useState<LocalNodeSummary[] | null>(null);
  const [hostsWarning, setHostsWarning] = useState<string | null>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setActiveTab("proxies");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  React.useEffect(() => {
    const checkWarning = () => {
      void getHostsConflictWarning().then((w) => setHostsWarning(w || null)).catch(() => {});
    };
    checkWarning();
    window.addEventListener("netbox-settings-saved", checkWarning);
    window.addEventListener("netbox-route-changed", checkWarning);
    return () => {
      window.removeEventListener("netbox-settings-saved", checkWarning);
      window.removeEventListener("netbox-route-changed", checkWarning);
    };
  }, []);

  const handleDismissHostsWarning = async () => {
    setHostsWarning(null);
    try {
      await clearHostsConflictWarning();
    } catch {}
  };
  const { status: coreStatus, refresh: refreshCoreStatus } = useCoreStatus();
  const lastProxyEvent = React.useRef<number | undefined>();
  React.useEffect(() => {
    const event = coreStatus.systemProxy?.lastChange;
    if (event && event.timestamp !== lastProxyEvent.current) {
      lastProxyEvent.current = event.timestamp;
      appendAppLog(event.state === "unknown" || event.state === "external" ? "warning" : "info",
        `[系统代理] ${event.reason}（${new Date(event.timestamp).toLocaleTimeString()}）`);
    }
  }, [coreStatus.systemProxy?.lastChange]);

  const coreMode = useCoreMode(coreStatus.pid);
  const mode = coreMode.mode;
  const [activeNodeName, setActiveNodeName] = useState<string>(() => {
    try {
      return localStorage.getItem("netbox_active_node_name") || "";
    } catch {
      return "";
    }
  });

  // 选项卡切换过渡动画偏好消费 (D08)
  const [tabAnimation, setTabAnimation] = useState<boolean>(() => {
    try {
      return localStorage.getItem("netbox_tab_animation") !== "false";
    } catch {
      return true;
    }
  });



  // 全局托盘状态调度与看门狗（解耦页面依赖，冷启动与常驻无缝保活）

  React.useEffect(() => {
    const handleNodeChange = (e: any) => {
      const name = e.detail?.nodeName;
      if (name) {
        setActiveNodeName(name);
      }
    };
    window.addEventListener("netbox-active-node-changed", handleNodeChange);
    return () => {
      window.removeEventListener("netbox-active-node-changed", handleNodeChange);
    };
  }, []);

  React.useEffect(() => {
    if (coreStatus.running) {
      import("./api/mihomo").then(({ fetchProxies }) => {
        fetchProxies().then((res) => {
          if (res?.groups) {
            const main = res.groups.find((g) => g.name === "PROXY" || g.name === "GLOBAL" || g.name.includes("节点选择")) || res.groups[0];
            if (main?.now) {
              setActiveNodeName(main.now);
              try {
                localStorage.setItem("netbox_active_node_name", main.now);
              } catch {}
            }
          }
        }).catch(() => {});
      });
    }
  }, [coreStatus.running]);

  const isStartingRef = React.useRef(false);

  React.useEffect(() => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    // 启动行为由原生应用按持久化设置执行，页面仅读取状态。
    void refreshCoreStatus();
  }, []);

  // 确保 Mihomo 核心默认常驻启动
  React.useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      if (!coreStatus.running) {
        try {
          const { toggleCore } = await import("./api");
          await toggleCore(true);
          await refreshCoreStatus();
        } catch (e) {
          console.warn("核心自启保底执行:", e);
        }
      }
    }, 600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [coreStatus.running, refreshCoreStatus]);

  React.useEffect(() => {
    const checkProfiles = async () => {
      void localNodesApi.read().then(view => setLocalNodeSummaries(view.nodes)).catch(() => setLocalNodeSummaries(null));
      try {
        const list = await getProfiles();
        setProfileCount(Array.isArray(list) ? list.length : 0);
      } catch {
        setProfileCount(0);
      }
    };
    checkProfiles();

    const onProfileChanged = () => {
      checkProfiles();
    };
    const onNavigateTab = (e: any) => {
      if (e.detail && typeof e.detail === "string") {
        setActiveTab(e.detail);
      }
    };

    window.addEventListener("procweaver-profile-changed", onProfileChanged);
    window.addEventListener("netbox-profile-changed", onProfileChanged);
    window.addEventListener("procweaver-navigate-tab", onNavigateTab);
    window.addEventListener("netbox-navigate-tab", onNavigateTab);
    if ((window as unknown as { __PROCWEAVER_IMPORT_PENDING__?: boolean }).__PROCWEAVER_IMPORT_PENDING__) {
      setActiveTab("profiles");
      delete (window as unknown as { __PROCWEAVER_IMPORT_PENDING__?: boolean }).__PROCWEAVER_IMPORT_PENDING__;
    }

    let unlisteners: Array<() => void> = [];

    if (isTauri()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        // 1. 系统代理开关联动
        listen<boolean>("netbox-sysproxy-changed", (event) => {
          void refreshCoreStatus();
          window.dispatchEvent(new CustomEvent("netbox-sysproxy-changed", { detail: event.payload }));
        }).then((un) => unlisteners.push(un));
        listen<string>("netbox-sysproxy-error", (event) => {
          window.alert(event.payload);
        }).then((un) => unlisteners.push(un));

        // 2. 核心路由/模式变更联动
        listen("netbox-route-changed", () => {
          void refreshCoreStatus();
          window.dispatchEvent(new CustomEvent("netbox-route-changed"));
        }).then((un) => unlisteners.push(un));

        // 3. 托盘导航页面秒切联动 (打开节点大盘 / 分流规则 / 运行概览)
        listen<string>("procweaver-navigate-tab", (event) => {
          if (event.payload && typeof event.payload === "string") {
            setActiveTab(event.payload);
            window.dispatchEvent(new CustomEvent("procweaver-navigate-tab", { detail: event.payload }));
          }
        }).then((un) => unlisteners.push(un));

        // 4. 托盘地区过滤跳转联动
        listen<string>("procweaver-filter-region", (event) => {
          if (event.payload && typeof event.payload === "string") {
            window.dispatchEvent(new CustomEvent("procweaver-filter-region", { detail: event.payload }));
          }
        }).then((un) => unlisteners.push(un));

        // 5. 设置保存广播联动
        listen("netbox-settings-saved", () => {
          window.dispatchEvent(new CustomEvent("netbox-settings-saved"));
        }).then((un) => unlisteners.push(un));

        // 6. 进程分流总开关广播联动
        listen<boolean>("netbox-process-master-changed", (event) => {
          window.dispatchEvent(new CustomEvent("netbox-process-master-changed", { detail: event.payload }));
        }).then((un) => unlisteners.push(un));

        // 7. 关闭窗口动作询问联动
        listen("request-close-action", () => {
          setShowCloseConfirm(true);
        }).then((un) => unlisteners.push(un));
      });
    }

    const onDirectRequestClose = () => {
      setShowCloseConfirm(true);
    };
    window.addEventListener("netbox-request-close", onDirectRequestClose);

    let settingsRead = 0;
    let settingsDisposed = false;
    const onSettingsSaved = async () => {
      const request = ++settingsRead;
      try {
        const enabled = isTauri() ? (await getGeneralSettings()).tabAnimation !== false
          : localStorage.getItem("netbox_tab_animation") !== "false";
        if (!settingsDisposed && request === settingsRead) setTabAnimation(enabled);
      } catch { /* Preserve the last confirmed preference when reading fails. */ }
    };
    void onSettingsSaved();
    window.addEventListener("netbox-settings-saved", onSettingsSaved);

    return () => {
      settingsDisposed = true;
      window.removeEventListener("procweaver-profile-changed", onProfileChanged);
      window.removeEventListener("netbox-profile-changed", onProfileChanged);
      window.removeEventListener("procweaver-navigate-tab", onNavigateTab);
      window.removeEventListener("netbox-navigate-tab", onNavigateTab);
      window.removeEventListener("netbox-settings-saved", onSettingsSaved);
      window.removeEventListener("netbox-request-close", onDirectRequestClose);
      unlisteners.forEach((un) => un());
    };
  }, []);

  return (
    <div className={`${mobile ? "android-layout" : "workbench-canvas"} flex h-screen w-screen bg-slate-100 dark:bg-[#040507] text-slate-800 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-200 select-none`}>
      {!mobile && <><MonitoringRuntime /><DesktopTrayRuntime coreStatus={coreStatus} mode={mode} activeNodeName={activeNodeName} /></>}
      {mobile && navigationOpen && <button className="fixed inset-0 w-full z-30 bg-black/40" aria-label="关闭导航" onClick={() => setNavigationOpen(false)} />}

      {/* 桌面端外壳容器 (Zero-Card Unified Canvas) */}
      <div id="tauri-app-window" className="flex-1 flex flex-col h-full w-full overflow-hidden relative">
        <div className="ambient-glow" />

        {/* 顶部标题栏 (h-10 40px 去框一体化) */}
        <WindowHeader
          coreRunning={coreStatus.running}
          mode={mode || ""}
          activeNodeName={activeNodeName}
          latencyMs={24}
          formFactor={formFactor}
          setFormFactor={setFormFactor}
          isPinnedTop={isPinnedTop}
          togglePinTop={togglePinTop}
          onOpenSearch={() => setActiveTab("proxies")}
          onNavigateTab={(tab) => setActiveTab(tab)}
        />

        {/* 系统 Hosts / 嗅探非阻塞温和提示条 (可一键关闭，绝不阻断核心) */}
        {hostsWarning && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3 animate-in fade-in duration-200 shrink-0 relative z-20">
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 text-amber-500">⚠️</span>
              <span className="truncate">{hostsWarning}</span>
            </div>
            <button
              type="button"
              onClick={handleDismissHostsWarning}
              className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 p-0.5 rounded hover:bg-amber-500/10 cursor-pointer shrink-0 font-bold"
              title="关闭提示"
            >
              ✕
            </button>
          </div>
        )}

        {/* 窗口主体双栏区 (左侧浮动导航 + 右侧完全去框一体化视口) */}
        <div className="flex-1 flex overflow-hidden relative z-10">
          {/* 左侧侧边栏 (mini 挂件时隐藏，compact 时 56px 纯图标，standard 时 180px) */}
          {!mobile && formFactor !== "mini" && (
            <Sidebar
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              formFactor={formFactor}
              coreRunning={coreStatus.running}
              corePid={coreStatus.pid}
              profileCount={profileCount}
            />
          )}

          {/* 右侧主工作视口 */}
          <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-white/20 dark:bg-slate-950/30">
            <div className="flex-1 overflow-hidden relative">
              <div key={activeTab} className={tabAnimation ? "h-full animate-in fade-in duration-150" : "h-full"}>
                <ErrorBoundary>
                  {/* 1. 运行概览：去框一体化全景主控台 + 迷你桌面挂件 */}
                  {activeTab === "dashboard" && (
                    <OverviewView
                      coreStatus={coreStatus}
                      mode={mode}
                      coreMode={coreMode}
                      activeNodeName={activeNodeName}
                      localNodeSummaries={localNodeSummaries}
                      formFactor={formFactor}
                      setFormFactor={setFormFactor}
                      onNavigateTab={setActiveTab}
                      exclusions={exclusions}
                      onRefreshCoreStatus={refreshCoreStatus}
                    />
                  )}

                  {/* 2. 节点大盘 */}
                  {activeTab === "proxies" && <ChannelDispatcherView />}

                  {/* 3. 业务分流包 (直达业务应用专属规则包，消灭外层双层嵌套 Tab) */}
                  {(activeTab === "routing" || activeTab === "bundles") && (
                    mobile ? <TrafficRoutingView mode={mode} coreMode={coreMode} /> : <BusinessBundleView mode={mode} />
                  )}

                  {/* 4. 核心路由规则 (独立大盘：全网路由表检索、规则集与沙盒测路仿真) */}
                  {activeTab === "rules" && (
                    <div className="h-full overflow-y-auto p-4 sm:p-6 md:p-8 bg-slate-50 dark:bg-[#08090a] text-slate-900 dark:text-zinc-100 select-none transition-colors duration-200">
                      <div className="max-w-6xl mx-auto">
                        <RulesView coreMode={coreMode} />
                      </div>
                    </div>
                  )}

                  {/* 5. 连接追踪 */}
                  {activeTab === "connections" && (
                    <div className="h-full overflow-y-auto p-6 md:p-8">
                      <div className="max-w-5xl mx-auto space-y-6">
                        <ConnectionsView controllerPort={coreStatus.controllerPort} />
                      </div>
                    </div>
                  )}

                  {/* 5. 系统日志 */}
                  {activeTab === "logs" && (
                    <div className="h-full overflow-y-auto p-6 md:p-8">
                      <div className="max-w-5xl mx-auto space-y-6">
                        <LogsView controllerPort={coreStatus.controllerPort} />
                      </div>
                    </div>
                  )}

                  {/* 6. 订阅配置 */}
                  {activeTab === "profiles" && (
                    <div className="h-full overflow-y-auto p-6 md:p-8">
                      <div className="max-w-5xl mx-auto space-y-6">
                        <ProfilesView />
                      </div>
                    </div>
                  )}

                  {/* 7. 偏好设置 */}
                  {activeTab === "settings" && (
                    <div className="h-full overflow-y-auto p-6 md:p-8">
                      <div className="max-w-5xl mx-auto space-y-6">
                        {mobile ? <AndroidSettingsView /> : <SettingsView />}
                      </div>
                    </div>
                  )}

                  {/* 8. 版本维护 */}
                  {activeTab === "maintenance" && (
                    <div className="h-full overflow-y-auto p-6 md:p-8">
                      <div className="max-w-5xl mx-auto space-y-6">
                        <MaintenanceView />
                      </div>
                    </div>
                  )}
                </ErrorBoundary>
              </div>
            </div>

            {/* 移动端底部导航 */}
            {mobile && (
              <nav className="shrink-0 z-20 flex items-center justify-around border-t border-slate-200/90 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md py-1.5 px-2 select-none shadow-[0_-4px_12px_rgba(0,0,0,0.03)]">
                {[
                  { id: "dashboard", label: "控制台", icon: LayoutDashboard },
                  { id: "proxies", label: "节点池", icon: Radio },
                  { id: "routing", label: "分流规则", icon: ArrowRightLeft },
                  { id: "settings", label: "偏好设置", icon: Settings },
                ].map(({ id, label, icon: Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition cursor-pointer ${
                        active
                          ? "text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50/80 dark:bg-indigo-950/40"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      <Icon className={`w-5 h-5 mb-0.5 ${active ? "stroke-[2.2]" : "stroke-[1.8]"}`} />
                      <span className="text-[10px] leading-tight tracking-tight">{label}</span>
                    </button>
                  );
                })}
              </nav>
            )}
          </main>
        </div>
      </div>
      <BundleToolsDialog {...bundleTools} />
      <CloseConfirmModal isOpen={showCloseConfirm} onClose={() => setShowCloseConfirm(false)} />
    </div>
  );
}

export default App;
