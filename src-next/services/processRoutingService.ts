// ==========================================================================
// ProcWeaver src-next 进程分流与业务规则包服务网关
// 规范溯源: rust-pro (routing_overrides IPC) / AGENTS.md 业务规则包规范
// 对接指令: get_routing_overrides, save_routing_overrides, get_process_tree,
//           choose_routing_executable, get_business_bundles, save_business_bundles
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import { saveGeneralSettings } from "./settingsService";
import type { LaunchOutcome } from "../../src/api/bundleTools";
import type { RoutingTarget } from "../../src/types/routingOverrides";
import type { BundleLocalInstance, BundleProcessMember } from "../../src/types/businessBundle";
import type { RepositoryPackage } from "../../src/types/bundleRepository";
import {
  ProcessBundleItem,
  ProcessRuleItem,
  LiveProcessItem,
  ProcessCaptureEvidence,
  ProcessRoutingState,
  ProcessTrafficDriver,
  usesExistingBundleRules,
} from "../types/processRouting";

// LocalStorage 缓存持久化 Key
const STORAGE_BUNDLES_KEY = "procweaver_business_bundles_v2";
const STORAGE_RULES_KEY = "procweaver_process_rules_v2";
const STORAGE_STATE_KEY = "procweaver_process_routing_state";
const ANTIGRAVITY_CLOUDCODE_DOMAIN = "daily-cloudcode-pa.googleapis.com";
const LEGACY_ANTIGRAVITY_DOMAINS = ["google.com", "*.google.com", "cursor.sh", "*.cursor.sh"];

function bundleDomains(id: string, exe: string, domains: string[]): string[] {
  if (id === "antigravity-bundle" && exe.split(/[\\/]/).pop()?.toLowerCase() === "antigravity.exe"
      && domains.length === LEGACY_ANTIGRAVITY_DOMAINS.length
      && LEGACY_ANTIGRAVITY_DOMAINS.every((domain) => domains.includes(domain))) {
    return [...domains, ANTIGRAVITY_CLOUDCODE_DOMAIN];
  }
  return domains;
}

// ==========================================================================
// 默认自选进程规则
// ==========================================================================
const DEFAULT_RULES: ProcessRuleItem[] = [
  {
    id: "rule-chrome",
    enabled: true,
    label: "Google Chrome",
    matchKind: "process-name",
    matchValue: "chrome.exe",
    action: "proxy",
    targetProxy: "Proxy",
    includeDescendants: true,
    createdAt: "2026-11-06 10:00",
  },
  {
    id: "rule-git",
    enabled: true,
    label: "Git 版本控制客户端",
    matchKind: "process-name",
    matchValue: "git.exe",
    action: "proxy",
    targetProxy: "Auto - 自动低延迟优选",
    includeDescendants: true,
    createdAt: "2026-11-06 10:30",
  },
  {
    id: "rule-wechat",
    enabled: true,
    label: "微信桌面版 (国内直连)",
    matchKind: "process-name",
    matchValue: "WeChat.exe",
    action: "direct",
    includeDescendants: false,
    createdAt: "2026-11-06 11:00",
  },
];

const mockLiveProcesses: LiveProcessItem[] = [
  {
    pid: 4312,
    name: "chrome.exe",
    path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    isRouted: true,
    matchedRuleName: "Google Chrome",
    matchedProxy: "Proxy",
  },
  {
    pid: 7120,
    name: "WeChat.exe",
    path: "D:\\Tencent\\WeChat\\WeChat.exe",
    isRouted: true,
    matchedRuleName: "微信桌面版 (国内直连)",
    matchedProxy: "DIRECT 直连",
  },
  {
    pid: 19844,
    name: "spotify.exe",
    path: "C:\\Users\\Example\\AppData\\Roaming\\Spotify\\spotify.exe",
    isRouted: false,
  },
  {
    pid: 12048,
    name: "steam.exe",
    path: "D:\\Steam\\steam.exe",
    isRouted: false,
  },
  {
    pid: 23108,
    name: "node.exe",
    path: "C:\\Program Files\\nodejs\\node.exe",
    isRouted: false,
  },
];

// ==========================================================================
// 统计当前进程快照中匹配已启用规则的进程。
// ==========================================================================
export function calcMatchedProcessCount(overrides: any): number {
  if (!overrides?.config) return 0;
  const processEnabled = Boolean(overrides.config.processEnabled);
  const bundlesEnabled = Boolean(overrides.config.bundlesEnabled);
  if (!processEnabled && !bundlesEnabled) return 0;

  const entries: any[] = overrides.tracking?.entries || [];
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  const bundles: { id: string; enabled: boolean }[] = [...(overrides.config.bundles ?? [])]
    .sort((a, b) => b.id.length - a.id.length);
  const windows = typeof navigator !== "undefined" && navigator.platform.startsWith("Win");
  const pathKey = (value: string) => windows ? value.replace(/\//g, "\\").toLowerCase() : value;
  const activeRules = [
    ...(overrides.config.processRules ?? []),
    ...(overrides.tracking?.derived ?? []),
  ].filter((rule) => {
    if (!rule?.enabled || !rule.matchValue) return false;
    const id = String(rule.id).replace(/^derived:/, "");
    const owner = bundles.find((bundle) => id.startsWith("bundle-" + bundle.id + "-"));
    return owner ? bundlesEnabled && owner.enabled : processEnabled;
  });

  return entries.filter((entry) => entry && activeRules.some((rule) => {
    if (rule.matchKind === "process-path" || rule.matchKind === "path") {
      return entry.executablePath && pathKey(entry.executablePath) === pathKey(rule.matchValue);
    }
    return String(entry.name ?? "").toLowerCase() === String(rule.matchValue).toLowerCase();
  })).length;
}

// ==========================================================================
// 1. 获取全局进程分流总控状态与底层分流驱动
// ==========================================================================
export async function fetchProcessRoutingState({ strict = false }: { strict?: boolean } = {}): Promise<ProcessRoutingState> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [overrides, settings, activeDriver, isAdmin] = await Promise.all([
        invoke<any>("get_routing_overrides").catch(() => null),
        invoke<any>("get_general_settings").catch(() => null),
        invoke<string>("get_active_traffic_driver").catch(() => "app_proxy"),
        invoke<boolean>("check_is_admin").catch(() => false),
      ]);

      if (strict && !overrides?.config) throw new Error("进程分流状态不可用");
      let engineMode: ProcessRoutingState["engineMode"] = "app_proxy";
      if (
        settings?.trafficMode &&
        (settings.trafficMode === "user_mode" ||
          settings.trafficMode === "app_proxy" ||
          settings.trafficMode === "tun" ||
          settings.trafficMode === "windivert_v1")
      ) {
        engineMode = settings.trafficMode;
      }

      const matchedProcessCount = calcMatchedProcessCount(overrides);
      const driverActive =
        activeDriver === "windivert" ||
        (activeDriver === "user_mode" && matchedProcessCount > 0) ||
        activeDriver === "app_proxy" ||
        activeDriver === "tun";

      return {
        bundlesEnabled: overrides?.config?.bundlesEnabled ?? false,
        processEnabled: overrides?.config?.processEnabled ?? false,
        driverActive,
        engineMode,
        activeDriverName: activeDriver,
        isAdmin: Boolean(isAdmin),
        matchedProcessCount,
        totalBundleCount: (overrides?.config?.bundles || []).length,
        totalRuleCount: (overrides?.config?.processRules || []).length,
      };
    } catch (e) {
      if (strict) throw e;
      console.warn("[processRoutingService] fetchProcessRoutingState fallback", e);
    }
  }

  // 纯浏览器缓存读取
  try {
    const raw = localStorage.getItem(STORAGE_STATE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      return { ...cached, matchedProcessCount: cached.matchedProcessCount ?? cached.activeProcessCount ?? 0 };
    }
  } catch {}

  return {
    bundlesEnabled: false,
    processEnabled: false,
    driverActive: false,
    engineMode: "app_proxy",
    activeDriverName: "app_proxy",
    isAdmin: false,
    matchedProcessCount: 0,
    totalBundleCount: 0,
    totalRuleCount: DEFAULT_RULES.length,
  };
}

export async function fetchProcessRoutingEvidence(): Promise<{
  matchedProcessCount: number;
  activeDriverName: string;
  capture?: ProcessCaptureEvidence;
} | null> {
  if (!isTauriEnvironment()) return null;
  const overrides = await invokeCommand<any>("get_routing_overrides").catch(() => null);
  if (!overrides) return null;
  return {
    matchedProcessCount: calcMatchedProcessCount(overrides),
    activeDriverName: overrides.trafficDriver,
    capture: overrides.capture,
  };
}

export async function switchProcessDriver(
  driver: ProcessTrafficDriver,
  { rebuildRules = true }: { rebuildRules?: boolean } = {},
): Promise<ProcessRoutingState> {
  if (isTauriEnvironment()) {
    try {
      await saveGeneralSettings({
        trafficMode: driver,
        tunMode: false, // 严格遵循用户指令：进程分流不加 TUN
      });
      window.dispatchEvent(new Event("netbox-settings-saved"));
      window.dispatchEvent(new Event("netbox-route-changed"));

      // 兼容性切换沿用已应用的规则，由核心按新捕获方式重新加载。
      if (rebuildRules) await syncRoutingToCore();
    } catch (e) {
      console.warn("[processRoutingService] switchProcessDriver failed:", e);
      throw e;
    }
  }
  return fetchProcessRoutingState();
}

export async function elevateAdmin(): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("restart_elevated");
  }
}

export interface EntryStatusItem {
  instanceId: string;
  state: string;
  message: string;
  identityState?: string;
  identityMessage?: string;
  connectionState?: string;
  connectionMessage?: string;
  verifiedOutlet?: string | null;
  hookTier?: string | null;
  hookTierReason?: string | null;
}

export async function launchBundleApp(instanceId: string, confirmation?: string | null): Promise<LaunchOutcome> {
  if (isTauriEnvironment()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LaunchOutcome>("launch_bundle_app", {
      request: { instanceId, shortcutId: null, direct: true },
      confirmation: confirmation || null,
      prepareOnly: false,
    });
  }
  return { state: "launched", message: "仿真环境：已受控启动", confirmation: null, entry: "", processCount: 1 };
}

export async function fetchEntryStates(instanceIds: string[]): Promise<EntryStatusItem[]> {
  if (!instanceIds.length || !isTauriEnvironment()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<EntryStatusItem[]>("get_bundle_entry_states", { instanceIds });
  } catch {
    return [];
  }
}

// ==========================================================================
// 1.5 核心引擎：将业务规则包与自定进程规则编译并同步到 Rust 底层驱动与 Mihomo 内核
// 规范溯源: rust-pro / AGENTS.md 业务规则包规范 / WinDivert plan
// ==========================================================================

// 将业务包 ID 编码为 Mihomo 策略组名称 (例如 PW-{hex}-main)
export function toBundleGroupName(bundleId: string, slot = "main"): string {
  const hex = Array.from(new TextEncoder().encode(bundleId))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `PW-${hex}-${slot}`;
}

function resolveRoutingTarget(view: any, targetName?: string): RoutingTarget | null {
  const targets: RoutingTarget[] = Array.isArray(view.targets) ? view.targets : [];
  const name = targetName?.trim();
  if (!name || !targets.length || name.startsWith("PW-") || name.startsWith("本地方案")) return null;
  const exact = targets.find((target) => target.name === targetName)
    ?? targets.find((target) => target.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  if (["DIRECT", "全球直连", "DIRECT (局域网/国内直连)", "DIRECT 直连"].includes(name.toUpperCase())) {
    return targets.find((target) => target.name.toUpperCase() === "DIRECT" || target.name === "全球直连")
      ?? { profileId: targets[0].profileId, kind: "group", name: "DIRECT" };
  }
  return null;
}

interface BundleActivation {
  bundleId: string;
  enableRouting: boolean;
}

export async function syncRoutingToCore(
  targetBundles?: ProcessBundleItem[],
  targetRules?: ProcessRuleItem[],
  activation?: BundleActivation,
): Promise<void> {
  if (!isTauriEnvironment()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const view = await invoke<any>("get_routing_overrides");
    if (!view?.config) {
      if (activation) throw new Error("无法读取当前分流配置");
      return;
    }

    // 1. 取得数据源
    const currentBundles = targetBundles || (await fetchBundles());
    const currentRules = targetRules || (await fetchProcessRules());

    const resolveTarget = (name?: string) => resolveRoutingTarget(view, name);

    // 2. 编译业务规则包为 BundleRoute 与 第一优先级 ProcessRule (第 0 优先级)
    const compiledBundles: any[] = [];
    const bundleProcessRules: any[] = [];
    const previousBundles = view.config.bundles || [];

    for (const b of currentBundles) {
      const prev = previousBundles.find((p: any) => p.id === b.id);
      const useExistingRules = usesExistingBundleRules(b);
      const selectedTarget = resolveTarget(b.targetProxy);
      const saved = b.targetIdentity?.name === b.targetProxy
        ? b.targetIdentity
        : prev?.mainTarget?.name === b.targetProxy ? prev.mainTarget : undefined;
      if (activation?.bundleId === b.id) {
        if (!selectedTarget || (saved && (saved.profileId !== selectedTarget.profileId
          || saved.kind !== selectedTarget.kind || saved.name !== selectedTarget.name))) {
          throw new Error("所绑定的出口已不可用，请重新绑定当前订阅的节点或策略组");
        }
      }
      const mainTarget = saved ?? selectedTarget;

      compiledBundles.push({
        id: b.id,
        name: b.name,
        mainExe: b.mainExe || b.exes[0] || "",
        enabled: b.enabled,
        mainTarget: b.enabled ? mainTarget : null,
        dnsTarget: b.enabled && !useExistingRules ? mainTarget : null,
        port: prev?.port || 0,
        mode: b.mode || "strict",
        domains: Array.isArray(b.domains) ? b.domains : [],
        fallback: b.fallback || "rules",
        policy: {
          proxyTcp: b.policy?.proxyTcp ?? true,
          blockIpv6: b.policy?.blockIpv6 ?? true,
          blockUdp: b.policy?.blockUdp ?? true,
          proxyUdp: b.policy?.proxyUdp ?? false,
          proxySubprocesses: b.policy?.proxySubprocesses ?? true,
          bypassLan: b.policy?.bypassLan ?? true,
          dnsMode: b.policy?.dnsMode || "safe_pure",
          portFilterMode: b.policy?.portFilterMode || "all",
          customPorts: b.policy?.customPorts || "",
          targetFilterMode: b.policy?.targetFilterMode || "all",
          targetRules: Array.isArray(b.policy?.targetRules) ? b.policy.targetRules : [],
          disallowProxyArgs: b.policy?.disallowProxyArgs ?? false,
          staleConnectionStrategy: b.policy?.staleConnectionStrategy || "prompt",
          useExistingRules: b.policy?.useExistingRules === true,
        },
      });
    }

    // 3. 提前收集手动自定单进程规则 (去重保留首条有效规则)

    const seenRootKeys = new Set<string>();
    const previousRules = new Map<string, RoutingTarget>((view.config.processRules || [])
      .filter((rule: any) => rule.target)
      .map((rule: any) => [rule.id, rule.target]));
    const manualRules = currentRules
      .filter((r) => !r.id.startsWith("bundle-"))
      .map((r) => {
        const previous = previousRules.get(r.id);
        const target = resolveTarget(r.targetProxy) ?? (previous?.name === r.targetProxy ? previous : null);
        return {
          id: r.id,
          enabled: r.enabled,
          label: r.label,
          matchKind: r.matchKind === "process-path" ? "path" : "name",
          matchValue: r.matchValue,
          action: r.action,
          target: r.action === "proxy" ? target : null,
          includeDescendants: r.includeDescendants,
          ruleMode: (r as any).ruleMode === "inherit" ? "inherit" : "strict",
        };
      })
      .filter((r) => {
        if (!r.enabled) return true;
        const key = `${r.matchKind}:${r.matchValue.trim().toLowerCase()}`;
        if (seenRootKeys.has(key)) return false;
        seenRootKeys.add(key);
        return true;
      });

    // 重新按启用业务包展开不与显式手动规则或已占用根冲突的进程规则 (第 0 优先级)
    const manualActiveKeys = new Set<string>(
      manualRules
        .filter((r) => r.enabled)
        .map((r) => `${r.matchKind}:${r.matchValue.trim().toLowerCase()}`)
    );
    const bundleSeenKeys = new Set<string>();
    for (const b of compiledBundles) {
      if (!b.enabled) continue;
      const srcBundle = currentBundles.find((item) => item.id === b.id);
      if (!srcBundle) continue;
      const uniqueExes = Array.from(new Set(srcBundle.exes.map((e) => e.trim()).filter(Boolean)));
      for (const exe of uniqueExes) {
        const key = `name:${exe.toLowerCase()}`;
        // 若用户显式添加了同名手动规则，或共有 exe 已被先启用的套件占用，则跳过重复项防止 WinDivert plan.rs 根冲突报错
        if (manualActiveKeys.has(key) || bundleSeenKeys.has(key)) continue;
        bundleSeenKeys.add(key);
        const cleanId = exe.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        bundleProcessRules.push({
          id: `bundle-${b.id}-${cleanId}`,
          enabled: true,
          label: `${b.name} - ${exe}`,
          matchKind: "name",
          matchValue: exe,
          action: "proxy",
          target: b.mainTarget,
          includeDescendants: b.policy?.proxySubprocesses ?? true,
          ruleMode: b.mode === "strict" ? "strict" : "inherit",
        });
      }
    }

    // 4. 业务包规则与用户自定进程规则合并（已确保无重复启用根）
    const allProcessRules = [...bundleProcessRules, ...manualRules];

    // 5. 组装合规的 RoutingOverrides 配置
    const currentProcessEnabled = view.config.processEnabled ?? false;
    const currentBundlesEnabled = view.config.bundlesEnabled ?? false;

    // 尊重总控意图：严禁因列表内存在单项规则而在保存时强行把用户已暂停的总控开关重新打开
    const shouldEnableBundles = currentBundlesEnabled || Boolean(activation?.enableRouting);
    const shouldEnableProcess = currentProcessEnabled || Boolean(activation?.enableRouting);

    const nextConfig = {
      ...view.config,
      processEnabled: shouldEnableProcess,
      bundlesEnabled: shouldEnableBundles,
      processRules: allProcessRules,
      bundles: compiledBundles,
    };

    // 核心修复：按规范传空数组，杜绝已退出进程导致后端校验失败
    const selections: any[] = [];

    // 调用 save_routing_overrides 触发 Rust 端 WinDivert / Hook 驱动重装载与 Mihomo 内核重载
    await invoke("save_routing_overrides", { config: nextConfig, selections });

    // 6. 双向实时联动 Mihomo 内核策略组：确保运行时内存指针立即指向目标节点
    for (const b of compiledBundles) {
      const saved = b.mainTarget as RoutingTarget | null;
      const current = resolveTarget(saved?.name);
      if (b.enabled && saved && current?.profileId === saved.profileId && current.kind === saved.kind) {
        const group = toBundleGroupName(b.id, "main");
        try {
          await invoke("switch_mihomo_proxy", { group, proxy: saved.name });
        } catch (switchErr) {
          console.warn(`[processRoutingService] switch_mihomo_proxy for ${group} warning:`, switchErr);
        }
      }
    }

    // 广播全网路由变更通知
    window.dispatchEvent(new Event("netbox-route-changed"));
  } catch (err: any) {
    console.error("[processRoutingService] syncRoutingToCore failed:", err);
    throw new Error(typeof err === "string" ? err : err?.message || "底层分流配置下发失败");
  }
}

export async function saveProcessRoutingState(state: ProcessRoutingState): Promise<void> {
  localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(state));
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const view = await invoke<any>("get_routing_overrides");
      if (view?.config) {
        const nextConfig = {
          ...view.config,
          bundlesEnabled: state.processEnabled,
          processEnabled: state.processEnabled,
        };
        // 核心修复：严禁传递易失效的动态接管进程列表，杜绝已退出进程导致后端校验失败拒绝保存
        const selections: any[] = [];

        await invoke("save_routing_overrides", { config: nextConfig, selections });
        window.dispatchEvent(
          new CustomEvent("netbox-process-master-changed", { detail: state.processEnabled })
        );
        window.dispatchEvent(new Event("netbox-route-changed"));
      } else {
        throw new Error("当前进程分流配置不可用");
      }
    } catch (err: any) {
      console.warn("[processRoutingService] saveProcessRoutingState failed:", err);
      throw new Error(typeof err === "string" ? err : err?.message || "进程分流总控落盘失败");
    }
  }
}

// ==========================================================================
// 2. 业务规则包 CRUD 管理 (对接 Rust: get_business_bundles, save_business_bundles)
// ==========================================================================
function decodeBundleInstance(inst: any): ProcessBundleItem {
  const def = inst.definition || {};
  const policy = inst.policy || def.policy || {};
  const members: BundleProcessMember[] = Array.isArray(def.processes) ? def.processes : [];
  const extraExes: string[] = Array.isArray(def.additionalExes) ? def.additionalExes : [];
  const exes = [...new Set([...members.map((member) => member.exe), ...extraExes].filter(Boolean))];
  const mode = (inst.mode || def.mode || "strict") as any;
  const fallback = (inst.fallback || def.fallback || "rules") as any;
  const domains = Array.isArray(def.domains) ? def.domains : Array.isArray(inst.domains) ? inst.domains : [];

  const savedTarget = inst.slotTargets?.main;
  let rawTarget = savedTarget?.name || inst.slotBindings?.main || "";
  if (rawTarget.startsWith("PW-") || rawTarget.startsWith("本地方案")) {
    rawTarget = "";
  }

  return {
    id: inst.instanceId,
    packageId: def.packageId,
    repositoryOrigin: inst.repositoryOrigin,
    name: def.packageName || "未命名业务包",
    description: def.description || "",
    icon: def.icon || "📦",
    mainExe: members.find((member) => member.role === "main")?.exe || exes[0] || "",
    exes,
    enabled: Boolean(inst.enabled) && (mode !== "sandbox" || policy.useExistingRules !== true || Boolean(rawTarget.trim())),
    targetProxy: rawTarget,
    targetIdentity: rawTarget && savedTarget?.profileId
      && (savedTarget.kind === "node" || savedTarget.kind === "group") ? savedTarget : undefined,
    mode: mode === "sandbox" ? "sandbox" : "strict",
    fallback: fallback === "system" || fallback === "direct" ? fallback : "rules",
    domains: bundleDomains(inst.instanceId, exes[0] || "", domains),
    policy: {
      proxyTcp: policy.proxyTcp ?? true,
      blockIpv6: policy.blockIpv6 ?? true,
      blockUdp: policy.blockUdp ?? true,
      proxyUdp: policy.proxyUdp ?? false,
      proxySubprocesses: policy.proxySubprocesses ?? true,
      bypassLan: policy.bypassLan ?? true,
      dnsMode:
        policy.dnsMode === "fake_ip"
          ? "fake_ip"
          : policy.dnsMode === "system_native" || policy.dnsMode === "system"
          ? "system_native"
          : "safe_pure",
      portFilterMode: policy.portFilterMode || "all",
      customPorts: policy.customPorts || "",
      targetFilterMode: policy.targetFilterMode || "all",
      targetRules: Array.isArray(policy.targetRules) ? policy.targetRules : [],
      disallowProxyArgs: Boolean(policy.disallowProxyArgs),
      useExistingRules: policy.useExistingRules === true,
      staleConnectionStrategy:
        policy.staleConnectionStrategy === "auto_reset" || policy.staleConnectionStrategy === "auto_close"
          ? "auto_reset"
          : policy.staleConnectionStrategy === "ignore" || policy.staleConnectionStrategy === "keep"
          ? "ignore"
          : "prompt",
    },
    updatedAt: inst.updatedAt ? new Date(inst.updatedAt).toLocaleDateString() : undefined,
  };
}

function readCachedBundles(): ProcessBundleItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_BUNDLES_KEY);
    if (raw) {
      const bundles: ProcessBundleItem[] = JSON.parse(raw);
      return bundles.map((bundle) => ({
        ...bundle,
        enabled: bundle.enabled && (!usesExistingBundleRules(bundle) || Boolean(bundle.targetProxy?.trim())),
        domains: bundleDomains(bundle.id, bundle.mainExe, bundle.domains ?? []),
      }));
    }
  } catch {}

  return [];
}

export async function fetchBundles({ strict = false }: { strict?: boolean } = {}): Promise<ProcessBundleItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<any[] | null>("get_business_bundles");
      // 核心修复：只要后端返回了合规数组定义（包括空数组 []），直接采纳，严禁自动回退默认包
      if (Array.isArray(list)) {
        return list.map(decodeBundleInstance);
      }
      // 尚无后端文件时，读取旧版保存过的本地业务包。
      if (strict && list !== null) throw new Error("业务规则包列表不可用");
    } catch (e) {
      if (strict) throw e;
      console.warn("[processRoutingService] get_business_bundles failed:", e);
    }
  }

  return readCachedBundles();
}

type BundleSaveIntent = { draftId: string } | { activation: BundleActivation };

function serializeBundle(b: ProcessBundleItem, inst?: any) {
  const prevDef = inst?.definition || {};
  const prevProcesses = Array.isArray(prevDef.processes) ? prevDef.processes : [];

  // 构造合规的 processes 数组
  const nextProcesses = b.exes.map((exe) => {
    const found = prevProcesses.find(
      (p: any) => p.exe?.toLowerCase() === exe.toLowerCase()
    );
    return (
      found || {
        exe,
        role: exe.toLowerCase() === b.mainExe.toLowerCase() ? "main" : "worker",
        description: "自定进程成员",
        includeDescendants: b.policy.proxySubprocesses,
      }
    );
  });

  const cleanTarget = (b.targetProxy && !b.targetProxy.startsWith("PW-") && !b.targetProxy.startsWith("本地方案")) ? b.targetProxy : "";
  const savedTarget = b.targetIdentity?.name === cleanTarget
    ? b.targetIdentity : { kind: "node", name: cleanTarget };
  const slotTarget = cleanTarget ? savedTarget : null;

  if (inst) {
    // 更新已有实例定义与出口插槽
    return {
      ...inst,
      enabled: b.enabled,
      mode: b.mode,
      fallback: b.fallback,
      domains: b.domains,
      slotBindings: {
        ...inst.slotBindings,
        main: cleanTarget || null,
      },
      slotTargets: {
        ...inst.slotTargets,
        main: slotTarget,
      },
      definition: {
        ...prevDef,
        packageName: b.name,
        description: b.description,
        mode: b.mode,
        fallback: b.fallback,
        domains: b.domains,
        processes: nextProcesses,
        additionalExes: b.exes,
        policy: { ...b.policy },
      },
      policy: {
        ...(inst.policy || prevDef.policy || {}),
        ...b.policy,
      },
      isModified: true,
      updatedAt: Date.now(),
    };
  } else {
    // 新增自定义套件定义
    return {
      instanceId: b.id,
      ...(b.repositoryOrigin ? { repositoryOrigin: b.repositoryOrigin } : {}),
      enabled: b.enabled,
      mode: b.mode,
      fallback: b.fallback,
      domains: b.domains,
      slotBindings: {
        main: cleanTarget || null,
      },
      slotTargets: {
        main: slotTarget,
      },
      definition: {
        packageId: b.packageId || b.id,
        packageName: b.name,
        description: b.description,
        version: "1.0.0",
        author: "User Custom",
        mode: b.mode,
        fallback: b.fallback,
        domains: b.domains,
        processes: nextProcesses,
        slots: [
          {
            slotId: "main",
            label: "核心出口插槽",
            description: "主出站代理",
          },
        ],
        policy: { ...b.policy },
      },
      policy: { ...b.policy },
      isModified: true,
      updatedAt: Date.now(),
    };
  }
}

export async function saveBundles(bundles: ProcessBundleItem[], intent?: BundleSaveIntent): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rawInstances = await invoke<any[] | null>("get_business_bundles");
      const instances = Array.isArray(rawInstances) ? rawInstances : [];
      const existingMap = new Map(instances.map((inst) => [inst.instanceId, inst]));

      // 核心修复：以当前前台传入的 bundles 为唯一真理源进行映射构造
      // 凡是不在 bundles 中的项已被用户彻底物理删除，绝不再塞回 nextInstances
      const draftId = intent && "draftId" in intent ? intent.draftId : undefined;
      const activation = intent && "activation" in intent ? intent.activation : undefined;
      const changedId = draftId ?? activation?.bundleId;
      const changedBundle = changedId ? bundles.find((bundle) => bundle.id === changedId) : undefined;
      let nextInstances;
      if (Array.isArray(rawInstances) && changedBundle) {
        const instance = serializeBundle(changedBundle, existingMap.get(changedId));
        nextInstances = existingMap.has(changedId)
          ? instances.map((saved) => saved.instanceId === changedId ? instance : saved)
          : [...instances, instance];
      } else {
        nextInstances = bundles.map((bundle) => serializeBundle(bundle, existingMap.get(bundle.id)));
      }
      await invoke("save_business_bundles", { instances: nextInstances });
      if (!draftId) {
        try {
          await syncRoutingToCore(bundles, undefined, activation);
        } catch (error) {
          if (activation) {
            try {
              const previous = existingMap.get(activation.bundleId);
              const saved = nextInstances.find((instance) => instance.instanceId === activation.bundleId);
              const latest = await invoke<any[]>("get_business_bundles");
              if (!latest?.some((instance) => instance.instanceId === activation.bundleId
                && instance.updatedAt === saved?.updatedAt)) {
                throw new Error("业务包已被其他操作改变");
              }
              await invoke("save_business_bundles", {
                instances: previous
                  ? latest.map((instance) => instance.instanceId === activation.bundleId ? previous : instance)
                  : latest.filter((instance) => instance.instanceId !== activation.bundleId),
              });
            } catch (restore) {
              throw new Error(`${error}。恢复业务包原配置失败，${restore}`);
            }
          }
          throw error;
        }
      }
      window.dispatchEvent(new Event("netbox-route-changed"));
      window.dispatchEvent(new Event("procweaver-route-changed"));
    } catch (e: any) {
      console.warn("[processRoutingService] save_business_bundles failed:", e);
      throw new Error(typeof e === "string" ? e : e?.message || "业务规则包实例持久化失败");
    }

  }
  localStorage.setItem(STORAGE_BUNDLES_KEY, JSON.stringify(bundles));
}

export async function createBundle(
  newBundle: Omit<ProcessBundleItem, "id" | "updatedAt">
): Promise<ProcessBundleItem[]> {
  const current = await fetchBundles();
  const id = `bundle_custom_${Date.now()}`;
  const fullBundle: ProcessBundleItem = {
    ...newBundle,
    id,
    updatedAt: new Date().toLocaleDateString(),
  };
  const next = [...current, fullBundle];
  const intent = fullBundle.enabled && usesExistingBundleRules(fullBundle)
    ? { activation: { bundleId: id, enableRouting: false } } : undefined;
  await saveBundles(next, intent);
  return next;
}

export async function updateBundleInstance(
  bundleId: string,
  updates: Partial<ProcessBundleItem>,
  options: { enableRouting?: boolean } = {},
): Promise<ProcessBundleItem[]> {
  const current = await fetchBundles();
  const previous = current.find((bundle) => bundle.id === bundleId);
  if (!previous) throw new Error("业务包已不存在");
  const updated = { ...previous, ...updates };
  const useExistingRules = usesExistingBundleRules(updated);
  const applyingActiveMode = updated.enabled && (!previous.enabled || useExistingRules !== usesExistingBundleRules(previous));
  if (updated.enabled && !updated.targetProxy.trim()) throw new Error("请先绑定出口");
  const bindingChanged = updates.targetProxy !== undefined;
  if (bindingChanged) {
    updated.targetIdentity = undefined;
    if (updated.targetProxy && isTauriEnvironment()) {
      const view = await invokeCommand<any>("get_routing_overrides");
      const target = view && resolveRoutingTarget(view, updated.targetProxy);
      if (!target) throw new Error("所选出口已不可用，请重新选择");
      updated.targetProxy = target.name;
      updated.targetIdentity = target;
    }
  }
  const next = current.map((b) => b.id === bundleId ? updated : b);
  const intent = applyingActiveMode
    ? { activation: { bundleId, enableRouting: options.enableRouting ?? false } }
    : bindingChanged && !previous.enabled && !updated.enabled ? { draftId: bundleId } : undefined;
  await saveBundles(next, intent);
  return next;
}

export async function deleteBundle(bundleId: string): Promise<ProcessBundleItem[]> {
  if (isTauriEnvironment()) {
    const stored = await invokeCommand<any[] | null>("get_business_bundles");
    const initialInstances = stored === null
      ? readCachedBundles().map((bundle) => serializeBundle(bundle))
      : null;
    const remaining = await invokeCommand<any[]>("delete_business_bundle", { instanceId: bundleId, initialInstances });
    const next = remaining.map(decodeBundleInstance);
    try {
      localStorage.setItem(STORAGE_BUNDLES_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn("[processRoutingService] 更新本地业务包缓存失败", error);
    }
    window.dispatchEvent(new Event("netbox-route-changed"));
    window.dispatchEvent(new Event("procweaver-route-changed"));
    return next;
  }

  const next = readCachedBundles().filter((bundle) => bundle.id !== bundleId);
  localStorage.setItem(STORAGE_BUNDLES_KEY, JSON.stringify(next));
  return next;
}

// ==========================================================================
// 3. 自定义单进程规则 CRUD 管理 (对接 Rust: get_routing_overrides, save_routing_overrides)
// ==========================================================================
export async function fetchProcessRules(): Promise<ProcessRuleItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const view = await invoke<any>("get_routing_overrides");
      if (view?.config?.processRules && Array.isArray(view.config.processRules)) {
        // 严格分流：仅读取纯手动进程规则，排除以 bundle- 开头的业务套件规则
        return view.config.processRules
          .filter((r: any) => !r.id.startsWith("bundle-"))
          .map((r: any) => ({
            id: r.id,
            enabled: Boolean(r.enabled),
            label: r.label || r.matchValue,
            matchKind: (r.matchKind === "path" ? "process-path" : "process-name") as any,
            matchValue: r.matchValue,
            action: r.action || "proxy",
            targetProxy: r.target?.name || "Proxy",
            includeDescendants: Boolean(r.includeDescendants),
            ruleMode: r.ruleMode === "inherit" ? "inherit" : "strict",
          }));
      }
    } catch (e) {
      console.warn("[processRoutingService] get_routing_overrides failed:", e);
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_RULES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  return DEFAULT_RULES;
}

export async function saveProcessRules(rules: ProcessRuleItem[]): Promise<void> {
  localStorage.setItem(STORAGE_RULES_KEY, JSON.stringify(rules));
  if (isTauriEnvironment()) {
    // 核心修复：通过底层编译引擎统筹同步，保留业务套件第 0 优先级，杜绝规则覆盖互冲
    await syncRoutingToCore(undefined, rules);
  }
}

export async function addProcessRule(
  rule: Omit<ProcessRuleItem, "id" | "createdAt">
): Promise<ProcessRuleItem[]> {
  const current = await fetchProcessRules();
  const newRule: ProcessRuleItem = {
    ...rule,
    id: `rule-${Date.now()}`,
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  };
  const next = [newRule, ...current];
  await saveProcessRules(next);
  return next;
}

export async function updateProcessRule(
  id: string,
  updates: Partial<ProcessRuleItem>
): Promise<ProcessRuleItem[]> {
  const current = await fetchProcessRules();
  const next = current.map((r) => (r.id === id ? { ...r, ...updates } : r));
  await saveProcessRules(next);
  return next;
}

export async function deleteProcessRule(id: string): Promise<ProcessRuleItem[]> {
  const current = await fetchProcessRules();
  const next = current.filter((r) => r.id !== id);
  await saveProcessRules(next);
  return next;
}

// ==========================================================================
// 3. 业务规则包安全脱敏导出与防攻击导入 (.pwpack.json B05 规范)
// ==========================================================================

export interface ExportablePwPack {
  formatVersion: "1.0";
  exportedAt: string;
  bundle: {
    packageId: string;
    packageName: string;
    packageVersion: string;
    description: string;
    mode?: "strict" | "sandbox";
    fallback?: "rules" | "system" | "direct";
    domains?: string[];
    mainExe: string;
    exes: string[];
    policy?: any;
  };
}

/**
 * 严格白名单脱敏导出：绝不携带本机节点名、订阅、端口或运行实例凭据
 */
export function exportBundleToPwPack(bundle: ProcessBundleItem): void {
  const exportData: ExportablePwPack = {
    formatVersion: "1.0",
    exportedAt: new Date().toISOString(),
    bundle: {
      packageId: bundle.packageId || bundle.id || `bundle-${Date.now().toString(36)}`,
      packageName: bundle.name,
      packageVersion: "v1.0",
      description: bundle.description || "",
      mode: bundle.mode || "strict",
      fallback: bundle.fallback || "rules",
      domains: Array.isArray(bundle.domains) ? [...bundle.domains] : [],
      mainExe: bundle.mainExe,
      exes: [...bundle.exes],
      policy: bundle.policy ? { ...bundle.policy } : undefined,
    },
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeFilename = `${bundle.name.replace(/[/\\:*?"<>|]/g, "_")}.pwpack.json`;
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 校验并解析外部传入的 .pwpack.json 规则包
 */
export function validateAndParsePwPack(jsonString: string): {
  valid: boolean;
  error?: string;
  bundle?: ProcessBundleItem;
} {
  try {
    if (!jsonString || typeof jsonString !== "string") {
      return { valid: false, error: "导入内容为空" };
    }
    if (jsonString.length > 5 * 1024 * 1024) {
      return { valid: false, error: "规则包文件超过 5MB 安全上限" };
    }
    const data = JSON.parse(jsonString);
    const b = data.bundle || data;

    if (!b.packageName && !b.name) {
      return { valid: false, error: "缺少规则包名称 (packageName)" };
    }
    const name = String(b.packageName || b.name).trim();

    // 提取进程名单
    const rawExes: string[] = [];
    if (Array.isArray(b.exes)) {
      rawExes.push(...b.exes);
    } else if (Array.isArray(b.processes)) {
      for (const p of b.processes) {
        const exe = typeof p === "string" ? p : p?.exe;
        if (exe) rawExes.push(exe);
      }
    }
    if (rawExes.length === 0) {
      return { valid: false, error: "规则包中必须至少包含一个可执行进程" };
    }

    // 严格清洗进程名 (防路径穿越、防纯数字)
    const cleanExes: string[] = [];
    for (const exe of rawExes) {
      const clean = String(exe).trim();
      if (!clean) continue;
      if (clean.includes("/") || clean.includes("\\") || clean.includes("..")) {
        return { valid: false, error: `检测到不安全的进程路径字符: ${clean}` };
      }
      if (/^\d+$/.test(clean)) {
        return { valid: false, error: `进程名称无效（不能为纯数字）: ${clean}` };
      }
      if (!cleanExes.includes(clean)) {
        cleanExes.push(clean);
      }
    }

    if (cleanExes.length === 0) {
      return { valid: false, error: "未提取到有效的可执行进程定义" };
    }

    const mainExe = b.mainExe && cleanExes.includes(b.mainExe) ? b.mainExe : cleanExes[0];

    const newBundle: ProcessBundleItem = {
      id: `bundle-${Date.now().toString(36)}`,
      name,
      description: b.description || "导入的规则包",
      mainExe,
      exes: cleanExes,
      enabled: false,
      targetProxy: "",
      mode: b.mode === "sandbox" ? "sandbox" : "strict",
      fallback: b.fallback === "system" || b.fallback === "direct" ? b.fallback : "rules",
      domains: Array.isArray(b.domains) ? b.domains : [],
      policy: {
        proxyTcp: b.policy?.proxyTcp ?? true,
        blockIpv6: b.policy?.blockIpv6 ?? true,
        blockUdp: b.policy?.blockUdp ?? true,
        proxyUdp: b.policy?.proxyUdp ?? false,
        proxySubprocesses: b.policy?.proxySubprocesses ?? true,
        bypassLan: b.policy?.bypassLan ?? true,
        dnsMode: b.policy?.dnsMode ?? "safe_pure",
        portFilterMode: b.policy?.portFilterMode ?? "all",
        customPorts: b.policy?.customPorts ?? "",
        targetFilterMode: b.policy?.targetFilterMode ?? "all",
        targetRules: Array.isArray(b.policy?.targetRules) ? b.policy.targetRules : [],
        disallowProxyArgs: Boolean(b.policy?.disallowProxyArgs),
        staleConnectionStrategy: b.policy?.staleConnectionStrategy ?? "prompt",
        useExistingRules: b.policy?.useExistingRules === true,
      },
      updatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    };

    return { valid: true, bundle: newBundle };
  } catch (err: any) {
    return { valid: false, error: `规则包 JSON 解析失败: ${err.message || err}` };
  }
}

/**
 * 将解析合法的业务规则包持久化导入到本地列表中
 */
export async function importBundleItem(bundle: ProcessBundleItem): Promise<ProcessBundleItem[]> {
  const current = await fetchBundles();
  // 避免重名覆盖：若重名则自动附带 (导入) 标识
  let finalName = bundle.name;
  if (current.some((b) => b.name === finalName)) {
    finalName = `${finalName} (导入)`;
  }
  const nextBundle: ProcessBundleItem = {
    ...bundle,
    name: finalName,
    id: `bundle-imported-${Date.now()}`,
    enabled: false,
    targetProxy: "",
    targetIdentity: undefined,
  };
  const next = [...current, nextBundle];
  await saveBundles(next, { draftId: nextBundle.id });
  return next;
}

export function isRepositoryPackageMounted(
  bundles: readonly Pick<ProcessBundleItem, "packageId" | "repositoryOrigin">[],
  item: RepositoryPackage,
): boolean {
  return bundles.some((bundle) => bundle.packageId === item.definition.packageId
    && bundle.repositoryOrigin?.repositoryKey === item.origin.repositoryKey);
}

export async function mountRepositoryPackage(item: RepositoryPackage): Promise<ProcessBundleItem[]> {
  if (!item.definition.processes.length) throw new Error("规则包缺少桌面进程定义");
  const instanceId = `repo-${crypto.randomUUID()}`;
  if (isTauriEnvironment()) {
    const instances = await invokeCommand<BundleLocalInstance[]>("mount_repository_business_bundle", {
      instanceId,
      definition: item.definition,
      origin: item.origin,
      initialInstances: readCachedBundles().map((bundle) => serializeBundle(bundle)),
    });
    window.dispatchEvent(new Event("netbox-route-changed"));
    window.dispatchEvent(new Event("procweaver-route-changed"));
    return instances.map(decodeBundleInstance);
  }

  const current = readCachedBundles();
  if (isRepositoryPackageMounted(current, item)) return current;
  const bundle = decodeBundleInstance({ instanceId, definition: item.definition, enabled: false, repositoryOrigin: item.origin, updatedAt: Date.now() });
  const next = [...current, bundle];
  await saveBundles(next, { draftId: instanceId });
  return next;
}

// ==========================================================================
// 4. 实时活跃联网进程嗅探与原生程序浏览 (对接 Rust: get_process_tree, choose_routing_executable)
// ==========================================================================
export async function fetchLiveProcesses(): Promise<LiveProcessItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [entries, currentRules, bundles] = await Promise.all([
        invoke<any[]>("get_process_tree").catch(() => []),
        fetchProcessRules().catch(() => []),
        fetchBundles().catch(() => []),
      ]);

      if (Array.isArray(entries) && entries.length > 0) {
        return entries.map((entry) => {
          const exeName = (entry.name || "").toLowerCase();
          const exePath = (entry.executablePath || "").toLowerCase();

          // 检查是否命中自定义规则
          const matchedRule = currentRules.find((r) => {
            if (!r.enabled) return false;
            if (r.matchKind === "process-path") {
              return exePath !== "" && exePath.replace(/\//g, "\\") === r.matchValue.toLowerCase().replace(/\//g, "\\");
            }
            return exeName === r.matchValue.toLowerCase();
          });

          // 检查是否命中业务包
          const matchedBundle = bundles.find((b) => {
            if (!b.enabled) return false;
            return b.exes.some((be) => be.toLowerCase() === exeName);
          });

          const isRouted = Boolean(matchedRule || matchedBundle);
          const matchedRuleName = matchedRule?.label || matchedBundle?.name;
          const matchedProxy = matchedRule?.targetProxy || matchedBundle?.targetProxy;

          return {
            pid: entry.pid,
            name: entry.name || "未知应用",
            path: entry.executablePath || undefined,
            isRouted,
            matchedRuleName,
            matchedProxy,
          };
        });
      }
    } catch (e) {
      console.warn("[processRoutingService] get_process_tree failed in Tauri:", e);
    }
    return [];
  }

  return [...mockLiveProcesses];
}

/**
 * 调起操作系统原生文件选择器挑选本地可执行程序 (.exe)
 */
export async function chooseExecutableFile(): Promise<string | null> {
  return invokeCommand<string | null>("choose_routing_executable", undefined, () => null);
}

/**
 * 从实时活跃进程一键创建规则
 */
export async function routeLiveProcess(
  proc: LiveProcessItem,
  action: "proxy" | "direct",
  targetProxy?: string
): Promise<ProcessRuleItem[]> {
  return addProcessRule({
    enabled: true,
    label: proc.name,
    matchKind: proc.path ? "process-path" : "process-name",
    matchValue: proc.path || proc.name,
    action,
    targetProxy: action === "proxy" ? (targetProxy || "Proxy") : undefined,
    includeDescendants: true,
  });
}

// ==========================================================================
// 5. 出口插槽选项清洗与结构化
// 剔除系统内部保留字 (COMPATIBLE, GLOBAL, PASS, REJECT)，置顶常用优选策略组
// ==========================================================================

export interface CleanProxyOption {
  value: string;
  label: string;
  badge?: string;
  description?: string;
}

const SYSTEM_RESERVED_PROXIES = new Set([
  "COMPATIBLE",
  "GLOBAL",
  "PASS",
  "PASS-RULE",
  "REJECT",
  "REJECT-DROP",
]);

export function cleanProxyOptions(rawProxies: string[] | Record<string, any>): CleanProxyOption[] {
  const names = Array.isArray(rawProxies) ? rawProxies : Object.keys(rawProxies || {});
  const cleanList: CleanProxyOption[] = [];
  const added = new Set<string>();

  // 1. 核心出站规则组置顶
  if (names.some((n) => n.toLowerCase() === "proxy")) {
    cleanList.push({
      value: "Proxy",
      label: "Proxy (核心规则出站组)",
      badge: "默认",
      description: "遵循核心规则与主出站代理",
    });
    added.add("proxy");
  }

  // 2. 自动低延迟优选组
  const autoMatch = names.find(
    (n) => n.includes("Auto") || n.includes("自动") || n.toLowerCase() === "url-test"
  );
  if (autoMatch && !added.has(autoMatch.toLowerCase())) {
    cleanList.push({
      value: autoMatch,
      label: autoMatch,
      badge: "优选",
      description: "基于延迟自动切换最优节点",
    });
    added.add(autoMatch.toLowerCase());
  }

  // 3. 直连选项
  cleanList.push({
    value: "DIRECT",
    label: "DIRECT (局域网/国内直连)",
    badge: "直连",
    description: "不经过任何代理直接出站",
  });
  added.add("direct");

  // 4. 真实代理节点与自建专线 (过滤掉系统保留关键字与内部占位策略组)
  const nodeNames = names
    .filter((name) => {
      const trimmed = name.trim();
      const upper = trimmed.toUpperCase();
      if (SYSTEM_RESERVED_PROXIES.has(upper)) return false;
      if (added.has(trimmed.toLowerCase())) return false;
      // 严格过滤内部进程分流锚点与旧本地方案占位组
      if (trimmed.startsWith("PW-") || trimmed.startsWith("本地方案")) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  for (const name of nodeNames) {
    const isSpecial =
      name.includes("专线") ||
      name.includes("自建") ||
      name.includes("AnyTLS") ||
      name.includes("Reality") ||
      name.includes("Hy2");
    cleanList.push({
      value: name,
      label: name,
      badge: isSpecial ? "专线" : "节点",
    });
    added.add(name.toLowerCase());
  }

  return cleanList;
}
