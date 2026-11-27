import { PortableUpdatePrompt } from "../src/components/function-mode/PortableUpdates";
// ==========================================================================
// ProcWeaver src-next 根组件
// 规范溯源: tauri-desktop-layout-typography / ui-surface-elevation-hierarchy
// ==========================================================================

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { ConfirmModal } from "./primitives/ConfirmModal";
import { Modal } from "./primitives/Modal";
import { CommandPalette } from "./shell/CommandPalette";
import { CoreStatusSnapshot } from "./types/core";
import { BandwidthSnapshot } from "./types/telemetry";
import { getCoreStatus, toggleCore, setEngineMode, toggleSystemProxy } from "./services/coreService";
import { subscribeBandwidth } from "./services/telemetryService";
import { useWindowFormFactor } from "./utils/useWindowFormFactor";
import { useLanAccess } from "./utils/useLanAccess";
import { useTunAccess } from "./utils/useTunAccess";
import { isTauriEnvironment, invokeCommand } from "./services/client";
import { syncRoutingToCore } from "./services/processRoutingService";
import { getGeneralSettings } from "./services/settingsService";
import { syncTrayMenu, syncTrayTraffic, refreshTrayWatchdog } from "./services/trayService";
import { notifyProfileChanged, PROFILE_CHANGED_EVENT } from "./services/profileService";
import { saveGuideProgress, type GuideMethod, type GuideProgress } from "./services/firstUseService";
import { FirstUseGate, FirstUseNoticeContent } from "./views/first-use/FirstUseNotice";
import { FirstUseGuide } from "./views/first-use/FirstUseGuide";

type Theme = "light" | "dark" | "system";

export const App: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("procweaver_theme");
    return saved === "dark" || saved === "system" ? saved : "light";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    localStorage.setItem("procweaver_theme", theme);
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  if (new URLSearchParams(window.location.search).get("window") === "tray-menu") {
    return <TrayContextMenuView />;
  }

  return (
    <FirstUseGate>
      {(guide, available) => <DesktopApp initialGuide={guide} firstUseAvailable={available} theme={theme}
        onToggleTheme={() => setTheme((previous) => previous === "dark" ? "light" : previous === "light" ? "system" : "dark")} />}
    </FirstUseGate>
  );
};

interface DesktopAppProps {
  initialGuide: GuideProgress;
  firstUseAvailable: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}

interface HotResetPrompt {
  ticket: string;
  bundles: string[];
  connectionCount: number;
}

function DesktopApp({ initialGuide, firstUseAvailable, theme, onToggleTheme }: DesktopAppProps) {
  const [currentTab, setCurrentTab] = useState<NavTab>("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);
  const [hotResetPrompt, setHotResetPrompt] = useState<HotResetPrompt | null>(null);
  const [refreshingConnections, setRefreshingConnections] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [guide, setGuide] = useState(initialGuide);
  const [savingGuide, setSavingGuide] = useState(false);
  const [isFirstUseNoticeOpen, setIsFirstUseNoticeOpen] = useState(false);
  const guideSaveInFlight = useRef(false);
  const { formFactor, setFormFactor, isPinnedTop, togglePinTop } = useWindowFormFactor();

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const readWarning = async () => {
      if (disposed) return;
      try {
        const message = await invokeCommand<string | null>("take_bundle_capture_warning");
        if (message && !disposed) {
          setCurrentTab("process");
          setCaptureWarning(message);
        }
      } catch (error) {
        console.warn("[App] 读取启动兼容性提示失败", error);
      }
    };
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("procweaver-bundle-capture-warning", readWarning))
      .then((remove) => {
        if (disposed) remove();
        else {
          unlisten = remove;
          void readWarning();
        }
      })
      .catch((error) => console.warn("[App] 订阅启动兼容性提示失败", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (captureWarning && formFactor === "mini") void setFormFactor("standard");
  }, [captureWarning, formFactor, setFormFactor]);

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

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 2500);
  }, []);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<{ prompt: HotResetPrompt | null; warning: string | null }>(
        "procweaver-bundle-hot-reset", ({ payload }) => {
          if (disposed) return;
          if (payload.warning) showNotice(`旧连接接管需注意，${payload.warning}`);
          if (payload.prompt) setHotResetPrompt(payload.prompt);
        },
      ))
      .then((remove) => {
        if (disposed) remove();
        else unlisten = remove;
      })
      .catch((error) => console.warn("[App] 订阅旧连接接管提示失败", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [showNotice]);

  const confirmHotReset = async (refresh: boolean) => {
    if (!hotResetPrompt || refreshingConnections) return;
    const { ticket } = hotResetPrompt;
    if (refresh) setRefreshingConnections(true);
    else setHotResetPrompt(null);
    try {
      const result = await invokeCommand<{ refreshed: number; failed: number }>(
        "confirm_bundle_hot_reset", { ticket, refresh },
      );
      if (refresh) {
        showNotice(result.failed
          ? `已刷新 ${result.refreshed} 条旧连接，${result.failed} 条刷新失败`
          : result.refreshed ? `已刷新 ${result.refreshed} 条旧连接` : "待刷新连接已结束");
      }
    } catch (error) {
      showNotice(`刷新旧连接失败，${String(error)}`);
    } finally {
      setHotResetPrompt((current) => current?.ticket === ticket ? null : current);
      setRefreshingConnections(false);
    }
  };

  const updateGuide = async (next: GuideProgress, tab?: NavTab) => {
    if (guideSaveInFlight.current) return;
    guideSaveInFlight.current = true;
    setSavingGuide(true);
    try {
      if (isTauriEnvironment()) await saveGuideProgress(next);
      setGuide(next);
      if (tab) setCurrentTab(tab);
    } catch (error) {
      showNotice("保存引导进度失败，" + (error instanceof Error ? error.message : String(error)));
    } finally {
      guideSaveInFlight.current = false;
      setSavingGuide(false);
    }
  };

  const chooseGuideMethod = (method: GuideMethod | null) => {
    void updateGuide({ ...guide, method }, method === "system" ? "overview" : method === "process" ? "process" : undefined);
  };

  const [status, setStatus] = useState<CoreStatusSnapshot>({
    running: false,
    mixedPort: 7890,
    mode: "rule",
    coreMode: "v3",
    processCount: 0,
    activeProfile: "默认分流策略",
    uptimeSeconds: 0,
  });
  const lanAccess = useLanAccess(status.running, status.mixedPort);
  const tunAccess = useTunAccess(status.running);

  const [bandwidth, setBandwidth] = useState<BandwidthSnapshot>({
    uploadRateBytes: 0,
    downloadRateBytes: 0,
    uploadTotalBytes: 0,
    downloadTotalBytes: 0,
  });

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

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen(PROFILE_CHANGED_EVENT, () => {
        if (!disposed) notifyProfileChanged();
      }))
      .then((remove) => {
        if (disposed) remove();
        else unlisten = remove;
      })
      .catch((error) => console.warn("[App] 订阅刷新监听失败", error));
    return () => {
      disposed = true;
      unlisten?.();
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
        onToggleTheme={onToggleTheme}
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
            lanAccess={lanAccess}
            tunAccess={tunAccess}
            onSetFormFactor={setFormFactor}
            onChangeMode={handleChangeMode}
            onToggleSystemProxy={handleToggleSystemProxy}
            onShowNotice={showNotice}
            onNavigateTab={(tab) => {
              setCurrentTab(tab as NavTab);
              setFormFactor("standard");
            }}
          />
        ) : (
          <div className={currentTab === "overview" ? "relative flex flex-1 flex-col" : "relative h-full w-full"}>
            {!guide.dismissed && (
              <FirstUseGuide tab={currentTab} status={status} method={guide.method} saving={savingGuide}
                onChoose={chooseGuideMethod} onNavigate={setCurrentTab}
                onDismiss={() => void updateGuide({ ...guide, dismissed: true })} />
            )}
            <div className={currentTab === "overview" ? "flex flex-1 flex-col" : "hidden"}>
              <OverviewView
                status={status}
                bandwidth={bandwidth}
                lanAccess={lanAccess}
                tunAccess={tunAccess}
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
              <ProcessRoutingView
                tunAccess={tunAccess}
                onShowNotice={showNotice}
                captureWarning={captureWarning}
                onCaptureWarningChange={setCaptureWarning}
              />
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
              <RulesView routingMode={status.mode} onSwitchToRule={() => handleChangeMode("rule")} onShowNotice={showNotice} />
            </div>

            <div className={currentTab === "connections" ? "h-full w-full" : "hidden"}>
              <ConnectionsView onShowNotice={showNotice} />
            </div>

            <div className={currentTab === "logs" ? "h-full w-full" : "hidden"}>
              <LogsView
                controllerPort={status.controllerPort}
                visible={currentTab === "logs"}
                onShowNotice={showNotice}
              />
            </div>

            <div className={currentTab === "settings" ? "h-full w-full" : "hidden"}>
              <SettingsView lanAccess={lanAccess} onShowNotice={showNotice}
                onOpenGuide={firstUseAvailable ? () => void updateGuide({ ...guide, dismissed: false }, "overview") : undefined}
                onOpenFirstUseNotice={firstUseAvailable ? () => setIsFirstUseNoticeOpen(true) : undefined} />
            </div>
          </div>
        )}
      </DesktopLayout>

      {isFirstUseNoticeOpen && (
        <Modal isOpen title="首次使用须知" wide onClose={() => setIsFirstUseNoticeOpen(false)}>
          <FirstUseNoticeContent />
        </Modal>
      )}
      {/* 全局纯键盘命令浮层 (Top Layer，按 Ctrl+K 唤起) */}
      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        onNavigateTab={(tab) => setCurrentTab(tab as NavTab)}
        onShowNotice={showNotice}
        currentTheme={theme}
        onToggleTheme={onToggleTheme}
      />

      {/* 优雅关闭确认模态对话框 (响应点击关闭或系统事件) */}
      <CloseConfirmModal />
      <PortableUpdatePrompt />
      {hotResetPrompt && (
        <ConfirmModal
          isOpen
          variant="primary"
          title="刷新旧连接"
          description={`「${hotResetPrompt.bundles.join("、")}」有 ${hotResetPrompt.connectionCount} 条可切换的 TCP 连接。新规则已生效，刷新会关闭这些连接，由应用自行重连。`}
          confirmText="刷新旧连接"
          cancelText="保留旧连接"
          isLoading={refreshingConnections}
          onConfirm={() => confirmHotReset(true)}
          onCancel={() => confirmHotReset(false)}
        />
      )}

      {notice && (() => {
        const isError = notice.includes("失败") || notice.includes("错误") || notice.includes("异常") || notice.includes("拒绝");
        const isWarn = notice.includes("警告") || notice.includes("需注意");
        const dotColor = isError
          ? "bg-[var(--workbench-danger)]"
          : isWarn
          ? "bg-[var(--workbench-warning)]"
          : "bg-[var(--workbench-positive)]";

        return (
          <div role="status" className="pointer-events-none fixed left-1/2 top-12 z-[9999] w-max max-w-[calc(100%_-_1.5rem)] -translate-x-1/2">
            <div className="workbench-dialog flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--text-primary)]">
              <span className={`size-1.5 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
              <span>{notice}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
