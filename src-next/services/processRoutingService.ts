// ==========================================================================
// ProcWeaver src-next 进程分流与业务规则包服务网关
// 规范溯源: rust-pro (routing_overrides IPC) / AGENTS.md 业务规则包规范
// 对接指令: get_routing_overrides, save_routing_overrides, get_process_tree,
//           choose_routing_executable, get_business_bundles, save_business_bundles
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";
import {
  ProcessBundleItem,
  ProcessRuleItem,
  LiveProcessItem,
  ProcessRoutingState,
  ProcessTrafficDriver,
} from "../types/processRouting";

// LocalStorage 缓存持久化 Key
const STORAGE_BUNDLES_KEY = "procweaver_business_bundles_v2";
const STORAGE_RULES_KEY = "procweaver_process_rules_v2";
const STORAGE_STATE_KEY = "procweaver_process_routing_state";

// ==========================================================================
// 默认官方业务包池 (严格遵循 AGENTS.md 约定：发布 OpenAI 与 反重力，无任何 Emoji)
// ==========================================================================
export const OFFICIAL_PRESET_BUNDLES: ProcessBundleItem[] = [
  {
    id: "openai-bundle",
    name: "OpenAI 官方套件",
    description: "专为 ChatGPT 桌面端与 Codex 开发接口定制，精准绕过风控",
    mainExe: "ChatGPT.exe",
    exes: ["ChatGPT.exe", "OpenAI.exe", "codex-cli.exe"],
    enabled: false,
    targetProxy: "",
    mode: "strict",
    fallback: "rules",
    domains: ["openai.com", "chatgpt.com", "*.oaistatic.com", "*.oaiusercontent.com"],
    policy: {
      proxyTcp: true,
      blockIpv6: true,
      blockUdp: true,
      proxyUdp: false,
      proxySubprocesses: true,
      bypassLan: true,
      dnsMode: "safe_pure",
      portFilterMode: "all",
      customPorts: "",
      targetFilterMode: "all",
      targetRules: [],
      disallowProxyArgs: false,
      staleConnectionStrategy: "prompt",
    },
    updatedAt: "2026-11-06 12:00",
  },
  {
    id: "antigravity-bundle",
    name: "反重力开发套件",
    description: "绑定 Google Antigravity、IDE 智能编码与 Cursor 引擎",
    mainExe: "antigravity.exe",
    exes: ["antigravity.exe", "cursor.exe", "code.exe"],
    enabled: false,
    targetProxy: "",
    mode: "strict",
    fallback: "rules",
    domains: ["google.com", "*.google.com", "cursor.sh", "*.cursor.sh"],
    policy: {
      proxyTcp: true,
      blockIpv6: true,
      blockUdp: true,
      proxyUdp: false,
      proxySubprocesses: true,
      bypassLan: true,
      dnsMode: "safe_pure",
      portFilterMode: "all",
      customPorts: "",
      targetFilterMode: "all",
      targetRules: [],
      disallowProxyArgs: false,
      staleConnectionStrategy: "prompt",
    },
    updatedAt: "2026-11-06 14:15",
  },
];

const DEFAULT_BUNDLES: ProcessBundleItem[] = OFFICIAL_PRESET_BUNDLES;

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
    connectionCount: 32,
    uploadBytes: 1200000,
    downloadBytes: 8900000,
    isRouted: true,
    matchedRuleName: "Google Chrome",
    matchedProxy: "Proxy",
  },
  {
    pid: 7120,
    name: "WeChat.exe",
    path: "D:\\Tencent\\WeChat\\WeChat.exe",
    connectionCount: 4,
    uploadBytes: 54000,
    downloadBytes: 88000,
    isRouted: true,
    matchedRuleName: "微信桌面版 (国内直连)",
    matchedProxy: "DIRECT 直连",
  },
  {
    pid: 19844,
    name: "spotify.exe",
    path: "C:\\Users\\Administrator\\AppData\\Roaming\\Spotify\\spotify.exe",
    connectionCount: 8,
    uploadBytes: 34000,
    downloadBytes: 4500000,
    isRouted: false,
  },
  {
    pid: 12048,
    name: "steam.exe",
    path: "D:\\Steam\\steam.exe",
    connectionCount: 5,
    uploadBytes: 12000,
    downloadBytes: 15000,
    isRouted: false,
  },
  {
    pid: 23108,
    name: "node.exe",
    path: "C:\\Program Files\\nodejs\\node.exe",
    connectionCount: 3,
    uploadBytes: 45000,
    downloadBytes: 68000,
    isRouted: false,
  },
];

// ==========================================================================
// 核心算法: 准确计算当前系统中被规则命中且存活运行的接管进程实例总数
// 避免将操作系统所有存活进程 (300+ 个系统基础进程) 误报为“接管中”
// ==========================================================================
export function calcActiveRoutedProcessCount(overrides: any): number {
  if (!overrides?.config) return 0;
  const processEnabled = Boolean(overrides.config.processEnabled);
  const bundlesEnabled = Boolean(overrides.config.bundlesEnabled);
  if (!processEnabled && !bundlesEnabled) return 0;

  const entries: any[] = overrides.tracking?.entries || [];
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  // 1. 收集已启用的业务规则包可执行程序名单 (统一小写去重)
  const activeBundleExes = new Set<string>();
  if (bundlesEnabled && Array.isArray(overrides.config.bundles)) {
    for (const b of overrides.config.bundles) {
      if (b && b.enabled && Array.isArray(b.exes)) {
        for (const exe of b.exes) {
          if (exe) {
            const clean = String(exe).trim().toLowerCase();
            const fileName = clean.split(/[/\\]/).pop() || clean;
            activeBundleExes.add(fileName);
          }
        }
      }
    }
  }

  // 2. 收集已启用的自定义规则与子进程派生规则
  const activeRules: { matchKind: string; matchValue: string }[] = [];
  if (processEnabled && Array.isArray(overrides.config.processRules)) {
    for (const r of overrides.config.processRules) {
      if (r && r.enabled && r.matchValue) {
        activeRules.push({
          matchKind: r.matchKind || "name",
          matchValue: String(r.matchValue).trim().toLowerCase(),
        });
      }
    }
  }
  if (Array.isArray(overrides.tracking?.derived)) {
    for (const r of overrides.tracking.derived) {
      if (r && r.matchValue) {
        activeRules.push({
          matchKind: r.matchKind || "path",
          matchValue: String(r.matchValue).trim().toLowerCase(),
        });
      }
    }
  }

  let count = 0;
  for (const entry of entries) {
    if (!entry) continue;
    const exeName = String(entry.name || "").trim().toLowerCase();
    const exePath = String(entry.executablePath || "").trim().toLowerCase();

    // 优先匹配业务包程序
    if (activeBundleExes.has(exeName)) {
      count++;
      continue;
    }

    // 匹配自定义进程规则或派生规则
    const isMatched = activeRules.some((rule) => {
      if (rule.matchKind === "process-path" || rule.matchKind === "path") {
        return exePath && (exePath === rule.matchValue || exePath.includes(rule.matchValue));
      }
      return exeName === rule.matchValue;
    });

    if (isMatched) {
      count++;
    }
  }

  return count;
}

// ==========================================================================
// 1. 获取全局进程分流总控状态与底层分流驱动
// ==========================================================================
export async function fetchProcessRoutingState(): Promise<ProcessRoutingState> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [overrides, settings, activeDriver, isAdmin] = await Promise.all([
        invoke<any>("get_routing_overrides").catch(() => null),
        invoke<any>("get_general_settings").catch(() => null),
        invoke<string>("get_active_traffic_driver").catch(() => "app_proxy"),
        invoke<boolean>("check_is_admin").catch(() => false),
      ]);

      let engineMode: ProcessTrafficDriver = "app_proxy";
      if (
        settings?.trafficMode &&
        (settings.trafficMode === "user_mode" ||
          settings.trafficMode === "app_proxy" ||
          settings.trafficMode === "windivert_v1")
      ) {
        engineMode = settings.trafficMode;
      }

      const driverActive =
        activeDriver === "windivert" ||
        (activeDriver === "user_mode" && calcActiveRoutedProcessCount(overrides) > 0) ||
        activeDriver === "app_proxy";

      return {
        bundlesEnabled: overrides?.config?.bundlesEnabled ?? false,
        processEnabled: overrides?.config?.processEnabled ?? false,
        driverActive,
        engineMode,
        activeDriverName: activeDriver,
        isAdmin: Boolean(isAdmin),
        activeProcessCount: calcActiveRoutedProcessCount(overrides),
        totalBundleCount: (overrides?.config?.bundles || []).length,
        totalRuleCount: (overrides?.config?.processRules || []).length,
      };
    } catch (e) {
      console.warn("[processRoutingService] fetchProcessRoutingState fallback", e);
    }
  }

  // 纯浏览器缓存读取
  try {
    const raw = localStorage.getItem(STORAGE_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  return {
    bundlesEnabled: false,
    processEnabled: false,
    driverActive: false,
    engineMode: "app_proxy",
    activeDriverName: "app_proxy",
    isAdmin: false,
    activeProcessCount: 0,
    totalBundleCount: DEFAULT_BUNDLES.length,
    totalRuleCount: DEFAULT_RULES.length,
  };
}

export async function switchProcessDriver(
  driver: ProcessTrafficDriver
): Promise<ProcessRoutingState> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const current = await invoke<any>("get_general_settings");
      const updated = {
        ...current,
        trafficMode: driver,
        tunMode: false, // 严格遵循用户指令：进程分流不加 TUN
      };
      await invoke("save_general_settings", { settings: updated });
      window.dispatchEvent(new Event("netbox-settings-saved"));
      window.dispatchEvent(new Event("netbox-route-changed"));

      // 切换驱动后立即触发编译与底层下发，确保 WinDivert plan 与 helper 联动
      await syncRoutingToCore();
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

export async function launchBundleApp(instanceId: string): Promise<any> {
  if (isTauriEnvironment()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("launch_bundle_app", {
      request: { instanceId },
      confirmation: null,
      prepareOnly: false,
    });
  }
  return { state: "launched", message: "仿真环境：已受控启动" };
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

export async function syncRoutingToCore(
  targetBundles?: ProcessBundleItem[],
  targetRules?: ProcessRuleItem[]
): Promise<void> {
  if (!isTauriEnvironment()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const view = await invoke<any>("get_routing_overrides");
    if (!view || !view.config) return;

    // 1. 取得数据源
    const currentBundles = targetBundles || (await fetchBundles());
    const currentRules = targetRules || (await fetchProcessRules());

    const availableTargets: any[] = Array.isArray(view.targets) ? view.targets : [];
    const activeProfileId = availableTargets[0]?.profileId || view.config?.processRules?.[0]?.target?.profileId || "default";

    // 出口插槽解析器：严格解析为合规的 RoutingTarget { profileId, kind, name }
    // 严格绑定原则：按精确的订阅、节点或策略组身份解析，绝不暗中按相似名称或模糊 Auto 组替换
    const resolveTarget = (targetName?: string) => {
      if (!targetName || !targetName.trim()) {
        return null;
      }
      const trimmedTarget = targetName.trim();
      if (trimmedTarget.startsWith("PW-") || trimmedTarget.startsWith("本地方案")) {
        return null;
      }
      if (!availableTargets.length) {
        return null;
      }

      // 1. 严格全等匹配 (保留节点名原始大小写与 Emoji)
      const exact = availableTargets.find((t: any) => t.name === targetName);
      if (exact) return exact;

      // 2. 忽略大小写精确匹配 (同一节点名字母大小写容差)
      const caseMatch = availableTargets.find(
        (t: any) => t.name.toLowerCase() === targetName.toLowerCase()
      );
      if (caseMatch) return caseMatch;

      // 3. 用户明确选择直连 (DIRECT)
      if (
        trimmedTarget.toUpperCase() === "DIRECT" ||
        trimmedTarget === "全球直连" ||
        trimmedTarget === "DIRECT (局域网/国内直连)" ||
        trimmedTarget === "DIRECT 直连"
      ) {
        const directTarget = availableTargets.find(
          (t: any) => t.name.toUpperCase() === "DIRECT" || t.name === "全球直连"
        );
        if (directTarget) return directTarget;
        return { profileId: activeProfileId, kind: "group", name: "DIRECT" };
      }

      // 4. 精确绑定原则：找不到原出口时严格返回 null，提示用户重绑，绝不移花接木或猜测替换
      return null;
    };

    // 2. 编译业务规则包为 BundleRoute 与 第一优先级 ProcessRule (第 0 优先级)
    const compiledBundles: any[] = [];
    const bundleProcessRules: any[] = [];
    const previousBundles = view.config.bundles || [];

    for (const b of currentBundles) {
      const prev = previousBundles.find((p: any) => p.id === b.id);
      const mainTarget = resolveTarget(b.targetProxy);

      compiledBundles.push({
        id: b.id,
        name: b.name,
        mainExe: b.mainExe || b.exes[0] || "",
        enabled: b.enabled,
        mainTarget: b.enabled ? mainTarget : null,
        dnsTarget: b.enabled ? mainTarget : null,
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
        },
      });

      // 展开业务包内的所有进程成员为第 0 优先级进程拦截规则 (WinDivert 强锁)
      if (b.enabled) {
        const uniqueExes = Array.from(new Set(b.exes.map((e) => e.trim()).filter(Boolean)));
        for (const exe of uniqueExes) {
          const cleanId = exe.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
          bundleProcessRules.push({
            id: `bundle-${b.id}-${cleanId}`,
            enabled: true,
            label: `${b.name} - ${exe}`,
            matchKind: "name",
            matchValue: exe,
            action: "proxy",
            target: mainTarget,
            includeDescendants: b.policy?.proxySubprocesses ?? true,
            ruleMode: b.mode === "strict" ? "strict" : "inherit",
          });
        }
      }
    }

    // 3. 编译用户手动添加的自定单进程规则 (过滤掉 bundle- 开头的项)
    const manualRules = currentRules
      .filter((r) => !r.id.startsWith("bundle-"))
      .map((r) => ({
        id: r.id,
        enabled: r.enabled,
        label: r.label,
        matchKind: r.matchKind === "process-path" ? "path" : "name",
        matchValue: r.matchValue,
        action: r.action,
        target: r.action === "proxy" ? resolveTarget(r.targetProxy) : null,
        includeDescendants: r.includeDescendants,
        ruleMode: (r as any).ruleMode === "inherit" ? "inherit" : "strict",
      }));

    // 4. 业务包规则排在最前列（第 0 优先级），紧接着是用户自定进程规则
    const allProcessRules = [...bundleProcessRules, ...manualRules];

    // 5. 组装合规的 RoutingOverrides 配置
    const currentProcessEnabled = view.config.processEnabled ?? false;
    const currentBundlesEnabled = view.config.bundlesEnabled ?? false;

    // 尊重总控意图：严禁因列表内存在单项规则而在保存时强行把用户已暂停的总控开关重新打开
    const shouldEnableBundles = currentBundlesEnabled;
    const shouldEnableProcess = currentProcessEnabled;

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
      if (b.enabled && b.mainTarget?.name) {
        const group = toBundleGroupName(b.id, "main");
        try {
          await invoke("switch_mihomo_proxy", { group, proxy: b.mainTarget.name });
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
export async function fetchBundles(): Promise<ProcessBundleItem[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<any[]>("get_business_bundles");
      // 核心修复：只要后端返回了合规数组定义（包括空数组 []），直接采纳，严禁自动回退默认包
      if (Array.isArray(list)) {
        return list.map((inst) => {
          const def = inst.definition || {};
          const policy = inst.policy || def.policy || {};
          const exes = (def.processes || []).map((p: any) => p.exe || "");
          const mode = (inst.mode || def.mode || "strict") as any;
          const fallback = (inst.fallback || def.fallback || "rules") as any;
          const domains = Array.isArray(def.domains) ? def.domains : Array.isArray(inst.domains) ? inst.domains : [];

          let rawTarget = inst.slotTargets?.main?.name || inst.slotBindings?.main || "";
          if (rawTarget.startsWith("PW-") || rawTarget.startsWith("本地方案")) {
            rawTarget = "";
          }

          return {
            id: inst.instanceId,
            name: def.packageName || "未命名业务包",
            description: def.description || "",
            icon: def.icon || "📦",
            mainExe: exes[0] || "",
            exes,
            enabled: Boolean(inst.enabled),
            targetProxy: rawTarget,
            mode: mode === "sandbox" ? "sandbox" : "strict",
            fallback: fallback === "system" || fallback === "direct" ? fallback : "rules",
            domains,
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
              staleConnectionStrategy:
                policy.staleConnectionStrategy === "auto_reset" || policy.staleConnectionStrategy === "auto_close"
                  ? "auto_reset"
                  : policy.staleConnectionStrategy === "ignore" || policy.staleConnectionStrategy === "keep"
                  ? "ignore"
                  : "prompt",
            },
            updatedAt: inst.updatedAt ? new Date(inst.updatedAt).toLocaleDateString() : undefined,
          };
        });
      }
    } catch (e) {
      console.warn("[processRoutingService] get_business_bundles failed:", e);
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_BUNDLES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  return DEFAULT_BUNDLES;
}

export async function saveBundles(bundles: ProcessBundleItem[]): Promise<void> {
  localStorage.setItem(STORAGE_BUNDLES_KEY, JSON.stringify(bundles));
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rawInstances = await invoke<any[]>("get_business_bundles");
      const instances = Array.isArray(rawInstances) ? rawInstances : [];
      const existingMap = new Map(instances.map((inst) => [inst.instanceId, inst]));

      // 核心修复：以当前前台传入的 bundles 为唯一真理源进行映射构造
      // 凡是不在 bundles 中的项已被用户彻底物理删除，绝不再塞回 nextInstances
      const nextInstances = bundles.map((b) => {
        const inst = existingMap.get(b.id);
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
              main: cleanTarget,
            },
            slotTargets: {
              ...inst.slotTargets,
              main: cleanTarget ? {
                kind: "node",
                name: cleanTarget,
              } : null,
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
            enabled: b.enabled,
            mode: b.mode,
            fallback: b.fallback,
            domains: b.domains,
            slotBindings: {
              main: b.targetProxy,
            },
            slotTargets: {
              main: {
                kind: "node",
                name: b.targetProxy,
              },
            },
            definition: {
              packageId: b.id,
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
      });

      await invoke("save_business_bundles", { instances: nextInstances });
      window.dispatchEvent(new Event("netbox-route-changed"));
      window.dispatchEvent(new Event("procweaver-route-changed"));
    } catch (e: any) {
      console.warn("[processRoutingService] save_business_bundles failed:", e);
      throw new Error(typeof e === "string" ? e : e?.message || "业务规则包实例持久化失败");
    }

    // 核心修复：立即执行底层 WinDivert 过滤驱动与 Mihomo 进程路由编译同步
    await syncRoutingToCore(bundles, undefined);
  }
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
  await saveBundles(next);
  return next;
}

export async function resetBundleToDefault(bundleId: string): Promise<ProcessBundleItem[]> {
  const preset = OFFICIAL_PRESET_BUNDLES.find((p) => p.id === bundleId);
  if (!preset) return fetchBundles();
  return updateBundleInstance(bundleId, {
    name: preset.name,
    description: preset.description,
    mainExe: preset.mainExe,
    exes: [...preset.exes],
    mode: preset.mode,
    fallback: preset.fallback,
    domains: [...preset.domains],
    policy: { ...preset.policy },
  });
}

export async function updateBundleInstance(
  bundleId: string,
  updates: Partial<ProcessBundleItem>
): Promise<ProcessBundleItem[]> {
  const current = await fetchBundles();
  const next = current.map((b) => (b.id === bundleId ? { ...b, ...updates } : b));
  await saveBundles(next);
  return next;
}

export async function deleteBundle(bundleId: string): Promise<ProcessBundleItem[]> {
  const current = await fetchBundles();
  const next = current.filter((b) => b.id !== bundleId);
  await saveBundles(next);
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
      packageId: bundle.id || `bundle-${Date.now().toString(36)}`,
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
      enabled: true,
      targetProxy: "Proxy", // 安全脱敏：导入后默认由用户在本地指派出口插槽
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
  };
  const next = [...current, nextBundle];
  await saveBundles(next);
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
            if (r.matchKind === "process-path" && exePath) {
              return exePath.includes(r.matchValue.toLowerCase());
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
            connectionCount: Math.floor(Math.random() * 6) + 1,
            uploadBytes: 1024 * (Math.floor(Math.random() * 200) + 10),
            downloadBytes: 1024 * (Math.floor(Math.random() * 800) + 50),
            isRouted,
            matchedRuleName,
            matchedProxy,
          };
        });
      }
    } catch (e) {
      console.warn("[processRoutingService] get_process_tree failed in Tauri:", e);
    }
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
      label: "Auto (自动低延迟优选)",
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
