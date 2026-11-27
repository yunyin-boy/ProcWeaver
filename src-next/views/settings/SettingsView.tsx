import React, { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "../../primitives/Button";
import { flushDns, getDnsSettings, reloadCoreConfig, saveDnsSettings } from "../../services/dnsService";
import { getGeneralSettings, restoreConfigSnapshot } from "../../services/settingsService";
import { DEFAULT_DNS_SETTINGS, type DnsSettings } from "../../types/dns";
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettings } from "../../types/settings";
import { describeLanAccess, type LanAccess } from "../../utils/useLanAccess";
import { MaintenanceSettings } from "./MaintenanceSettings";
import { AppPreferences, AppearanceSettings, DnsPreferences, NetworkSettings } from "./SettingsSections";

const tabs = [
  { id: "app", label: "应用与窗口" },
  { id: "general", label: "网络与连接" },
  { id: "dns", label: "DNS" },
  { id: "maintenance", label: "更新与维护" },
] as const;

type Tab = typeof tabs[number]["id"];
type Group = "general" | "dns";

const networkKeys = [
  "mixedPort", "controllerPort", "enableControllerPort", "ipv6",
  "tcpConcurrent", "unifiedDelay", "geoLowMemory", "autoCloseConnections",
  "speedTestUrl", "speedTestConcurrency", "healthProbeConcurrency",
] as const;

interface SettingsViewProps {
  lanAccess: LanAccess;
  onShowNotice?: (msg: string) => void;
  onOpenGuide?: () => void;
  onOpenFirstUseNotice?: () => void;
}

function getChangedFields<T extends object>(current: T | null, saved: T | null): Partial<T> {
  if (!current || !saved) return {};
  return Object.fromEntries(
    (Object.keys(current) as (keyof T)[])
      .filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[key]))
      .map((key) => [key, current[key]]),
  ) as Partial<T>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ lanAccess, onShowNotice, onOpenGuide, onOpenFirstUseNotice }) => {
  const [activeTab, setActiveTab] = useState<Tab>("app");
  const [maintenanceVisited, setMaintenanceVisited] = useState(false);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);
  const [dns, setDns] = useState<DnsSettings | null>(null);
  const [savedGeneral, setSavedGeneral] = useState<GeneralSettings | null>(null);
  const [lanDraft, setLanDraft] = useState<boolean | null>(null);
  const [savedDns, setSavedDns] = useState<DnsSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [networkAction, setNetworkAction] = useState<"repair" | "restart" | null>(null);
  const [saveError, setSaveError] = useState("");

  const lanConfigured = lanAccess.status?.configured;
  const lanChecked = lanAccess.checked;
  const lanChanged = lanDraft !== null && (lanDraft !== lanConfigured || lanDraft !== lanChecked);
  const generalPatch = useMemo(() => {
    const patch = getChangedFields(general, savedGeneral);
    delete patch.allowLan;
    if (lanChanged) patch.allowLan = lanDraft;
    return patch;
  }, [general, savedGeneral, lanChanged, lanDraft]);
  const generalChanged = Object.keys(generalPatch).length > 0;
  const dnsChanged = useMemo(() => Object.keys(getChangedFields(dns, savedDns)).length > 0, [dns, savedDns]);
  const hasChanges = generalChanged || dnsChanged;
  const busy = isLoading || isSaving || isRestoring || networkAction !== null || lanAccess.pending;

  const loadSettings = async (group?: Group) => {
    setIsLoading(true);
    try {
      const readGeneral = async () => {
        try {
          const next = await getGeneralSettings({ strict: true });
          setGeneral(next);
          setSavedGeneral(next);
          return true;
        } catch {
          setGeneral(null);
          setSavedGeneral(null);
          return false;
        }
      };

      const readDns = async () => {
        try {
          const next = await getDnsSettings({ strict: true });
          setDns(next);
          setSavedDns(next);
          return true;
        } catch {
          setDns(null);
          setSavedDns(null);
          return false;
        }
      };

      const results = await Promise.all([
        group !== "dns" ? readGeneral() : true,
        group !== "general" ? readDns() : true,
      ]);
      return results.every(Boolean);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadSettings(); }, []);
  useEffect(() => {
    if (lanChecked === lanConfigured) setLanDraft((draft) => draft === lanChecked ? null : draft);
  }, [lanChecked, lanConfigured]);

  const updateGeneral = <K extends keyof GeneralSettings>(field: K, value: GeneralSettings[K]) => {
    setGeneral((current) => current && { ...current, [field]: value });
  };

  const updateDns = <K extends keyof DnsSettings>(field: K, value: DnsSettings[K]) => {
    setDns((current) => current && { ...current, [field]: value });
  };

  const updateLanDraft = (checked: boolean) => {
    setLanDraft(checked === lanConfigured && checked === lanChecked ? null : checked);
  };

  const save = async () => {
    if (busy || !hasChanges) return;
    setIsSaving(true);
    setSaveError("");
    const applied: string[] = [];
    const errors: string[] = [];
    try {
      if (generalChanged && general) {
        try {
          const { settings } = await lanAccess.save(generalPatch);
          const next = { ...settings, bypassList: general.bypassList };
          setGeneral(next);
          setSavedGeneral(next);
          setLanDraft(null);
          applied.push("常规与系统设置");
        } catch (error) {
          setLanDraft(null);
          errors.push("常规与系统设置保存失败，" + (error instanceof Error ? error.message : String(error)));
        }
      }
      if (dnsChanged && dns) {
        try {
          const next = await saveDnsSettings(dns);
          setDns(next);
          setSavedDns(next);
          applied.push("DNS 设置");
        } catch (error) {
          errors.push("DNS 设置保存失败，" + (error instanceof Error ? error.message : String(error)));
        }
      }
      const message = applied.length ? applied.join("和") + "已保存。" : "";
      if (errors.length) setSaveError(message + errors.join("。"));
      else if (message) onShowNotice?.(message);
    } finally {
      setIsSaving(false);
    }
  };

  const resetCurrent = () => {
    if (activeTab === "general") {
      const defaults = Object.fromEntries(networkKeys.map((key) => [key, DEFAULT_GENERAL_SETTINGS[key]]));
      setGeneral((current) => current && { ...current, ...defaults });
      if (lanAccess.status) updateLanDraft(DEFAULT_GENERAL_SETTINGS.allowLan);
    } else if (activeTab === "dns") {
      setDns({ ...DEFAULT_DNS_SETTINGS });
    }
  };

  const runNetworkAction = async (action: "repair" | "restart") => {
    if (busy) return;
    setNetworkAction(action);
    try {
      if (action === "repair") {
        await flushDns();
        onShowNotice?.("网络修复已完成");
      } else {
        await reloadCoreConfig();
        onShowNotice?.("核心已重启");
      }
    } catch (error) {
      onShowNotice?.((action === "repair" ? "网络修复失败，" : "重启核心失败，") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setNetworkAction(null);
    }
  };

  const restore = async (contents: string) => {
    if (busy) return;
    setIsRestoring(true);
    try {
      await restoreConfigSnapshot(contents);
      await lanAccess.refresh();
      setLanDraft(null);
      setSaveError("");
      const loaded = await loadSettings();
      onShowNotice?.(loaded ? "配置快照已恢复" : "配置快照已恢复，部分设置读取失败");
    } catch (error) {
      onShowNotice?.("恢复配置失败，" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsRestoring(false);
    }
  };

  const group = activeTab === "dns" ? "dns" : "general";
  const canReset = activeTab === "general" && general || activeTab === "dns" && dns;
  const groupMissing = activeTab !== "maintenance" && !(group === "general" ? general : dns);

  return (
    <div className="workbench-view workbench-settings">
      <section className="workbench-panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4" aria-label="设置工具区">
        <nav className="workbench-segments workbench-settings-segments max-w-full flex-wrap" aria-label="设置分栏导航">
          {tabs.map(({ id, label }) => (
            <button type="button" key={id} aria-pressed={id === activeTab} onClick={() => {
              setActiveTab(id);
              if (id === "maintenance") setMaintenanceVisited(true);
            }}>{label}</button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {hasChanges && <span className="workbench-tag workbench-tag-warning" role="status">有未保存更改</span>}
          {canReset && (
            <Button type="button" onClick={resetCurrent} disabled={busy}><RotateCcw size={14} aria-hidden="true" />恢复本栏默认</Button>
          )}
          <Button type="button" variant={hasChanges ? "primary" : "secondary"} onClick={() => void save()} disabled={busy || !hasChanges} loading={isSaving}>
            {!isSaving && <Check size={14} aria-hidden="true" />}保存更改
          </Button>
        </div>
      </section>

      {saveError && <p className="workbench-setting-feedback" role="alert">{saveError}</p>}

      {activeTab === "app" && <AppearanceSettings />}
      {groupMissing && (
        <section className="workbench-panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-[var(--text-muted)]" role="status">
          <p>{isLoading ? "正在读取设置…" : "读取设置失败，可重试。"}</p>
          {!isLoading && <Button type="button" onClick={() => void loadSettings(group)}>重新读取</Button>}
        </section>
      )}
      {activeTab !== "maintenance" && (
        <fieldset className="m-0 grid min-w-0 gap-4 border-0 p-0" disabled={busy}>
          {activeTab === "general" && general && (
            <NetworkSettings settings={general} update={updateGeneral} lan={{
              checked: lanChanged ? lanDraft : lanChecked,
              disabled: !lanAccess.status,
              onChange: updateLanDraft,
              help: lanAccess.pending ? "正在应用…" : `${lanChanged ? "待保存 · " : ""}${describeLanAccess(lanAccess.status)}`,
            }} />
          )}
          {activeTab === "dns" && dns && (
            <DnsPreferences settings={dns} update={updateDns} onShowNotice={onShowNotice} />
          )}
          {activeTab === "app" && general && <AppPreferences settings={general} update={updateGeneral} />}
        </fieldset>
      )}
      {activeTab === "app" && (onOpenGuide || onOpenFirstUseNotice) && (
        <section className="workbench-panel flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 className="workbench-panel-title">使用帮助</h3>
          <div className="flex flex-wrap gap-2">
            {onOpenFirstUseNotice && <Button type="button" onClick={onOpenFirstUseNotice}>查看使用须知</Button>}
            {onOpenGuide && <Button type="button" onClick={onOpenGuide}>重新打开新手引导</Button>}
          </div>
        </section>
      )}
      {maintenanceVisited && (
        <div className={activeTab === "maintenance" ? "grid min-w-0 gap-4" : "hidden"}>
          <MaintenanceSettings busy={busy} restoring={isRestoring} onRestore={restore}
            networkAction={networkAction} onNetworkAction={runNetworkAction} onShowNotice={onShowNotice} />
        </div>
      )}
    </div>
  );
};
