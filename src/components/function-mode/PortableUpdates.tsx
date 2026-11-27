import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ExternalLink, RefreshCw } from "lucide-react";
import { version } from "../../../package.json";
import { Button } from "../../../src-next/primitives/Button";
import { Modal } from "../../../src-next/primitives/Modal";
import { SettingsSection } from "../../../src-next/views/settings/SettingsSections";
import type { AppUpdateInfo } from "../../types";
import { isTauri } from "../../api";

type Phase = "check" | "download" | "prepare" | "restart";
type Outcome = { version: string; success: boolean; message: string };
type View = { info: AppUpdateInfo | null; phase: Phase | null; error: string; outcome: Outcome | null };

const releasesUrl = "https://github.com/yunyin-boy/ProcWeaver/releases";
const subscribers = new Set<() => void>();
let view: View = { info: null, phase: null, error: "", outcome: null };
let initialized = false;

export function usesPortableUpdates() {
  return isTauri() && /Windows/i.test(navigator.userAgent);
}

function updateView(change: Partial<View>) {
  view = { ...view, ...change };
  for (const subscriber of subscribers) subscriber();
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}

function useUpdateView() {
  return useSyncExternalStore(subscribe, () => view, () => view);
}

async function check() {
  if (view.phase) return;
  updateView({ phase: "check", error: "" });
  try {
    updateView({ info: await invoke<AppUpdateInfo>("check_app_update") });
  } catch (error) {
    updateView({ error: String(error), info: null });
  } finally {
    updateView({ phase: null });
  }
}

async function apply() {
  const target = view.info;
  if (view.phase || !target?.hasUpdate || !target.downloadUrl) return;
  updateView({ phase: "download", error: "", outcome: null });
  try {
    await invoke("apply_portable_update", { version: target.latestVersion });
    updateView({ phase: "restart" });
  } catch (error) {
    updateView({ phase: null, error: String(error) });
  }
}

async function start() {
  if (initialized || !usesPortableUpdates()) return;
  initialized = true;
  await Promise.allSettled([
    listen("procweaver-update-preparing", () => {
      if (view.phase === "download") updateView({ phase: "prepare" });
    }),
    listen<string>("procweaver-update-error", ({ payload }) => {
      updateView({ phase: null, error: payload });
    }),
  ]);
  try {
    updateView({ outcome: await invoke<Outcome | null>("portable_workbench_ready") });
  } catch (error) {
    console.warn("[更新] 无法报告工作台状态", error);
  }
  await check();
}

function UpdateDetails({ update, busy = false }: { update: AppUpdateInfo; busy?: boolean }) {
  const { phase, error } = useUpdateView();
  return (
    <div className="grid gap-3 text-xs">
      {update.releaseNotes && (
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--workbench-row-hover)] p-3 leading-relaxed select-text">
          {update.releaseNotes}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <a className="workbench-action" href={update.htmlUrl} target="_blank" rel="noreferrer">
          发布页 <ExternalLink size={13} aria-hidden="true" />
        </a>
        {update.downloadUrl ? (
          <Button type="button" variant="primary" disabled={busy || phase !== null}
            loading={phase === "download" || phase === "prepare"} onClick={() => void apply()}>
            {phase === "download" ? "下载中" : phase === "prepare" ? "正在校验更新包" : phase === "restart" ? "正在重启" : "下载并更新"}
          </Button>
        ) : <span className="text-[var(--text-muted)]">此版本可通过发布页手动更新</span>}
        {update.downloadUrl && <span className="text-[var(--text-muted)]">{update.assetSizeFormatted}</span>}
      </div>
      {error && <p className="workbench-setting-feedback" role="alert">{error}</p>}
    </div>
  );
}

export function PortableUpdatePrompt() {
  const { info, outcome } = useUpdateView();
  const [dismissed, setDismissed] = useState("");
  useEffect(() => { void start(); }, []);
  if (!info?.hasUpdate || info.latestVersion === dismissed || outcome?.success === false) return null;
  return (
    <Modal isOpen title={"发现新版本 " + info.latestVersion} onClose={() => setDismissed(info.latestVersion)}>
      <UpdateDetails update={info} />
    </Modal>
  );
}

export function PortableUpdateSettings({ title, busy = false }: { title: string; busy?: boolean }) {
  const { info, phase, error, outcome } = useUpdateView();
  return (
    <SettingsSection title={title} tools={
      <Button type="button" onClick={() => void check()} loading={phase === "check"} disabled={busy || phase !== null}>
        {phase !== "check" && <RefreshCw size={14} aria-hidden="true" />} 检查更新
      </Button>
    }>
      <dl className="workbench-stat-grid">
        <div><dt>当前版本</dt><dd>{info?.currentVersion ?? "v" + version}</dd></div>
        <div><dt>最新版本</dt><dd>{info?.latestVersion ?? "—"}</dd></div>
        <div><dt>更新状态</dt><dd>{phase === "check" ? "正在检查" : info ? info.hasUpdate ? "有可用更新" : "已是最新" : "未取得结果"}</dd></div>
      </dl>
      {outcome && <p className="workbench-setting-feedback" role="status">{outcome.message}</p>}
      {info?.hasUpdate
        ? <UpdateDetails update={info} busy={busy} />
        : <>
          {error && <p className="workbench-setting-feedback" role="alert">{error}</p>}
          <a className="workbench-action workbench-action-ghost w-fit" href={releasesUrl} target="_blank" rel="noreferrer">
            GitHub Releases <ExternalLink size={13} aria-hidden="true" />
          </a>
        </>}
    </SettingsSection>
  );
}
