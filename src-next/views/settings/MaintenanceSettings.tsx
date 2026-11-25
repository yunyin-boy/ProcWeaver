import React, { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "../../primitives/Button";
import { ConfirmModal } from "../../primitives/ConfirmModal";
import {
  checkAppUpdate,
  checkMihomoUpdate,
  downloadAppUpdate,
  getGeoConfig,
  getMihomoCoreDetail,
  installAppUpdate,
  syncAllGeoResources,
  syncGeoResource,
} from "../../services/maintenanceService";
import { cleanWindivertResidualService, exportConfigSnapshot } from "../../services/settingsService";
import type { AppUpdateInfo, GeoConfig, MihomoCoreDetail, MihomoReleaseInfo } from "../../types/maintenance";
import { SettingsSection } from "./SettingsSections";

interface MaintenanceSettingsProps {
  busy: boolean;
  restoring: boolean;
  onRestore: (contents: string) => Promise<void>;
  networkAction: "repair" | "restart" | null;
  onNetworkAction: (action: "repair" | "restart") => Promise<void>;
  onShowNotice?: (msg: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MaintenanceSettings({ busy, restoring, onRestore, networkAction, onNetworkAction, onShowNotice }: MaintenanceSettingsProps) {
  const [app, setApp] = useState<AppUpdateInfo | null>(null);
  const [appAction, setAppAction] = useState<"check" | "download" | "apply" | "restart" | null>(null);
  const [appError, setAppError] = useState("");
  const [archive, setArchive] = useState<{ url: string; path: string } | null>(null);
  const [core, setCore] = useState<MihomoCoreDetail | null>(null);
  const [coreReadFailed, setCoreReadFailed] = useState(false);
  const [latestCore, setLatestCore] = useState<MihomoReleaseInfo | null>(null);
  const [checkingCore, setCheckingCore] = useState(false);
  const [geo, setGeo] = useState<GeoConfig | null>(null);
  const [geoReadFailed, setGeoReadFailed] = useState(false);
  const [geoSync, setGeoSync] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [confirmDriver, setConfirmDriver] = useState(false);
  const [cleaningDriver, setCleaningDriver] = useState(false);
  const [driverResult, setDriverResult] = useState<{ message: string; failed: boolean } | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);

  const refreshCore = async () => {
    setCoreReadFailed(false);
    try { setCore(await getMihomoCoreDetail({ strict: true })); }
    catch { setCoreReadFailed(true); }
  };

  const refreshGeo = async () => {
    setGeoReadFailed(false);
    try { setGeo(await getGeoConfig({ strict: true })); }
    catch { setGeoReadFailed(true); }
  };

  const findAppUpdate = async () => {
    setAppAction("check");
    setAppError("");
    try {
      const result = await checkAppUpdate();
      if (!result) throw new Error("未收到版本信息");
      setApp(result);
    } catch (error) {
      setAppError("检查更新失败，" + errorMessage(error));
    } finally {
      setAppAction(null);
    }
  };

  useEffect(() => {
    void refreshCore();
    void refreshGeo();
    void findAppUpdate();
  }, []);

  const updateApp = async () => {
    if (!app?.downloadUrl || appAction || busy) return;
    setAppError("");
    try {
      let path = archive?.url === app.downloadUrl ? archive.path : undefined;
      if (!path) {
        setAppAction("download");
        path = await downloadAppUpdate(app.downloadUrl, app.assetName || "ProcWeaver_Portable.zip");
        setArchive({ url: app.downloadUrl, path });
      }
      setAppAction("apply");
      if (!(await installAppUpdate(path))) throw new Error("更新程序未确认启动");
      setAppAction("restart");
      onShowNotice?.("更新程序已启动，正在准备重启");
    } catch (error) {
      setAppAction(null);
      setAppError("应用更新失败，" + errorMessage(error));
    }
  };

  const findCoreUpdate = async () => {
    setCheckingCore(true);
    try { setLatestCore(await checkMihomoUpdate()); }
    catch (error) { onShowNotice?.("检查内核版本失败，" + errorMessage(error)); }
    finally { setCheckingCore(false); }
  };

  const updateGeo = async (id?: string) => {
    if (geoSync) return;
    setGeoSync(id ?? "all");
    try {
      if (id) {
        const resource = await syncGeoResource(id);
        setGeo((current) => current && { ...current, resources: current.resources.map((item) => item.id === id ? resource : item) });
      } else {
        setGeo(await syncAllGeoResources());
      }
      onShowNotice?.(id ? "数据库已更新" : "数据库同步已完成");
    } catch (error) {
      onShowNotice?.("数据库更新失败，" + errorMessage(error));
    } finally {
      setGeoSync(null);
    }
  };

  const exportSnapshot = async () => {
    setIsExporting(true);
    try {
      const snapshot = await exportConfigSnapshot();
      const url = URL.createObjectURL(new Blob([snapshot], { type: "application/json" }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "procweaver-backup-" + new Date().toISOString().slice(0, 10) + ".json";
        link.click();
        onShowNotice?.("已发起导出配置快照");
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      onShowNotice?.("导出配置失败，" + errorMessage(error));
    } finally {
      setIsExporting(false);
    }
  };

  const restoreSnapshot = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try { await onRestore(await file.text()); }
    catch (error) { onShowNotice?.("读取快照失败，" + errorMessage(error)); }
    finally { input.value = ""; }
  };

  const cleanDriver = async () => {
    if (cleaningDriver) return;
    setCleaningDriver(true);
    setDriverResult(null);
    try {
      const message = await cleanWindivertResidualService();
      setDriverResult({ message, failed: false });
      setConfirmDriver(false);
    } catch (error) {
      const message = "清理驱动失败，" + errorMessage(error);
      setDriverResult({ message, failed: true });
      setConfirmDriver(false);
    } finally {
      setCleaningDriver(false);
    }
  };

  const updateButtonsLocked = busy || appAction !== null;

  return (
    <>
      <SettingsSection title="Mihomo 内核" tools={
        <div className="flex flex-wrap gap-2">
          {coreReadFailed && <Button type="button" onClick={() => void refreshCore()}>重新读取</Button>}
          <Button type="button" onClick={() => void findCoreUpdate()} loading={checkingCore}>检查官方版本</Button>
        </div>
      }>
        {coreReadFailed && <p className="workbench-setting-feedback" role="status">读取核心状态失败。</p>}
        <dl className="workbench-stat-grid">
          <div><dt>内核版本</dt><dd>{core?.coreVersionTag || "—"}</dd></div>
          <div><dt>运行模式</dt><dd>{core?.activeCoreMode || "—"}</dd></div>
          <div><dt>CPU 架构</dt><dd>{core?.cpuArch || "—"}</dd></div>
          <div><dt>AVX2</dt><dd>{core ? core.avx2Supported ? "支持" : "不支持" : "—"}</dd></div>
        </dl>
        {core && (
          <p className="text-xs leading-relaxed text-[var(--text-muted)] [overflow-wrap:anywhere]">
            {core.isRunning ? "运行中" : "已停止"}{core.pid ? " · PID " + core.pid : ""}{core.coreVersionRaw ? " · " + core.coreVersionRaw : ""}
          </p>
        )}
        {latestCore && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            官方最新版本 {latestCore.latestVersion}
            {latestCore.htmlUrl && <a className="workbench-action" href={latestCore.htmlUrl} target="_blank" rel="noreferrer">发布页 <ExternalLink size={13} aria-hidden="true" /></a>}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="ProcWeaver 更新" tools={
        <Button type="button" onClick={() => void findAppUpdate()} loading={appAction === "check"} disabled={updateButtonsLocked}>
          {appAction !== "check" && <RefreshCw size={14} aria-hidden="true" />}检查更新
        </Button>
      }>
        <dl className="workbench-stat-grid">
          <div><dt>当前版本</dt><dd>{app?.currentVersion ?? "—"}</dd></div>
          <div><dt>最新版本</dt><dd>{app?.latestVersion ?? "—"}</dd></div>
          <div><dt>更新状态</dt><dd>{appAction === "check" ? "正在检查" : app ? app.hasUpdate ? "有可用更新" : "已是最新" : "未取得结果"}</dd></div>
        </dl>
        {appError && <p className="workbench-setting-feedback" role="status">{appError}</p>}
        {app?.hasUpdate && (
          <div className="grid min-w-0 gap-2 rounded-lg bg-[var(--workbench-row-hover)] p-3">
            <p className="text-[13px] font-medium [overflow-wrap:anywhere]">{app.releaseName || app.latestVersion}</p>
            {app.releaseNotes && (
              <details className="min-w-0 text-xs text-[var(--text-muted)]">
                <summary className="cursor-pointer rounded-sm">更新说明</summary>
                <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{app.releaseNotes}</p>
              </details>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {app.htmlUrl && <a className="workbench-action" href={app.htmlUrl} target="_blank" rel="noreferrer">发布页 <ExternalLink size={13} aria-hidden="true" /></a>}
              <Button type="button" variant="primary" onClick={() => void updateApp()} disabled={!app.downloadUrl || updateButtonsLocked}
                loading={appAction === "download" || appAction === "apply"}>
                {appAction === "download" ? "下载中" : appAction === "apply" ? "准备更新" : appAction === "restart" ? "准备重启" : "下载并更新"}
              </Button>
              <span className="text-xs text-[var(--text-muted)]" role="status">
                {app.downloadUrl ? app.assetSizeFormatted : "该版本暂无便携更新包"}
              </span>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Geo 离线数据库" tools={
        geoReadFailed
          ? <Button type="button" onClick={() => void refreshGeo()}>重新读取</Button>
          : <Button type="button" onClick={() => void updateGeo()} loading={geoSync === "all"} disabled={geoSync !== null || !geo}>同步全部</Button>
      }>
        {geoReadFailed && <p className="workbench-setting-feedback" role="status">读取数据库列表失败。</p>}
        {geo && !geo.resources.length && <p className="text-xs text-[var(--text-muted)]">暂无数据库资源。</p>}
        <div className="grid min-w-0 gap-2">
          {geo?.resources.map((resource) => (
            <div key={resource.id} className="workbench-setting-row">
              <div className="grid min-w-0 gap-1">
                <span className="text-[13px] font-medium [overflow-wrap:anywhere]">{resource.name}</span>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
                  <span className="font-mono [overflow-wrap:anywhere]">{resource.fileName}</span>
                  <span>{resource.exists ? resource.fileSizeFormatted : "文件缺失"}</span>
                  {resource.updatedAtRelative && <span>{resource.updatedAtRelative}</span>}
                </div>
              </div>
              <Button type="button" size="sm" onClick={() => void updateGeo(resource.id)} loading={geoSync === resource.id} disabled={geoSync !== null}>更新</Button>
            </div>
          ))}
        </div>
        {geo?.lastError && <p className="workbench-setting-feedback" role="status">{geo.lastError}</p>}
      </SettingsSection>

      <SettingsSection title="配置快照">
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">导出当前配置，或从已有快照恢复本机设置。</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void exportSnapshot()} loading={isExporting} disabled={busy}>
            {!isExporting && <Download size={14} aria-hidden="true" />}导出快照
          </Button>
          <Button type="button" onClick={() => inputFile.current?.click()} disabled={busy || isExporting} loading={restoring}>
            {!restoring && <Upload size={14} aria-hidden="true" />}恢复快照
          </Button>
          <input ref={inputFile} type="file" className="hidden" accept=".json,application/json" onChange={(event) => void restoreSnapshot(event)} />
        </div>
      </SettingsSection>

      <SettingsSection title="网络维护">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void onNetworkAction("repair")} loading={networkAction === "repair"} disabled={busy}>运行网络修复</Button>
          <Button type="button" onClick={() => void onNetworkAction("restart").then(refreshCore)} loading={networkAction === "restart"} disabled={busy}>
            {networkAction !== "restart" && <RefreshCw size={14} aria-hidden="true" />}重启核心
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="WinDivert 驱动" tools={
        <Button type="button" variant="danger" onClick={() => setConfirmDriver(true)} loading={cleaningDriver} disabled={busy}>
          {!cleaningDriver && <Trash2 size={14} aria-hidden="true" />}清理残留驱动服务
        </Button>
      }>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">移除残留的 WinDivert 服务和临时组件。</p>
        {driverResult && (
          <p className={driverResult.failed ? "workbench-setting-feedback" : "text-xs text-[var(--workbench-positive)]"} role="status">
            {driverResult.message}
          </p>
        )}
      </SettingsSection>

      <ConfirmModal isOpen={confirmDriver} title="清理残留驱动服务？"
        description="此操作会停止并移除 WinDivert 的残留服务与临时文件。"
        confirmText="确认清理" isLoading={cleaningDriver} onConfirm={cleanDriver}
        onCancel={() => { if (!cleaningDriver) setConfirmDriver(false); }} />
    </>
  );
}
