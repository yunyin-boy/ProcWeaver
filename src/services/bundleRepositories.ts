import type { BundleRepository, RepositoryCatalog, RepositoryPackage, RepositorySettings } from "../types/bundleRepository";
import { defaultBundlePolicy, normalizeBundlePolicy, type BundlePolicy } from "../types/businessBundle";
import { validateAndParseBundlePackage } from "./bundleStorage";

export const REPOSITORY_STORAGE_KEY = "procweaver_bundle_repositories_v1";
export const DEFAULT_REPOSITORY: BundleRepository = {
  id: "procweaver-library-mirror",
  name: "ProcWeaver 官方业务包库（镜像）",
  kind: "github",
  url: "https://github.com/yunyin-boy/procweaver-rules",
  branch: "",
  directory: "Business-Rules",
  enabled: true,
};
const MAX_REPOSITORIES = 21, MAX_PACKAGES = 100;
const FILE_LIMIT = 1024 * 1024;

export function httpsUrl(value: string, base?: string): string {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error("请填写有效的 HTTPS 地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href.length > 2048) throw new Error("仓库地址须为 HTTPS，不能包含账号、密码或片段");
  return url.href;
}

export function normalizeGithubProxy(input: string): string {
  if (typeof input !== "string") throw new Error("GitHub 代理地址无效");
  const value = input.trim();
  if (!value) return "";
  try {
    const url = httpsUrl(value);
    if (/[?#]/.test(url)) throw new Error();
    return url.endsWith("/") ? url : url + "/";
  } catch {
    throw new Error("GitHub 代理地址须为 HTTPS 前缀，且不能含登录信息、查询参数或片段");
  }
}

export function normalizeRepository(input: BundleRepository): BundleRepository {
  if (!input || typeof input.id !== "string" || !/^[\w-]{1,80}$/.test(input.id) || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80 || typeof input.enabled !== "boolean") throw new Error("仓库名称或配置无效");
  if (input.kind !== "github" && input.kind !== "index") throw new Error("不支持的仓库类型");
  if (typeof input.url !== "string" || typeof input.branch !== "string" || typeof input.directory !== "string") throw new Error("仓库地址配置无效");
  let url = input.url.trim(), branch = input.branch.trim(), directory = input.directory.trim().replace(/^\/+|\/+$/g, "");
  if (input.kind === "github") {
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
    const parsed = new URL(httpsUrl(url));
    if (parsed.hostname !== "github.com" || parsed.port || parsed.search) throw new Error("GitHub 仓库请填写 github.com 仓库或目录地址");
    const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2 || !parts.slice(0, 2).every(p => /^[\w.-]+$/.test(p) && p !== "." && p !== "..")) throw new Error("GitHub 地址缺少所有者或仓库名称");
    if (parts.length > 2) {
      if (parts[2] !== "tree" || !parts[3]) throw new Error("请使用 GitHub 仓库或 tree 目录链接");
      branch = branch || parts[3];
      if (!input.directory.trim()) directory = parts.slice(4).join("/");
    }
    const repository = parts[1].replace(/\.git$/i, "").toLowerCase();
    if (!repository || repository === "." || repository === "..") throw new Error("GitHub 地址缺少仓库名称");
    url = `https://github.com/${parts[0].toLowerCase()}/${repository}`;
    if (branch.length > 200 || /[\s\\?#\x00-\x1f]/.test(branch) || branch.split("/").some(s => s === "." || s === "..")) throw new Error("分支或标签格式无效");
    if (directory.length > 400 || /[\\?#\x00-\x1f]/.test(directory) || directory.split("/").some(s => s === "." || s === "..")) throw new Error("仓库目录格式无效");
  } else { url = httpsUrl(url); branch = ""; directory = ""; }
  return { id: input.id, name: input.name.trim(), kind: input.kind, url, branch, directory, enabled: input.enabled };
}
export const repositoryKey = (repo: BundleRepository) => JSON.stringify([repo.kind, repo.url, repo.branch, repo.directory]);
export function repositoryPage(repo: BundleRepository): string {
  return repo.kind === "github" && repo.branch ? `${repo.url}/tree/${encodeURIComponent(repo.branch)}/${repo.directory.split("/").map(encodeURIComponent).join("/")}` : repo.url;
}
export function validateRepositories(list: BundleRepository[]): BundleRepository[] {
  if (!Array.isArray(list) || list.length > MAX_REPOSITORIES) throw new Error(`最多配置 ${MAX_REPOSITORIES} 个仓库`);
  const normalized = list.map(normalizeRepository), ids = new Set<string>(), keys = new Set<string>();
  for (const repo of normalized) {
    const key = repositoryKey(repo);
    if (ids.has(repo.id) || keys.has(key)) throw new Error("此仓库地址、分支与目录已添加");
    ids.add(repo.id); keys.add(key);
  }
  return normalized;
}
export function isDefaultRepository(repo: BundleRepository): boolean {
  return repo.kind === "github" && repo.url === DEFAULT_REPOSITORY.url
    && repo.directory === DEFAULT_REPOSITORY.directory && (repo.branch === "" || repo.branch === "main");
}

function addDefaultRepository(repositories: BundleRepository[]): BundleRepository[] {
  const mirror = repositories.find(isDefaultRepository);
  if (mirror) {
    return [{ ...mirror, name: DEFAULT_REPOSITORY.name }, ...repositories.filter(repo => repo.id !== mirror.id)];
  }
  return validateRepositories([DEFAULT_REPOSITORY, ...repositories]);
}

export interface RepositoryStorage { read(): RepositorySettings; save(next: RepositorySettings, expected: RepositorySettings): void }
export function repositoryStorage(storage: Pick<Storage, "getItem" | "setItem">): RepositoryStorage {
  const read = (): RepositorySettings => {
    const raw = storage.getItem(REPOSITORY_STORAGE_KEY);
    if (raw === null) return { repositories: [{ ...DEFAULT_REPOSITORY }], githubProxy: "" };
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1) throw new Error();
      const repositories = validateRepositories(data.repositories);
      return {
        repositories: data.defaultSourceInitialized === true ? repositories : addDefaultRepository(repositories),
        githubProxy: normalizeGithubProxy(data.githubProxy ?? ""),
      };
    } catch {
      throw new Error("仓库配置读取失败，未覆盖原数据；请修复配置后重新加载");
    }
  };
  return { read, save(next, expected) {
    const repositories = validateRepositories(next.repositories);
    const githubProxy = normalizeGithubProxy(next.githubProxy);
    if (JSON.stringify(read()) !== JSON.stringify(expected)) throw new Error("仓库配置已在其他窗口修改，请重新加载后重试");
    try { storage.setItem(REPOSITORY_STORAGE_KEY, JSON.stringify({ version: 1, repositories, githubProxy, defaultSourceInitialized: true })); }
    catch { throw new Error("仓库配置保存失败，请检查存储空间"); }
  } };
}

export type RepositoryRequest = (url: string, signal: AbortSignal, maxBytes: number) => Promise<string>;
function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("仓库返回的内容不是有效 JSON"); }
}

function repositoryPolicy(value: unknown): BundlePolicy | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("规则包策略格式无效");
  const raw = value as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, sample] of Object.entries({ ...defaultBundlePolicy(), useExistingRules: false })) {
    const field = raw[key];
    if (field === undefined) continue;
    if (Array.isArray(sample)) {
      if (!Array.isArray(field) || field.some(item => typeof item !== "string")) throw new Error("规则包目标过滤格式无效");
    } else if (typeof field !== typeof sample) {
      throw new Error("规则包策略格式无效");
    }
    fields[key] = field;
  }
  if (fields.dnsMode === "system") fields.dnsMode = "system_native";
  if (fields.staleConnectionStrategy === "auto_close") fields.staleConnectionStrategy = "auto_reset";
  if (fields.staleConnectionStrategy === "keep") fields.staleConnectionStrategy = "ignore";
  const policy = normalizeBundlePolicy(fields as Partial<BundlePolicy>);
  if (!["safe_pure", "fake_ip", "system_native"].includes(policy.dnsMode)
    || !["all", "web_only", "custom"].includes(policy.portFilterMode)
    || !["all", "include", "exclude"].includes(policy.targetFilterMode)
    || !["prompt", "auto_reset", "ignore"].includes(policy.staleConnectionStrategy ?? "prompt")) {
    throw new Error("规则包策略选项无效");
  }
  return policy;
}

function packageDefinition(value: unknown) {
  const checked = validateAndParseBundlePackage(JSON.stringify(value));
  if (!checked.valid || !checked.bundle) throw new Error("规则包结构无效");
  const d = checked.bundle;
  const raw = value as Record<string, unknown>;
  const rawBundle = (raw?.bundle || raw) as Record<string, unknown>;
  if (typeof rawBundle?.packageId !== "string" || !/^[\w][\w.-]{0,127}$/.test(rawBundle.packageId)) throw new Error("仓库规则包须提供稳定的 packageId");
  for (const [v, max] of [[d.packageName, 160], [d.packageVersion, 64], [d.description, 4000], [d.icon, 32]] as const) if (typeof v !== "string" || v.length > max) throw new Error("规则包展示信息无效或过长");
  if (d.processes.some(p => p.exe.length > 260 || p.description.length > 512) || d.domains?.some(d => d.length > 253) || d.additionalExes && (d.additionalExes.length > 100 || d.additionalExes.some(e => e.length > 260))) throw new Error("规则包进程或域名信息过长");
  if (!Array.isArray(d.slots) || !d.slots.length || d.slots.length > 2 || !d.slots.some(s => s?.id === "main") || new Set(d.slots.map(s => s?.id)).size !== d.slots.length || d.slots.some(s => !s || !["main", "dns"].includes(s.id) || typeof s.name !== "string" || typeof s.description !== "string" || typeof s.required !== "boolean" || s.followSlotId !== undefined && s.followSlotId !== "main")) throw new Error("规则包出口插槽无效");
  if (d.additionalExes?.some(e => !e.trim() || /[/\\]/.test(e) || e.includes("..") || /^\d+$/.test(e))) throw new Error("规则包协同进程无效");
  const policy = repositoryPolicy(rawBundle.policy);
  return {
    ...d,
    slots: d.slots.map(({ id, name, description, required, followSlotId }) => ({ id, name, description, required, followSlotId })),
    ...(policy ? { policy } : {}),
  };
}

function githubPackageUrl(address: string, slug: string): string {
  const url = new URL(httpsUrl(address));
  if (url.hostname !== "raw.githubusercontent.com" || url.port || !url.pathname.toLowerCase().startsWith(`/${slug.toLowerCase()}/`)) {
    throw new Error("GitHub 返回的下载地址与所选仓库不符");
  }
  return url.href;
}

function requestThroughGithubProxy(request: RepositoryRequest, githubProxy: string): RepositoryRequest {
  const prefix = normalizeGithubProxy(githubProxy);
  if (!prefix) return request;
  return (url, signal, maxBytes) => request(httpsUrl(prefix + httpsUrl(url)), signal, maxBytes);
}

function githubDirectoryUrl(repo: BundleRepository): string {
  const slug = new URL(repo.url).pathname.slice(1);
  const folder = repo.directory ? `/${repo.directory.split("/").map(encodeURIComponent).join("/")}` : "";
  const ref = repo.branch ? `?ref=${encodeURIComponent(repo.branch)}` : "";
  return `https://api.github.com/repos/${slug}/contents${folder}${ref}`;
}

function githubFiles(repo: BundleRepository, data: unknown): string[] {
  if (!Array.isArray(data)) throw new Error("GitHub 地址须指向包含规则包的目录");
  if (data.length >= 1000) throw new Error("GitHub 目录过大，请指定较小的规则包目录");
  const slug = new URL(repo.url).pathname.slice(1);
  return data.filter(f => f && f.type === "file" && typeof f.name === "string" && f.name.endsWith(".pwpack.json"))
    .map(f => githubPackageUrl(f.download_url, slug));
}

async function readGithubJson(url: string, request: RepositoryRequest, signal: AbortSignal): Promise<unknown> {
  const text = await request(url, signal, FILE_LIMIT);
  if (signal.aborted) throw new Error("请求已取消");
  if (new TextEncoder().encode(text).byteLength > FILE_LIMIT) throw new Error("仓库文件超过 1 MB 上限");
  return parseJson(text);
}

export async function testGithubRepositoryConnection(repo: BundleRepository, request: RepositoryRequest, signal: AbortSignal, githubProxy: string): Promise<string> {
  if (repo.kind !== "github") throw new Error("请选择 GitHub 来源");
  const get = requestThroughGithubProxy(request, githubProxy);
  let files: string[];
  try {
    files = githubFiles(repo, await readGithubJson(githubDirectoryUrl(repo), get, signal));
  } catch (error) {
    throw new Error(`仓库目录读取失败，${error instanceof Error ? error.message : String(error)}`);
  }
  if (!files.length) return "仓库目录可读，暂无规则包可供下载测试";
  try {
    packageDefinition(await readGithubJson(files[0], get, signal));
  } catch (error) {
    throw new Error(`仓库目录可读，规则包下载测试失败，${error instanceof Error ? error.message : String(error)}`);
  }
  return "仓库目录读取和规则包下载均正常";
}

export async function downloadRepositoryPackage(repo: BundleRepository, item: RepositoryPackage, request: RepositoryRequest, signal: AbortSignal, githubProxy = ""): Promise<RepositoryPackage> {
  if (repo.kind !== "github" || !repo.enabled || repositoryKey(repo) !== item.origin.repositoryKey) throw new Error("仓库配置已变更，请刷新后重试");
  const url = githubPackageUrl(item.origin.packageUrl, new URL(repo.url).pathname.slice(1));
  const get = requestThroughGithubProxy(request, githubProxy);
  const definition = packageDefinition(await readGithubJson(url, get, signal));
  if (definition.packageId !== item.definition.packageId) throw new Error("仓库文件中的规则包已更换，请刷新后再挂载");
  return { ...item, definition };
}

export async function loadRepository(repo: BundleRepository, request: RepositoryRequest, signal: AbortSignal, githubProxy = ""): Promise<RepositoryCatalog> {
  const check = () => { if (signal.aborted) throw new Error("请求已取消"); };
  const requestFile = repo.kind === "github" ? requestThroughGithubProxy(request, githubProxy) : request;
  const fileLimit = FILE_LIMIT, reservations = new Set<Promise<void>>();
  let available = 5 * fileLimit;
  const get = async (url: string) => {
    check();
    // Reserve bytes before starting concurrent transfers; refund only known unused bytes.
    while (available < fileLimit && reservations.size) { await Promise.race(reservations); check(); }
    if (available <= 0) throw new Error("仓库内容超过 5 MB 上限");
    const limit = Math.min(fileLimit, available); available -= limit;
    let release!: () => void;
    const reservation = new Promise<void>(resolve => { release = resolve; }); reservations.add(reservation);
    try {
      const text = await requestFile(httpsUrl(url), signal, limit); check();
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > limit) throw new Error(limit === fileLimit ? "仓库文件超过 1 MB 上限" : "仓库内容超过 5 MB 上限");
      available += limit - bytes;
      return parseJson(text);
    } finally { reservations.delete(reservation); release(); }
  };
  let files: { url: string; inline?: unknown }[];
  if (repo.kind === "github") {
    files = githubFiles(repo, await get(githubDirectoryUrl(repo))).map(url => ({ url }));
  } else {
    const data = await get(repo.url) as Record<string, unknown>;
    if (data && !Array.isArray(data) && (data.bundle || data.packageId)) files = [{ url: repo.url, inline: data }];
    else {
      const entries = Array.isArray(data) ? data : data?.packages;
      if (!Array.isArray(entries)) throw new Error("索引须包含 packages 数组，或直接提供 .pwpack.json");
      if (entries.length > MAX_PACKAGES) throw new Error(`单仓库最多 ${MAX_PACKAGES} 个规则包`);
      files = entries.map((entry, i) => {
        if (typeof entry === "string") return { url: httpsUrl(entry, repo.url) };
        if (entry && typeof entry === "object" && typeof entry.url === "string") return { url: httpsUrl(entry.url, repo.url) };
        if (entry && typeof entry === "object" && (entry.bundle || entry.packageId)) return { url: `${repo.url}#item-${i}`, inline: entry };
        throw new Error(`索引第 ${i + 1} 项无效`);
      });
    }
  }
  if (files.length > MAX_PACKAGES) throw new Error(`单仓库最多 ${MAX_PACKAGES} 个规则包`);
  const results: ({ item: RepositoryPackage } | { warning: string })[] = new Array(files.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (cursor < files.length) {
      check(); const index = cursor++, file = files[index];
      try {
        const definition = packageDefinition(file.inline ?? await get(file.url)); check();
        const origin = { repositoryId: repo.id, repositoryName: repo.name, repositoryKey: repositoryKey(repo), packageUrl: file.url };
        results[index] = { item: { key: `${repo.id}:${definition.packageId}`, definition, origin } };
      } catch { check(); results[index] = { warning: `第 ${index + 1} 个规则包下载或校验失败` }; }
    }
  }));
  check();
  const packages: RepositoryPackage[] = [], warnings: string[] = [], ids = new Set<string>();
  for (const result of results) {
    if ("warning" in result) { warnings.push(result.warning); continue; }
    if (ids.has(result.item.definition.packageId)) { warnings.push(`同一仓库包含重复 packageId：${result.item.definition.packageId}`); continue; }
    ids.add(result.item.definition.packageId); packages.push(result.item);
  }
  if (files.length && !packages.length) throw new Error("仓库包含规则包文件，但全部下载或校验失败");
  return { packages, warnings };
}
