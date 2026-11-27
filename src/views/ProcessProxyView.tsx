import { PortableUpdatePrompt } from "../components/function-mode/PortableUpdates";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Activity, Globe, Settings, Workflow, X } from "lucide-react";
import { useBundleRuntime } from "../hooks/useBusinessBundles";
import { useBundleTools } from "../hooks/useBundleTools";
import { useExternalProxyEditor } from "../hooks/useExternalProxyEditor";
import { useProcessWorkspace } from "../hooks/useProcessWorkspace";
import { useTheme } from "../context/ThemeContext";
import { BusinessBundleView } from "./BusinessBundleView";
import { ExternalProxyDialog } from "../components/business-bundle/ExternalProxyDialog";
import { BundleToolsDialog } from "../components/business-bundle/BundleToolsDialog";
import { ProcessDiagnostics, ProcessSettings } from "../components/function-mode/ProcessWorkspacePanels";
import type { BundleLocalInstance } from "../types/businessBundle";
import { isTauri } from "../api";
import { externalProxyApi } from "../api/externalProxy";
import { CloseConfirmModal } from "../../src-next/components/CloseConfirmModal";
import { ConfirmModal } from "../../src-next/primitives/ConfirmModal";
import { WorkbenchLayout } from "../../src-next/shell/WorkbenchLayout";

const navigation = [
  [
    { id: "bundles", label: "进程分流", icon: Workflow },
    { id: "external", label: "外部代理", icon: Globe },
  ],
  [
    { id: "diagnostics", label: "连接与诊断", icon: Activity },
    { id: "settings", label: "系统首选项", icon: Settings },
  ],
] as const;

interface HotResetPrompt { ticket: string; bundles: string[]; connectionCount: number }

export function ProcessProxyView() {
  useBundleRuntime();
  const { theme, setTheme } = useTheme();
  const tools = useBundleTools();
  const state = useProcessWorkspace();
  const editor = useExternalProxyEditor(state.tab === "external", null, () => {});
  const [outletTarget, setOutletTarget] = useState<BundleLocalInstance | null>(null);
  const outletEditor = useExternalProxyEditor(outletTarget !== null, outletTarget, () => setOutletTarget(null));
  const [hotReset, setHotReset] = useState<HotResetPrompt | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    const listener = listen<{ prompt?: HotResetPrompt; warning?: string }>("procweaver-external-hot-reset", ({ payload }) => {
      if (payload.warning) setStatus(payload.warning);
      if (payload.prompt) setHotReset(payload.prompt);
    });
    void listener.catch(error => setStatus(String(error)));
    return () => { void listener.then(unlisten => unlisten(), () => {}); };
  }, []);

  const confirmHotReset = async (refresh: boolean) => {
    if (!hotReset || refreshing) return;
    setRefreshing(true);
    try {
      const result = await externalProxyApi.confirmHotReset(hotReset.ticket, refresh);
      if (refresh) setStatus(`已刷新 ${result.refreshed} 条旧连接${result.failed ? `，${result.failed} 条未能刷新` : ""}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
      setHotReset(current => current?.ticket === hotReset.ticket ? null : current);
    }
  };

  const captureMode = state.capture.state.view?.mode;
  const captureLabel = captureMode === "windivert" ? "WinDivert" : captureMode === "user_mode" ? "用户态 Hook" : "App-Proxy";
  const readyCount = state.external?.states.filter(item => item.ready).length ?? 0;
  const captureActive = Boolean(state.external?.enabled && state.capture.state.view?.active);
  const statusLabel = !state.external ? "正在读取" : !state.external.enabled ? "分流已暂停" : captureActive ? "分流已就绪" : "分流待就绪";

  return (
    <>
      <WorkbenchLayout
        navigation={navigation}
        currentTab={state.tab}
        onSelectTab={state.actions.setTab}
        sidebarStorageKey="procweaver_process_sidebar_collapsed"
        chrome={{
          productName: "ProcWeaver Process",
          isRunning: captureActive,
          statusLabel,
          theme,
          onToggleTheme: () => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark"),
        }}
        statusBar={
          <footer className="workbench-statusbar">
            <div className="flex flex-wrap items-center gap-x-3">
              {captureMode && <span>捕获方式 <strong className="font-medium text-[var(--text-primary)]">{captureLabel}</strong></span>}
              {state.external && <span>就绪入口 <strong className="font-medium tabular-nums text-[var(--text-primary)]">{readyCount}</strong></span>}
            </div>
            {state.external && <span>连接记录 <strong className="font-medium tabular-nums text-[var(--text-primary)]">{state.external.records.length}</strong></span>}
          </footer>
        }
      >
        {status && <div role="status" className="workbench-panel mb-4 flex items-center justify-between gap-3 px-4 py-2 text-xs">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus("")} className="workbench-title-button shrink-0" aria-label="关闭通知"><X size={14} aria-hidden="true" /></button>
        </div>}
        {state.tab === "bundles" && <BusinessBundleView mode={null} processWorkspace={state} onOpenExternalOutlet={setOutletTarget} />}
        {state.tab === "external" && <ExternalProxyDialog inline open state={editor} onClose={() => {}} />}
        {state.tab === "diagnostics" && <ProcessDiagnostics state={state} />}
        {state.tab === "settings" && <ProcessSettings state={state} />}
      </WorkbenchLayout>

      <BundleToolsDialog {...tools} workbench />
      <ExternalProxyDialog open={outletTarget !== null} bundleName={outletTarget?.definition.packageName} state={outletEditor}
        onClose={() => setOutletTarget(null)}
        onManageOutlets={() => { setOutletTarget(null); state.actions.setTab("external"); }}
      />
      {hotReset && <ConfirmModal
        isOpen title="刷新旧连接" variant="warning"
        description={'「' + hotReset.bundles.join("、") + '」有 ' + hotReset.connectionCount + ' 条旧 TCP 连接。刷新后由应用自行重连。'}
        confirmText="刷新连接" cancelText="保留旧连接" isLoading={refreshing}
        onConfirm={() => confirmHotReset(true)} onCancel={() => confirmHotReset(false)}
      />}
      <CloseConfirmModal appName="ProcWeaver Process" />
      <PortableUpdatePrompt />
    </>
  );
}
