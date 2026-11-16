// ==========================================================================
// ProcWeaver src-next 根组件
// 规范溯源: tauri-desktop-layout-typography / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useEffect } from "react";
import { DesktopLayout, NavTab } from "./shell/DesktopLayout";
import { OverviewView } from "./views/overview/OverviewView";
import { ProxiesView } from "./views/proxies/ProxiesView";
import { ProcessRoutingView } from "./views/process/ProcessRoutingView";
import { ProfilesView } from "./views/profiles/ProfilesView";
import { RulesView } from "./views/rules/RulesView";
import { ConnectionsView } from "./views/connections/ConnectionsView";
import { LogsView } from "./views/logs/LogsView";
import { SettingsView } from "./views/settings/SettingsView";
import { MiniWidgetView } from "./views/mini/MiniWidgetView";
import { TrayContextMenuView } from "./views/tray/TrayContextMenuView";
import { CloseConfirmModal } from "./components/CloseConfirmModal";
import { CommandPalette } from "./shell/CommandPalette";
import { CoreStatusSnapshot } from "./types/core";
import { BandwidthSnapshot } from "./types/telemetry";
import { getCoreStatus, toggleCore, setEngineMode, toggleSystemProxy } from "./services/coreService";
import { subscribeBandwidth } from "./services/telemetryService";
import { useWindowFormFactor } from "./utils/useWindowFormFactor";
import { isTauriEnvironment, invokeCommand } from "./services/client";
import { syncRoutingToCore } from "./services/processRoutingService";
import { getGeneralSettings } from "./services/settingsService";
import { syncTrayMenu, syncTrayTraffic, refreshTrayWatchdog } from "./services/trayService";

export const App: React.FC = () => {
  // 独立托盘微型视口路由拦截 (window=tray-menu)
  const isTrayMenuWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === "tray-menu";
  if (isTrayMenuWindow) {
    return <TrayContextMenuView />;
  }
  const [currentTab, setCurrentTab] = useState<NavTab>("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const { formFactor, setFormFactor, isPinnedTop, togglePinTop } = useWindowFormFactor();

  // 全局快捷键监听: Ctrl + K (或 Cmd + K) 呼出纯键盘命令中心
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    const saved = localStorage.getItem("procweaver_theme");
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved as "light" | "dark" | "system";
    }
    return "light";
  });

  const [status, setStatus] = useState<CoreStatusSnapshot>({
    running: false,
    mixedPort: 7890,
    mode: "rule",
    coreMode: "v3",
    processCount: 0,
    activeProfile: "默认分流策略",
    uptimeSeconds: 0,
  });

  const [bandwidth, setBandwidth] = useState<BandwidthSnapshot>({
    uploadRateBytes: 240000,
    downloadRateBytes: 1850000,
    uploadTotalBytes: 45210984,
    downloadTotalBytes: 894312093,
  });

  // 主题监听与应用
  useEffect(() => {
    const applyTheme = (t: "light" | "dark" | "system") => {
      let isDark = false;
      if (t === "dark") {
        isDark = true;
      } else if (t === "system") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }

      if (isDark) {
        document.documentElement.classList.add("dark");
        document.documentElement.style.colorScheme = "dark";
      } else {
        document.documentElement.classList.remove("dark");
        document.documentElement.style.colorScheme = "light";
      }
      localStorage.setItem("procweaver_theme", t);
    };

    applyTheme(theme);

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => applyTheme("system");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
  }, [theme]);

  // 初始化获取核心状态并订阅遥测数据流，保底自启核心网络服务
  useEffect(() => {
    let active = true;

    const refreshStatus = async () => {
      try {
        const s = await getCoreStatus();
        if (!active) return;
        setStatus(s);
        syncTrayMenu({
          running: s.running,
          mode: s.mode,
          sysProxyEnabled: s.systemProxyEnabled,
        });
        refreshTrayWatchdog().catch(() => {});
        // 若核心尚未运行，且处于 Tauri 原生运行环境，保底自动拉起核心
        if (!s.running && isTauriEnvironment()) {
          try {
            console.log("[App] 核心未运行，执行保底自启...");
            const newStatus = await toggleCore(true, "auto");
            if (active) {
              setStatus(newStatus);
              syncTrayMenu({
                running: newStatus.running,
                mode: newStatus.mode,
                sysProxyEnabled: newStatus.systemProxyEnabled,
              });
            }
            if (newStatus.running) {
              // 核心启动成功后，立即确保分流路由和选定节点完全同步下发
              setTimeout(() => {
                syncRoutingToCore().catch((syncErr) => {
                  console.warn("[App] 核心自启后同步分流路由告警:", syncErr);
                });
                refreshTrayWatchdog().catch(() => {});
              }, 300);
            }
          } catch (e) {
            console.warn("[App] 核心自启保底执行失败:", e);
          }
        }

        // 检查用户是否配置了【启动软件自动启动进程分流】
        if (isTauriEnvironment()) {
          try {
            const general = await getGeneralSettings();
            if (general.autoStartProcessRouting) {
              const overrides = await invokeCommand<any>("get_routing_overrides");
              if (
                overrides?.config &&
                (!overrides.config.processEnabled || !overrides.config.bundlesEnabled)
              ) {
                console.log("[App] 触发【启动软件自动启动进程分流】...");
                const nextConfig = {
                  ...overrides.config,
                  processEnabled: true,
                  bundlesEnabled: true,
                };
                await invokeCommand("save_routing_overrides", {
                  config: nextConfig,
                  selections: [],
                });
                window.dispatchEvent(
                  new CustomEvent("netbox-process-master-changed", { detail: true })
                );
                window.dispatchEvent(new Event("netbox-route-changed"));
              }
            }
          } catch (autoRoutingErr) {
            console.warn("[App] 启动软件自动启动进程分流执行告警:", autoRoutingErr);
          }
        }
      } catch (err) {
        console.error("[App] getCoreStatus error:", err);
      }
    };

    refreshStatus();

    // 周期性核心心跳遥测 (每 2 秒实时刷新真实进程物理内存与运行状态)
    const statusTimer = setInterval(() => {
      if (active) {
        getCoreStatus().then((s) => {
          if (active) {
            setStatus(s);
            syncTrayMenu({
              running: s.running,
              mode: s.mode,
              sysProxyEnabled: s.systemProxyEnabled,
            });
          }
        }).catch(() => {});
      }
    }, 2000);

    const unsubscribe = subscribeBandwidth((snap) => {
      setBandwidth(snap);
      // 遥测速率向系统托盘同步 (供托盘 Tooltip 与悬浮面板展示)
      syncTrayTraffic(snap.downloadRateBytes, snap.uploadRateBytes);
    });

    const handleRouteChanged = () => {
      if (active) {
        getCoreStatus().then((s) => {
          setStatus(s);
          syncTrayMenu({
            running: s.running,
            mode: s.mode,
            sysProxyEnabled: s.systemProxyEnabled,
          });
        }).catch(() => {});
        refreshTrayWatchdog().catch(() => {});
      }
    };
    window.addEventListener("netbox-route-changed", handleRouteChanged);

    return () => {
      active = false;
      clearInterval(statusTimer);
      unsubscribe();
      window.removeEventListener("netbox-route-changed", handleRouteChanged);
    };
  }, []);

  // 托盘原生事件全量监听中枢
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let unlistenSysProxy: (() => void) | undefined;
    let unlistenNode: (() => void) | undefined;
    let unlistenNav: (() => void) | undefined;
    let unlistenMaster: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<boolean>("netbox-sysproxy-changed", (e) => {
        setStatus((prev) => ({ ...prev, systemProxyEnabled: e.payload }));
        syncTrayMenu({ sysProxyEnabled: e.payload });
      }).then((un) => {
        unlistenSysProxy = un;
      });

      listen<{ nodeName: string }>("netbox-active-node-changed", (e) => {
        syncTrayMenu({ activeNode: e.payload.nodeName });
        window.dispatchEvent(new Event("netbox-route-changed"));
      }).then((un) => {
        unlistenNode = un;
      });

      listen<string>("procweaver-navigate-tab", (e) => {
        const t = e.payload as NavTab;
        if (
          ["overview", "proxies", "process", "rules", "connections", "logs", "settings"].includes(t)
        ) {
          setCurrentTab(t);
        }
      }).then((un) => {
        unlistenNav = un;
      });

      listen<boolean>("netbox-process-master-changed", (e) => {
        syncTrayMenu({ processEnabled: e.payload });
        window.dispatchEvent(new Event("netbox-route-changed"));
      }).then((un) => {
        unlistenMaster = un;
      });
    }).catch(() => {});

    return () => {
      if (unlistenSysProxy) unlistenSysProxy();
      if (unlistenNode) unlistenNode();
      if (unlistenNav) unlistenNav();
      if (unlistenMaster) unlistenMaster();
    };
  }, []);

  // 核心启停处理
  const handleToggleCore = async (start: boolean) => {
    try {
      const newStatus = await toggleCore(start, status.coreMode);
      setStatus(newStatus);
      syncTrayMenu({
        running: newStatus.running,
        mode: newStatus.mode,
        sysProxyEnabled: newStatus.systemProxyEnabled,
      });
      refreshTrayWatchdog().catch(() => {});
      showNotice(start ? "网络核心服务已成功拉起" : "网络核心服务已停止");
    } catch (e: any) {
      showNotice(`切换核心失败: ${e?.message || e}`);
    }
  };

  // 模式切换
  const handleChangeMode = async (mode: "rule" | "global" | "direct") => {
    try {
      await setEngineMode(mode);
      setStatus((prev) => ({ ...prev, mode }));
      syncTrayMenu({ mode });
      window.dispatchEvent(new CustomEvent("netbox-mode-changed", { detail: { mode } }));
      showNotice(
        mode === "rule"
          ? "已切换为智能分流模式"
          : mode === "global"
          ? "已切换为全局代理模式"
          : "已切换为直连绕过模式"
      );
    } catch (e: any) {
      showNotice(`切换模式失败: ${e?.message || e}`);
    }
  };

  // 系统代理一键开关
  const handleToggleSystemProxy = async (enable: boolean) => {
    try {
      const port = status.mixedPort || 7890;
      const ok = await toggleSystemProxy(enable, port);
      setStatus((prev) => ({ ...prev, systemProxyEnabled: ok }));
      syncTrayMenu({ sysProxyEnabled: ok });
      showNotice(
        ok
          ? `已接管系统代理 (127.0.0.1:${port})`
          : "已关闭系统代理接管"
      );
    } catch (e: any) {
      showNotice(`设置系统代理失败: ${e?.message || e}`);
    }
  };

  // 循环切换主题: dark -> light -> system
  const handleToggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : prev === "light" ? "system" : "dark"));
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <DesktopLayout
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isRunning={status.running}
        onToggleCore={handleToggleCore}
        mixedPort={status.mixedPort}
        mode={status.mode}
        processCount={status.processCount}
        memoryUsageBytes={status.memoryUsageBytes}
        bandwidth={bandwidth}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        formFactor={formFactor}
        onSetFormFactor={setFormFactor}
        isPinnedTop={isPinnedTop}
        onTogglePinTop={togglePinTop}
        onOpenCommandPalette={() => setIsCommandOpen(true)}
        onChangeMode={handleChangeMode}
        systemProxyEnabled={status.systemProxyEnabled}
        onToggleSystemProxy={handleToggleSystemProxy}
      >
        {formFactor === "mini" ? (
          <MiniWidgetView
            status={status}
            bandwidth={bandwidth}
            onSetFormFactor={setFormFactor}
            onShowNotice={showNotice}
            onNavigateTab={(tab) => {
              setCurrentTab(tab as NavTab);
              setFormFactor("standard");
            }}
          />
        ) : (
          <div className="relative h-full w-full">
            <div className={currentTab === "overview" ? "h-full w-full" : "hidden"}>
              <OverviewView
                status={status}
                bandwidth={bandwidth}
                onNavigateTab={(tab) => setCurrentTab(tab as NavTab)}
                onShowNotice={showNotice}
                onToggleCore={handleToggleCore}
                onChangeMode={handleChangeMode}
                onToggleSystemProxy={handleToggleSystemProxy}
              />
            </div>

            <div className={currentTab === "proxies" ? "h-full w-full" : "hidden"}>
              <ProxiesView
                routingMode={status.mode}
                onShowNotice={showNotice}
                onNavigateTab={(tab) => setCurrentTab(tab as NavTab)}
              />
            </div>

            <div className={currentTab === "process" ? "h-full w-full" : "hidden"}>
              <ProcessRoutingView onShowNotice={showNotice} />
            </div>

            <div className={currentTab === "profiles" ? "h-full w-full" : "hidden"}>
              <ProfilesView
                onShowNotice={showNotice}
                onProfileSwitched={(name) => {
                  setStatus((prev) => ({ ...prev, activeProfile: name }));
                }}
              />
            </div>

            <div className={currentTab === "routing" ? "h-full w-full" : "hidden"}>
              <RulesView onShowNotice={showNotice} />
            </div>

            <div className={currentTab === "connections" ? "h-full w-full" : "hidden"}>
              <ConnectionsView onShowNotice={showNotice} />
            </div>

            <div className={currentTab === "logs" ? "h-full w-full" : "hidden"}>
              <LogsView
                controllerPort={status.controllerPort || 9090}
                onShowNotice={showNotice}
              />
            </div>

            <div className={currentTab === "settings" ? "h-full w-full" : "hidden"}>
              <SettingsView onShowNotice={showNotice} />
            </div>
          </div>
        )}
      </DesktopLayout>

      {/* 全局纯键盘命令浮层 (Top Layer，按 Ctrl+K 唤起) */}
      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        onNavigateTab={(tab) => setCurrentTab(tab as NavTab)}
        onShowNotice={showNotice}
        currentTheme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* 优雅关闭确认模态对话框 (响应点击关闭或系统事件) */}
      <CloseConfirmModal />

      {/* 全局 Notice Toast 提示浮层 (Top Layer，居中发丝微高光，智能语义指示灯) */}
      {notice && (() => {
        const isError = notice.includes("失败") || notice.includes("错误") || notice.includes("异常") || notice.includes("拒绝");
        const isWarn = notice.includes("警告") || notice.includes("需注意");
        const dotColor = isError
          ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
          : isWarn
          ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
          : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]";

        return (
          <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full glass-surface border border-[var(--glass-border)] shadow-xl text-[12px] font-medium text-[var(--text-primary)]">
              <span className={`h-1.5 w-1.5 rounded-full ${dotColor} animate-pulse shrink-0`} />
              <span>{notice}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
