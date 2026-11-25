import React, { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../../primitives/Button";
import { CapsuleToggle } from "../../primitives/CapsuleToggle";
import type { DnsSettings } from "../../types/dns";
import type { GeneralSettings } from "../../types/settings";
import { DEFAULT_WINDOW_OPACITY, MAX_WINDOW_OPACITY, MIN_WINDOW_OPACITY, WINDOW_OPACITY_KEY, readWindowOpacity } from "../../utils/windowOpacity";

export function SettingsSection({ title, tools, children }: { title: string; tools?: React.ReactNode; children: React.ReactNode }) {
  const headingId = useId();
  return (
    <section className="workbench-panel grid min-w-0 gap-3.5 p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={headingId} className="workbench-panel-title">{title}</h3>
        {tools}
      </div>
      {children}
    </section>
  );
}

function SettingSwitch({ title, help, checked, onChange }: {
  title: string; help?: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return (
    <div className="workbench-setting-row">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {help && <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{help}</p>}
      </div>
      <CapsuleToggle checked={checked} title={title} onChange={onChange} />
    </div>
  );
}

function SettingRange({ title, value, min, max, suffix = "", choices, onChange }: {
  title: string; value: number; min: number; max: number; suffix?: string; choices: number[]; onChange: (value: number) => void;
}) {
  const inputId = useId();
  return (
    <div className="workbench-setting-range grid min-w-0 gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="text-[13px] font-medium" htmlFor={inputId}>{title}</label>
        <output className="text-xs font-semibold tabular-nums text-[var(--workbench-accent)]" htmlFor={inputId}>{value}{suffix}</output>
      </div>
      <input id={inputId} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <div className="workbench-segments workbench-settings-segments w-fit flex-wrap" role="group" aria-label={title + "预设"}>
        {choices.map((choice) => (
          <button type="button" key={choice} aria-pressed={choice === value} onClick={() => onChange(choice)}>{choice}{suffix}</button>
        ))}
      </div>
    </div>
  );
}

interface SettingOption<T extends string> {
  id: T;
  label: string;
  description: string;
}

function SettingOptions<T extends string>({ label, options, value, onChange }: {
  label: string; options: readonly SettingOption<T>[]; value: T; onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.id === value);
  return (
    <div className="grid min-w-0 gap-2">
      <div className="text-[13px] font-medium">{label}</div>
      <div className="workbench-segments workbench-settings-segments w-fit max-w-full flex-wrap" role="group" aria-label={label}>
        {options.map((option) => (
          <button type="button" key={option.id} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      {selected && <p className="text-xs leading-relaxed text-[var(--text-muted)]">{selected.description}</p>}
    </div>
  );
}

const probePresets = [
  { label: "Cloudflare 204", url: "https://cp.cloudflare.com/generate_204" },
  { label: "Google 204", url: "https://www.google.com/generate_204" },
];

const performanceSwitches = [
  { key: "tcpConcurrent", title: "TCP 并发建连", help: "尝试多个解析地址并采用先建立的连接。" },
  { key: "unifiedDelay", title: "统一握手延迟", help: "使用统一方式测量节点延迟。" },
  { key: "geoLowMemory", title: "Geo 低内存加载", help: "以节省内存的方式加载地理数据库。" },
  { key: "autoCloseConnections", title: "切换节点时关闭旧连接", help: "切换出口后断开仍在使用旧出口的相关连接。" },
] as const;

type UpdateGeneral = <K extends keyof GeneralSettings>(field: K, value: GeneralSettings[K]) => void;
type UpdateDns = <K extends keyof DnsSettings>(field: K, value: DnsSettings[K]) => void;

export function NetworkSettings({ settings, update }: { settings: GeneralSettings; update: UpdateGeneral }) {
  return (
    <>
      <SettingsSection title="端口与网络访问">
        <div className="workbench-settings-grid items-start">
          <label className="workbench-settings-field">
            <span>混合代理端口</span>
            <input type="number" min={1} max={65535} value={settings.mixedPort || ""} placeholder="7890"
              onChange={(event) => update("mixedPort", Number(event.target.value))} />
            <small>HTTP 和 SOCKS 代理共用的本地端口</small>
          </label>
          <div className="grid min-w-0 gap-2">
            <SettingSwitch title="允许局域网" checked={settings.allowLan} onChange={(checked) => update("allowLan", checked)} />
            <SettingSwitch title="启用 IPv6" checked={settings.ipv6} onChange={(checked) => update("ipv6", checked)} />
          </div>
        </div>
        <div className="workbench-settings-grid items-center rounded-lg bg-[var(--workbench-row-hover)] p-3" role="group" aria-label="API 控制">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[13px] font-medium">API 控制</span>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{settings.enableControllerPort ? "已启用" : "已关闭"} · 绑定本机回环地址</p>
            </div>
            <CapsuleToggle title="启用 API 控制" checked={settings.enableControllerPort} onChange={(checked) => update("enableControllerPort", checked)} />
          </div>
          <label className="workbench-settings-field">
            <span>控制端口</span>
            <input type="number" min={1} max={65535} value={settings.controllerPort || ""} placeholder="9090"
              disabled={!settings.enableControllerPort} onChange={(event) => update("controllerPort", Number(event.target.value))} />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="连接策略">
        <div className="workbench-settings-grid">
          {performanceSwitches.map(({ key, title, help }) => (
            <SettingSwitch key={key} title={title} help={help} checked={settings[key]} onChange={(checked) => update(key, checked)} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="测速与 IP 体检">
        <label className="workbench-settings-field">
          <span>测速地址</span>
          <input type="url" value={settings.speedTestUrl} onChange={(event) => update("speedTestUrl", event.target.value)} />
        </label>
        <div className="workbench-segments workbench-settings-segments w-fit flex-wrap" role="group" aria-label="测速地址预设">
          {probePresets.map(({ label, url }) => (
            <button type="button" key={url} aria-pressed={settings.speedTestUrl === url} onClick={() => update("speedTestUrl", url)}>{label}</button>
          ))}
        </div>
        <div className="workbench-settings-grid">
          <SettingRange title="节点测速并发数" min={1} max={32} value={settings.speedTestConcurrency} choices={[8, 10, 16]}
            onChange={(value) => update("speedTestConcurrency", value)} />
          <SettingRange title="IP 健康体检并发数" min={1} max={32} value={settings.healthProbeConcurrency} choices={[2, 4, 8]}
            onChange={(value) => update("healthProbeConcurrency", value)} />
        </div>
      </SettingsSection>
    </>
  );
}

const dnsModes = [
  { id: "fake-ip", label: "Fake-IP", description: "先返回虚拟 IP，核心在分流时使用对应域名。" },
  { id: "redir-host", label: "Redir-Host", description: "返回实际解析出的 IP 地址。" },
  { id: "normal", label: "Normal", description: "使用常规 DNS 解析模式。" },
] as const satisfies readonly SettingOption<DnsSettings["enhancedMode"]>[];

export function DnsPreferences({ settings, update, onShowNotice }: {
  settings: DnsSettings; update: UpdateDns; onShowNotice?: (msg: string) => void;
}) {
  const [input, setInput] = useState("");
  const addDomain = () => {
    const value = input.trim().toLowerCase();
    if (!value) return;
    if (settings.fakeIpFilter.includes(value)) {
      onShowNotice?.("该条目已在过滤名单中");
      return;
    }
    update("fakeIpFilter", [...settings.fakeIpFilter, value]);
    setInput("");
  };

  return (
    <>
      <SettingsSection title="DNS 解析">
        <SettingSwitch title="启用 DNS 覆写" help="使用这里的 DNS 选项覆写当前订阅。" checked={settings.enableOverride}
          onChange={(checked) => update("enableOverride", checked)} />
        <SettingOptions<DnsSettings["enhancedMode"]> label="解析模式" options={dnsModes} value={settings.enhancedMode}
          onChange={(value) => update("enhancedMode", value)} />
      </SettingsSection>

      {settings.enhancedMode === "fake-ip" && (
        <SettingsSection title="Fake-IP 参数">
          <div className="workbench-settings-grid items-end">
            <label className="workbench-settings-field">
              <span>Fake-IP 地址范围</span>
              <input type="text" value={settings.fakeIpRange} onChange={(event) => update("fakeIpRange", event.target.value)} />
            </label>
            <SettingSwitch title="优先系统 Hosts" checked={settings.useSystemHosts} onChange={(checked) => update("useSystemHosts", checked)} />
          </div>
          <div className="grid min-w-0 gap-2.5" role="group" aria-label="Fake-IP 过滤名单">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[13px] font-medium">过滤名单</h4>
              <span className="text-xs tabular-nums text-[var(--text-muted)]">{settings.fakeIpFilter.length} 条</span>
            </div>
            {settings.fakeIpFilter.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {settings.fakeIpFilter.map((domain, index) => (
                  <span key={index} className="workbench-tag min-w-0 max-w-full font-mono">
                    <span className="[overflow-wrap:anywhere]">{domain}</span>
                    <button type="button" className="rounded-sm p-0.5 hover:bg-[var(--workbench-hover)]" aria-label={"移除 " + domain}
                      onClick={() => update("fakeIpFilter", settings.fakeIpFilter.filter((_, position) => position !== index))}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input type="text" aria-label="新增过滤域名" value={input} placeholder="例如 *.lan" className="min-h-9 min-w-28 flex-1 px-2.5 text-[13px]"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addDomain(); } }} />
              <Button type="button" onClick={addDomain} disabled={!input.trim()}><Plus size={14} aria-hidden="true" />添加</Button>
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="上游 DNS">
        <div className="workbench-settings-grid">
          {[{ title: "主 DNS", servers: settings.nameserver }, { title: "备用 DNS", servers: settings.fallback }].map(({ title, servers }) => (
            <div key={title} className="grid min-w-0 gap-2 rounded-lg bg-[var(--workbench-row-hover)] p-3">
              <h4 className="text-[13px] font-medium">{title}</h4>
              <div className="grid gap-1 font-mono text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {servers.length ? servers.map((server, index) => <span key={index}>{server}</span>) : "未配置"}
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

    </>
  );
}

const launchSwitches = [
  { key: "autoStart", title: "登录自启动", help: "登录 Windows 时启动 ProcWeaver。" },
  { key: "silentStart", title: "静默启动", help: "启动后将窗口收起到托盘。" },
  { key: "autoRun", title: "自动运行核心", help: "打开 ProcWeaver 时启动代理核心。" },
  { key: "autoStartProcessRouting", title: "启动时开启进程分流", help: "启动后自动启用进程分流。" },
] as const;

const closeActions = [
  { id: "ask", label: "每次询问", description: "关闭主窗口时询问是否退出。" },
  { id: "minimize", label: "收起至托盘", description: "隐藏主窗口，后台继续运行。" },
  { id: "exit", label: "退出程序", description: "退出 ProcWeaver 并停止代理核心。" },
] as const;

const shimModes = [
  { id: "disabled", label: "仅主入口接管", description: "接管由 ProcWeaver 启动的目标程序。" },
  { id: "path", label: "PATH 垫片", description: "通过 PATH 垫片处理命令行启动的目标程序。" },
  { id: "ifeo", label: "IFEO 模式", description: "通过 Windows 镜像执行选项处理目标程序的启动。" },
] as const;

const BLUR_KEY = "procweaver_window_blur";

export function AppearanceSettings() {
  const [opacity, setOpacity] = useState(readWindowOpacity);
  const [blur, setBlur] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(BLUR_KEY));
      if (saved >= 8 && saved <= 48) return saved;
    } catch {}
    return 32;
  });

  const changeAppearance = (key: string, property: string, cssValue: string, storedValue = cssValue) => {
    document.documentElement.style.setProperty(property, cssValue);
    try { localStorage.setItem(key, storedValue); } catch {}
  };

  return (
    <SettingsSection title="窗口外观" tools={<span className="text-xs text-[var(--text-muted)]">即时生效</span>}>
      <div className="workbench-settings-grid workbench-settings-appearance">
        <SettingRange title="窗口不透明度" min={MIN_WINDOW_OPACITY} max={MAX_WINDOW_OPACITY} value={opacity} suffix="%"
          choices={[60, 90, DEFAULT_WINDOW_OPACITY]} onChange={(value) => {
            setOpacity(value);
            changeAppearance(WINDOW_OPACITY_KEY, "--window-opacity", (value / 100).toFixed(2));
          }} />
        <SettingRange title="背景模糊" min={8} max={48} value={blur} suffix="px" choices={[16, 32, 48]} onChange={(value) => {
          setBlur(value);
          changeAppearance(BLUR_KEY, "--window-blur", value + "px", String(value));
        }} />
      </div>
    </SettingsSection>
  );
}

export function AppPreferences({ settings, update }: { settings: GeneralSettings; update: UpdateGeneral }) {
  return (
    <>
      <SettingsSection title="启动">
        <div className="workbench-settings-grid">
          {launchSwitches.map(({ key, title, help }) => (
            <SettingSwitch key={key} title={title} help={help} checked={settings[key]} onChange={(checked) => update(key, checked)} />
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="主窗口行为">
        <SettingOptions<GeneralSettings["closeAction"]> label="关闭按钮" options={closeActions} value={settings.closeAction}
          onChange={(value) => update("closeAction", value)} />
      </SettingsSection>
      <SettingsSection title="进程启动方式">
        <SettingOptions<GeneralSettings["shimMode"]> label="启动接管" options={shimModes} value={settings.shimMode}
          onChange={(value) => update("shimMode", value)} />
      </SettingsSection>
    </>
  );
}
