import type {
  BusinessBundleDefinition,
  BundleLocalInstance,
  ExportableBundlePackage,
  BundleSlot,
  BundleProcessMember,
  BundleCategory,
  BundleFallback,
  BundlePolicy,
} from "../types/businessBundle";
import type { BundlePlatform } from "../types/platform";
import { validAndroidPackage, processMembers, validateProcessBindings } from "../utils/bundlePlatform";
import type { BundleRepositoryOrigin } from "../types/bundleRepository";
import { businessBundlesApi } from "../api/businessBundles";

function normalizeInstancePolicy(policy?: Partial<BundlePolicy> | null): BundlePolicy {
  return {
    proxyTcp: policy?.proxyTcp ?? true,
    blockIpv6: policy?.blockIpv6 ?? true,
    blockUdp: policy?.blockUdp ?? true,
    proxyUdp: policy?.proxyUdp ?? false,
    proxySubprocesses: policy?.proxySubprocesses ?? true,
    bypassLan: policy?.bypassLan ?? true,
    dnsMode: policy?.dnsMode ?? "safe_pure",
    portFilterMode: policy?.portFilterMode ?? "all",
    customPorts: policy?.customPorts ?? "",
    targetFilterMode: policy?.targetFilterMode ?? "all",
    targetRules: Array.isArray(policy?.targetRules) ? policy.targetRules : [],
    disallowProxyArgs: policy?.disallowProxyArgs ?? false,
    staleConnectionStrategy: policy?.staleConnectionStrategy ?? "prompt",
    useExistingRules: policy?.useExistingRules === true,
  };
}

const STORAGE_KEY = "netbox_business_bundles_instances_v1";
let installSerial = 0;

// 标准默认语义插槽
const DEFAULT_SLOTS: BundleSlot[] = [
  {
    id: "main",
    name: "主业务出口",
    description: "业务主进程与核心后台伴生进程访问外网所使用的代理节点",
    required: true,
  },
  {
    id: "dns",
    name: "DNS 解析出口",
    description: "域名解析出站插槽，默认跟随主业务出口以防 DNS 投毒",
    required: false,
    followSlotId: "main",
  },
];

let memoryInstances: BundleLocalInstance[] | null = null;
let initialized = false;
let initPromise: Promise<BundleLocalInstance[]> | null = null;

const upgradePreset = (instances: BundleLocalInstance[]): { list: BundleLocalInstance[]; changed: boolean } => {
  let changed = false;
  const list = instances.map(item => {
    if (item.definition?.packageId === "openai-chatgpt") {
      const domains = Array.isArray(item.definition.domains) ? [...item.definition.domains] : [];
      let itemChanged = false;
      if (!domains.some(d => d.toLowerCase() === "sora.com")) {
        domains.push("sora.com");
        itemChanged = true;
      }
      const processes = (item.definition.processes || []).map(p => {
        if (p.exe.toLowerCase() === "node.exe" && p.includeDescendants !== false) {
          itemChanged = true;
          return { ...p, includeDescendants: false };
        }
        return p;
      });
      if (item.definition.packageVersion !== "v1.6") {
        itemChanged = true;
      }
      if (!itemChanged) return item;
      changed = true;
      return {
        ...item,
        definition: {
          ...item.definition,
          packageVersion: "v1.6",
          domains,
          processes,
        },
      };
    }
    if (item.definition?.packageId !== "google-antigravity") return item;
    const domains = Array.isArray(item.definition.domains) ? [...item.definition.domains] : [];
    const additionalExes = Array.isArray(item.definition.additionalExes) ? [...item.definition.additionalExes] : [];
    const processes = Array.isArray(item.definition.processes) ? [...item.definition.processes] : [];
    let itemChanged = false;
    if (!domains.some(d => d.toLowerCase() === "googleapis.com")) {
      domains.push("googleapis.com");
      itemChanged = true;
    }
    if (!additionalExes.some(e => e.toLowerCase() === "language_server_windows_x64.exe")) {
      additionalExes.push("language_server_windows_x64.exe");
      itemChanged = true;
    }
    if (!processes.some(p => p.exe.toLowerCase() === "language_server_windows_x64.exe")) {
      processes.push({ exe: "language_server_windows_x64.exe", role: "worker", description: "LSP 语言模型服务 (Windows x64 变体)" });
      itemChanged = true;
    }
    if (!additionalExes.some(e => e.toLowerCase() === "gemini.exe")) {
      additionalExes.push("Gemini.exe");
      itemChanged = true;
    }
    if (!processes.some(p => p.exe.toLowerCase() === "gemini.exe")) {
      processes.push({ exe: "Gemini.exe", role: "worker", description: "Google Gemini 桌面客户端" });
      itemChanged = true;
    }
    const policy = item.definition.policy ? { ...item.definition.policy } : undefined;
    if (policy && policy.disallowProxyArgs === undefined) {
      policy.disallowProxyArgs = true;
      itemChanged = true;
    }
    if (item.definition.packageVersion !== "v1.2") {
      itemChanged = true;
    }
    if (!itemChanged) return item;
    changed = true;
    return {
      ...item,
      policy: item.policy && item.policy.disallowProxyArgs === undefined ? { ...item.policy, disallowProxyArgs: true } : item.policy,
      definition: {
        ...item.definition,
        packageVersion: "v1.2",
        domains,
        additionalExes,
        processes,
        policy: policy ?? item.definition.policy,
      },
    };
  });
  return { list, changed };
};

const prepare = (instances: BundleLocalInstance[]): BundleLocalInstance[] => {
  const independent = typeof document !== "undefined" && document.documentElement.dataset.edition === "process";
  return instances.map(i => {
    const base = independent && i.backend !== "external"
      ? { ...i, backend: "external" as const, enabled: false, slotBindings: { main: null, dns: "FOLLOW_MAIN" }, slotTargets: undefined, externalEndpointId: null }
      : i;
    return {
      ...base,
      policy: normalizeInstancePolicy(base.policy ?? base.definition.policy),
    };
  });
};

/**
 * 异步初始化业务规则包存储，并在必要时执行无感平滑迁移
 */
export async function initializeBundleStorage(): Promise<BundleLocalInstance[]> {
  if (initialized && memoryInstances) return memoryInstances;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. 优先尝试从后端读取已持久化的明文文件 data/config/business-bundles.json
      const backendData = await businessBundlesApi.load();
      if (Array.isArray(backendData)) {
        const cleaned = backendData.filter(
          (item: BundleLocalInstance) => !["inst-cursor", "inst-browser"].includes(item.instanceId)
        );
        const upgraded = upgradePreset(cleaned);
        const ready = prepare(upgraded.list);
        memoryInstances = ready;
        if (upgraded.changed) {
          void businessBundlesApi.save(ready);
        }
        // 清理旧版 localStorage 遗留
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        initialized = true;
        return ready;
      }

      // 2. 后端没有数据（老版本升级或全新开箱）：检查 localStorage 是否有旧数据
      let legacyData: BundleLocalInstance[] | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            legacyData = parsed;
          }
        }
      } catch {}

      let finalInstances: BundleLocalInstance[];
      if (legacyData && legacyData.length > 0) {
        // 发现老版本数据：清洗、升级并自动迁移到后端
        const cleaned = legacyData.filter(
          (item: BundleLocalInstance) => !["inst-cursor", "inst-browser"].includes(item.instanceId)
        );
        const upgraded = upgradePreset(cleaned);
        finalInstances = prepare(upgraded.list);
      } else {
        finalInstances = [];
      }

      // 3. 立即持久化至后端明文文件并清理老旧 localStorage
      memoryInstances = finalInstances;
      if (legacyData?.length) await businessBundlesApi.save(finalInstances);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      initialized = true;
      return finalInstances;
    } catch (err) {
      console.error("从后端读取业务规则包失败:", err);
      if (!memoryInstances) {
        memoryInstances = [];
      }
      initialized = true;
      return memoryInstances;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// 同步获取全部已装载的本地规则包实例
export function getBundleInstances(): BundleLocalInstance[] {
  if (memoryInstances) {
    return memoryInstances;
  }

  // 首屏尚未读取后端时，从旧版的本地配置恢复已保存的实例。
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned = parsed.filter(
          (item: BundleLocalInstance) => !["inst-cursor", "inst-browser"].includes(item.instanceId)
        );
        const upgraded = upgradePreset(cleaned);
        memoryInstances = prepare(upgraded.list);
      }
    }
  } catch {}

  if (!memoryInstances) {
    memoryInstances = [];
  }

  // 触发后台异步持久化与迁移对齐
  if (!initialized) {
    void initializeBundleStorage();
  }

  return memoryInstances;
}

// 保存本地实例到持久化存储（统一写入后端）
export function saveBundleInstances(instances: BundleLocalInstance[]): void {
  memoryInstances = instances;
  // 异步将业务定义原子持久化至后端的 data/config/business-bundles.json
  void businessBundlesApi.save(instances).catch(err => {
    console.error("持久化业务规则包实例至后端失败:", err);
  });
}

// 从预设模板装载新实例
export function createPresetBundleInstance(
  definition: BusinessBundleDefinition,
  autoEnable = false,
  boundNode: string | null = null,
  repositoryOrigin?: BundleRepositoryOrigin
): BundleLocalInstance {
  const instances = getBundleInstances();
  let instanceId: string;
  do { instanceId = `inst-${definition.packageId}-${Date.now().toString(36)}-${(++installSerial).toString(36)}`; } while (instances.some(i => i.instanceId === instanceId));

  return {
    instanceId,
    definition: JSON.parse(JSON.stringify(definition)),
    enabled: autoEnable && Boolean(boundNode),
    slotBindings: {
      main: boundNode,
      dns: "FOLLOW_MAIN",
    },
    watcherMode: definition.mode === "sandbox" ? "notify" : "auto",
    isModified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(repositoryOrigin ? { repositoryOrigin: { ...repositoryOrigin } } : {}),
  };
}

export function installPresetBundle(
  definition: BusinessBundleDefinition,
  autoEnable = false,
  boundNode: string | null = null,
  repositoryOrigin?: BundleRepositoryOrigin
): BundleLocalInstance {
  const newInstance = createPresetBundleInstance(definition, autoEnable, boundNode, repositoryOrigin);
  const instances = getBundleInstances();
  instances.push(newInstance);
  saveBundleInstances(instances);
  return newInstance;
}

// 更新指定实例
export function updateBundleInstance(
  instanceId: string,
  updater: (prev: BundleLocalInstance) => BundleLocalInstance
): BundleLocalInstance[] {
  const instances = getBundleInstances();
  const index = instances.findIndex((i) => i.instanceId === instanceId);
  if (index !== -1) {
    const updated = updater(instances[index]);
    updated.updatedAt = Date.now();
    instances[index] = updated;
    saveBundleInstances(instances);
  }
  return instances;
}

// 卸载/删除指定实例
export function deleteBundleInstance(instanceId: string): BundleLocalInstance[] {
  const instances = getBundleInstances().filter((i) => i.instanceId !== instanceId);
  saveBundleInstances(instances);
  return instances;
}

// 创建自定义规则包
export function createCustomBundleInstance(
  name: string,
  exes: string[],
  domains: string[],
  platform: BundlePlatform = "windows",
  processBindings?: BundleLocalInstance["processBindings"],
  options?: {
    icon?: string;
    mode?: "strict" | "sandbox";
    category?: BundleCategory;
    description?: string;
    fallback?: BundleFallback;
    policy?: BundlePolicy;
  }
): BundleLocalInstance {
  const packageId = `custom-${Date.now().toString(36)}`;
  const bindings = platform === "android" ? [] : processBindings?.[platform] ?? [];
  validateProcessBindings(bindings, platform);

  const mode = options?.mode ?? "strict";
  const definition: BusinessBundleDefinition = {
    packageId,
    packageName: name,
    packageVersion: "v1.0",
    category: options?.category ?? "custom",
    mode,
    icon: options?.icon ?? "📦",
    fallback: options?.fallback ?? (mode === "strict" ? "direct" : "rules"),
    description: options?.description ?? "用户自定义业务规则套件",
    slots: DEFAULT_SLOTS,
    processes: processMembers(platform === "windows" ? exes : [], [], bindings, platform),
    additionalExes: platform === "windows" ? exes : [],
    macosProcesses: platform === "macos" ? processMembers(exes, [], bindings, platform) : undefined,
    androidPackages: platform === "android" ? exes : undefined,
    domains,
    policy: options?.policy,
  };

  return {
    instanceId: `inst-${packageId}`,
    definition,
    processBindings,
    policy: options?.policy,
    enabled: false, // 默认停用 (跟随系统默认)
    slotBindings: { main: null, dns: "FOLLOW_MAIN" },
    watcherMode: mode === "sandbox" ? "notify" : "auto",
    isModified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createCustomBundle(...args: Parameters<typeof createCustomBundleInstance>): BundleLocalInstance {
  const newInstance = createCustomBundleInstance(...args);
  const instances = getBundleInstances();
  instances.push(newInstance);
  saveBundleInstances(instances);
  return newInstance;
}

// 规范安全导出：生成 .pwpack.json (白名单脱敏，绝对剔除本机实际节点与订阅身份)
export function exportBundlePackage(instance: BundleLocalInstance): ExportableBundlePackage {
  const def = instance.definition;
  // 仅克隆通用的结构，绝不携带 slotBindings
  const cleanDef: BusinessBundleDefinition = {
    packageId: def.packageId,
    packageName: def.packageName,
    packageVersion: def.packageVersion,
    category: def.category,
    mode: def.mode,
    fallback: def.fallback ?? "rules",
    icon: def.icon,
    description: def.description,
    slots: def.slots.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      required: s.required,
      followSlotId: s.followSlotId,
    })),
    processes: def.processes.map((p) => ({
      exe: p.exe,
      role: p.role,
      description: p.description,
      ...(p.includeDescendants !== undefined ? { includeDescendants: p.includeDescendants } : {}),
    })),
    macosProcesses: def.macosProcesses?.map(p => ({ exe: p.exe, role: p.role, description: p.description, ...(p.includeDescendants !== undefined ? { includeDescendants: p.includeDescendants } : {}) })),
    androidPackages: def.androidPackages ? [...def.androidPackages] : undefined,
    additionalExes: def.additionalExes ? [...def.additionalExes] : undefined,
    domains: def.domains ? [...def.domains] : undefined,
    author: def.author || "Net-Box User",
    ...(instance.policy ? { policy: instance.policy } : def.policy ? { policy: def.policy } : {}),
  };

  return {
    formatVersion: "1.0",
    exportedAt: new Date().toISOString(),
    bundle: cleanDef,
  };
}

// 校验并解析外部导入的 .pwpack.json (严格遵循 B05 契约)
export function validateAndParseBundlePackage(jsonString: string): {
  valid: boolean;
  error?: string;
  bundle?: BusinessBundleDefinition;
} {
  try {
    if (!jsonString || typeof jsonString !== "string") {
      return { valid: false, error: "导入内容为空" };
    }
    if (jsonString.length > 5 * 1024 * 1024) {
      return { valid: false, error: "导入文件体积过大（超过 5MB 上限），已拒绝处理" };
    }

    const data = JSON.parse(jsonString);
    if (!data || typeof data !== "object") {
      return { valid: false, error: "文件格式无效，非合法的 JSON 对象" };
    }

    if (data.formatVersion && typeof data.formatVersion === "string" && !data.formatVersion.startsWith("1.")) {
      return { valid: false, error: `不支持的规则包格式版本: ${data.formatVersion}` };
    }

    const bundle = data.bundle || data;
    if (bundle.fallback !== undefined && !["rules", "system", "direct"].includes(bundle.fallback)) {
      return { valid: false, error: "未命中域名时的策略无效" };
    }
    if (!bundle.packageName || typeof bundle.packageName !== "string" || !bundle.packageName.trim()) {
      return { valid: false, error: "缺少必要的规则包名称 (packageName)" };
    }
    let processes = Array.isArray(bundle.processes) ? bundle.processes : null;
    if (!processes && Array.isArray(bundle.exes)) {
      if (bundle.exes.length > 100) {
        return { valid: false, error: "单包进程数量超过安全上限 (最大 100 个)" };
      }
      const mainIndex = Math.max(0, bundle.exes.indexOf(bundle.mainExe));
      processes = bundle.exes.map((exe: unknown, index: number) => ({
        exe,
        role: index === mainIndex ? "main" : "worker",
      }));
    }
    if (!processes || (processes.length === 0 && !bundle.macosProcesses?.length && !bundle.androidPackages?.length)) {
      return { valid: false, error: "规则包中必须至少包含一个进程定义 (processes)" };
    }
    if (processes.length > 100) {
      return { valid: false, error: "单包进程数量超过安全上限 (最大 100 个)" };
    }

    // 清洗并严格校验进程名（严禁路径遍历字符、斜杠以及纯数字）
    const validProcesses: BundleProcessMember[] = [];
    for (const p of processes) {
      const exe = typeof p === "string" ? p : p?.exe;
      if (typeof exe !== "string") continue;
      const rawExe = exe.trim();
      if (!rawExe) continue;
      // 拒绝路径遍历或带路径的非法执行内容
      if (rawExe.includes("/") || rawExe.includes("\\") || rawExe.includes("..")) {
        return { valid: false, error: `检测到不安全的进程路径字符: ${rawExe}` };
      }
      // 拒绝纯数字进程名
      if (/^\d+$/.test(rawExe)) {
        return { valid: false, error: `进程名称无效（不能为纯数字）: ${rawExe}` };
      }
      const role = p.role === "main" || p.role === "cli" ? p.role : "worker";
      validProcesses.push({
        exe: rawExe,
        role,
        description: typeof p.description === "string" ? p.description : "",
        ...(typeof p.includeDescendants === "boolean" ? { includeDescendants: p.includeDescendants } : {}),
      });
    }

    let macosProcesses: BundleProcessMember[] | undefined;
    if (bundle.macosProcesses !== undefined) {
      if (!Array.isArray(bundle.macosProcesses) || bundle.macosProcesses.length > 100) return { valid: false, error: "macOS 进程列表无效或超过 100 个" };
      macosProcesses = [];
      for (const p of bundle.macosProcesses) {
        if (!p || typeof p.exe !== "string" || !p.exe.trim() || p.exe.length > 260 || /[/\\\x00-\x1f]/.test(p.exe) || p.exe.includes("..") || /^\d+$/.test(p.exe.trim()) || p.exe.trim().toLowerCase().endsWith(".app")) return { valid: false, error: "macOS 进程名无效；请填写 .app 内实际可执行文件名" };
        if (!["main", "worker", "cli", "helper"].includes(p.role)) return { valid: false, error: "macOS 进程角色无效" };
        macosProcesses.push({ exe: p.exe.trim(), role: p.role, description: typeof p.description === "string" ? p.description.slice(0, 512) : "", ...(typeof p.includeDescendants === "boolean" ? { includeDescendants: p.includeDescendants } : {}) });
      }
    }
    let androidPackages: string[] | undefined;
    if (bundle.androidPackages !== undefined) {
      if (!Array.isArray(bundle.androidPackages) || bundle.androidPackages.length > 100 || bundle.androidPackages.some((p: unknown) => typeof p !== "string" || !validAndroidPackage(p))) {
        return { valid: false, error: "Android 应用包名无效或超过 100 个" };
      }
      androidPackages = [...new Set<string>(bundle.androidPackages)];
    }
    if (validProcesses.length === 0 && !macosProcesses?.length && !androidPackages?.length) {
      return { valid: false, error: "经过过滤后，未找到任何有效的可执行进程定义" };
    }

    // 校验域名列表
    let validDomains: string[] | undefined = undefined;
    if (Array.isArray(bundle.domains)) {
      if (bundle.domains.length > 1000) {
        return { valid: false, error: "单包域名数量超过安全上限 (最大 1000 个)" };
      }
      validDomains = bundle.domains
        .filter((d: any) => typeof d === "string" && d.trim().length > 0 && !d.includes(" ") && !d.includes("/"))
        .map((d: any) => d.trim().toLowerCase());
    }

    // 格式化并补全插槽
    const validBundle: BusinessBundleDefinition = {
      packageId: bundle.packageId || `imported-${Date.now().toString(36)}`,
      packageName: bundle.packageName.trim(),
      packageVersion: bundle.packageVersion || "v1.0",
      category: bundle.category || "custom",
      mode: bundle.mode === "sandbox" ? "sandbox" : "strict",
      fallback: bundle.fallback ?? "rules",
      icon: bundle.icon || "📦",
      description: bundle.description || "导入的规则包",
      slots: Array.isArray(bundle.slots) && bundle.slots.length > 0 ? bundle.slots : DEFAULT_SLOTS,
      processes: validProcesses,
      macosProcesses,
      androidPackages,
      additionalExes: Array.isArray(bundle.additionalExes) ? bundle.additionalExes.filter((e: any) => typeof e === "string") : undefined,
      domains: validDomains,
      author: typeof bundle.author === "string" ? bundle.author : undefined,
    };

    return { valid: true, bundle: validBundle };
  } catch (err: any) {
    return { valid: false, error: `解析 JSON 失败: ${err.message || err}` };
  }
}
