import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Save, Trash2, X } from "lucide-react";
import type { useExternalProxyEditor } from "../../hooks/useExternalProxyEditor";
import { Button } from "../../../src-next/primitives/Button";
import { SettingsSection, SettingSwitch } from "../../../src-next/views/settings/SettingsSections";
import { ExternalProxyProbePanel } from "./ExternalProxyProbePanel";

interface Props {
  open: boolean;
  bundleName?: string;
  state: ReturnType<typeof useExternalProxyEditor>;
  onClose: () => void;
  onManageOutlets?: () => void;
  inline?: boolean;
}

const field = "workbench-field min-h-9 w-full px-2.5 text-[13px] font-normal disabled:opacity-50";

export function ExternalProxyDialog({ open, bundleName, state: s, onClose, onManageOutlets, inline = false }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busy = useRef(s.busy);
  busy.current = s.busy;

  useEffect(() => {
    if (!open || inline) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!busy.current) close.current();
      }
      if (e.key === "Tab") {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
          ) || []
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, [open, inline]);

  if (!open) return null;
  const { actions, view, draft, busy: saving } = s;
  const endpointOptions = view?.endpoints.map(endpoint => (
    <option key={endpoint.id} value={endpoint.id}>{endpoint.name} · {endpoint.protocol.toUpperCase()}</option>
  ));

  const content = (
    <>
      {s.error && <p role="alert" className="workbench-setting-feedback">{s.error}</p>}
      {s.message && <p role="status" className="workbench-panel flex items-center gap-2 p-3 text-xs text-[var(--workbench-positive)]">
        <Check size={14} aria-hidden="true" /> {s.message}
      </p>}
      {!view ? (
        <div className="workbench-panel flex flex-wrap items-center justify-between gap-2 p-4 text-xs">
          <span>{saving ? "正在读取代理设置…" : "代理设置尚未读取"}</span>
          <Button type="button" loading={saving} onClick={() => void actions.load()}>重新读取</Button>
        </div>
      ) : bundleName ? (
        <>
          <label className="workbench-settings-field">
            包内出口
            <select aria-label="包内外部代理" className={field} disabled={saving} value={s.endpointId} onChange={event => actions.setEndpointId(event.target.value)}>
              <option value="">跟随默认代理</option>
              {endpointOptions}
            </select>
            {!view.endpoints.length && <small>请先添加 HTTP 或 SOCKS5 代理。</small>}
          </label>
          <label className="workbench-settings-field">
            沙盒未命中时
            <select aria-label="独立沙盒未命中策略" className={field} disabled={saving} value={s.fallback}
              onChange={event => actions.setFallback(event.target.value as "direct" | "default")}>
              <option value="direct">直连</option>
              <option value="default">使用默认外部代理</option>
            </select>
          </label>
          <SettingSwitch title="启用此业务包" checked={s.enabled} onChange={actions.setEnabled} disabled={saving} />
        </>
      ) : (
        <>
          <SettingsSection title="默认出口">
            <label className="workbench-settings-field">
              <select aria-label="默认外部代理" className={field} disabled={saving}
                value={view.defaultEndpointId || ""} onChange={event => void actions.setDefault(event.target.value)}>
                <option value="">未指定（默认使用直连或系统路由）</option>
                {endpointOptions}
              </select>
              <small>未指定专用出口的业务包使用此代理。</small>
            </label>
          </SettingsSection>

          <SettingsSection title="代理节点配置" tools={
            <Button type="button" onClick={() => actions.edit("")} disabled={saving}>
              <Plus size={14} aria-hidden="true" /> 新增代理
            </Button>
          }>
            {view.endpoints.length > 0 && <div className="workbench-segments workbench-settings-segments w-fit max-w-full flex-wrap" role="group" aria-label="编辑代理节点">
              {view.endpoints.map(endpoint => (
                <button type="button" key={endpoint.id} aria-pressed={draft.id === endpoint.id} disabled={saving} onClick={() => actions.edit(endpoint.id)}
                  className="max-w-full [overflow-wrap:anywhere]">
                  {endpoint.name} <span className="text-[11px]">{endpoint.protocol.toUpperCase()}</span>
                </button>
              ))}
            </div>}
            <div className="workbench-settings-grid">
              <label className="workbench-settings-field">
                代理名称
                <input aria-label="代理名称" className={field} value={draft.name} maxLength={120} disabled={saving}
                  onChange={event => actions.setDraft({ ...draft, name: event.target.value })} placeholder="例如 本地 SOCKS5" />
              </label>
              <label className="workbench-settings-field">
                代理协议
                <select aria-label="代理协议" className={field} value={draft.protocol} disabled={saving}
                  onChange={event => actions.setDraft({ ...draft, protocol: event.target.value as "http" | "socks5" })}>
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </label>
              <label className="workbench-settings-field">
                主机名 / IP
                <input aria-label="代理主机" className={field} value={draft.host} disabled={saving} maxLength={255} spellCheck={false}
                  onChange={event => actions.setDraft({ ...draft, host: event.target.value })} placeholder="例如 127.0.0.1" />
              </label>
              <label className="workbench-settings-field">
                端口
                <input aria-label="代理端口" className={field} type="number" min={1} max={65535} value={draft.port} disabled={saving}
                  onChange={event => actions.setDraft({ ...draft, port: Number(event.target.value) })} />
              </label>
              <label className="workbench-settings-field">
                用户名
                <input aria-label="代理用户名" className={field} autoComplete="off" value={draft.username} disabled={saving}
                  onChange={event => actions.setDraft({ ...draft, username: event.target.value })} placeholder="留空即无需认证" />
              </label>
              <label className="workbench-settings-field">
                密码
                <input aria-label="代理密码" className={field} type="password" autoComplete="new-password" value={draft.password || ""} disabled={saving || !draft.username}
                  placeholder={view.endpoints.find(endpoint => endpoint.id === draft.id)?.hasPassword ? "已保存，留空保持原密码" : "请输入密码"}
                  onChange={event => actions.setDraft({ ...draft, password: event.target.value })} />
              </label>
            </div>
            <p className="text-xs text-[var(--text-muted)]">代理凭据由当前 Windows 账户加密保存。HTTP 使用 Basic 认证，SOCKS5 使用用户名和密码认证。</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" disabled={saving || !view.endpoints.some(endpoint => endpoint.id === draft.id)} onClick={() => void actions.remove()}>
                <Trash2 size={14} aria-hidden="true" /> 移除当前代理
              </Button>
              <Button type="button" variant="primary" disabled={saving} onClick={() => void actions.saveEndpoint()}>
                <Save size={14} aria-hidden="true" /> 保存当前代理
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection title="本地 DNS 入口">
            <SettingSwitch title="启用独立 DNS 入口" help="为每个已启用的业务包开放专用本地 DNS 入口。" checked={s.dns.enabled} disabled={saving}
              onChange={enabled => actions.setDns({ ...s.dns, enabled })} />
            <div className="workbench-settings-grid">
              <label className="workbench-settings-field">
                DNS 上游 IP
                <input aria-label="DNS 上游 IP" className={field} value={s.dns.server} disabled={saving} spellCheck={false}
                  onChange={event => actions.setDns({ ...s.dns, server: event.target.value })} />
              </label>
              <label className="workbench-settings-field">
                DNS 上游端口
                <input aria-label="DNS 上游端口" className={field} type="number" min={1} max={65535} value={s.dns.port} disabled={saving}
                  onChange={event => actions.setDns({ ...s.dns, port: Number(event.target.value) })} />
              </label>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">Hook 和 WinDivert 按套件的 DNS 模式选路。切入或退出系统原生解析时，请重启由 Hook 接管的应用。</p>
            {view.states.length > 0 && <div className="grid gap-1.5">
              {view.states.map(entry => (
                <div key={entry.id} className="workbench-setting-row flex-wrap text-xs">
                  <span className="font-medium">{view.bundles.find(bundle => bundle.id === entry.id)?.name || entry.id}</span>
                  <div className="flex flex-wrap gap-2 text-[var(--text-muted)]">
                    <span>代理 {entry.ready ? "127.0.0.1:" + entry.port : "未就绪"}</span>
                    <span>DNS {entry.dnsReady ? "127.0.0.1:" + entry.dnsPort : "未开启"}</span>
                  </div>
                </div>
              ))}
            </div>}
            <div className="flex justify-end">
              <Button type="button" variant="primary" disabled={saving} onClick={() => void actions.saveDns()}>保存 DNS 设置</Button>
            </div>
          </SettingsSection>

          <ExternalProxyProbePanel
            busy={saving}
            endpoint={s.probeEndpoint}
            draft={s.probe}
            presets={s.probePresets}
            records={s.probeRecords}
            onDraft={actions.setProbe}
            onKind={actions.setProbeKind}
            onPreset={actions.setProbePreset}
            onTest={() => void actions.test()}
            onClear={actions.clearProbeRecords}
          />
        </>
      )}
    </>
  );

  if (inline) return <div className="workbench-view">{content}</div>;

  return createPortal(
    <div className="workbench-dialog-backdrop fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="workbench-dialog grid max-h-[calc(100dvh-2rem)] w-full max-w-lg gap-4 overflow-auto p-4 sm:p-6">
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="workbench-panel-title">选择专用出口</h2>
            <p className="text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">{bundleName}</p>
          </div>
          <button type="button" className="workbench-title-button shrink-0" aria-label="关闭独立代理设置" onClick={onClose} disabled={saving}><X size={16} aria-hidden="true" /></button>
        </header>
        {content}
        <footer className="flex flex-wrap justify-end gap-2">
          {onManageOutlets && <Button type="button" variant="ghost" className="mr-auto" disabled={saving} onClick={onManageOutlets}>管理外部代理</Button>}
          <Button type="button" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="button" variant="primary" disabled={saving || !view?.supported} onClick={() => void actions.saveBundle()}>应用独立代理</Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
