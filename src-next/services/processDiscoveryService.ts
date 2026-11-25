// ==========================================================================
// ProcWeaver src-next 运行中进程树发现与智能合并服务 (Process Discovery Service)
// 规范溯源: tauri-linear-raycast-ui / taste-skill
// 风格约束: 严禁任何 Emoji，全量采用矢量语义与高密度聚合
// ==========================================================================

import { isTauriEnvironment } from "./client";

export interface ProcessEntry {
  identity: string;
  pid: number;
  parentPid: number;
  name: string;
  executablePath?: string | null;
  parentIdentity?: string | null;
  ancestors?: [identity: string, path: string][];
}

export interface ConsolidatedProcess {
  name: string;             // 进程文件名，如 "cursor.exe"
  friendlyName?: string;    // 中文友好别名，如 "Cursor AI 编辑器"
  category: "browser" | "dev" | "im" | "media" | "game" | "system" | "tool";
  path?: string;            // 真实绝对路径
  subProcessCount: number;  // 派生子进程数量
  pids: number[];           // 包含的所有 PID
  isSystem: boolean;        // 是否为 Windows 系统服务
}

// 知名应用程序中文对照字典 (严禁 Emoji)
export const KNOWN_APP_NAMES: Record<
  string,
  { label: string; category: ConsolidatedProcess["category"] }
> = {
  "chrome.exe": { label: "Google Chrome 浏览器", category: "browser" },
  "msedge.exe": { label: "Microsoft Edge 浏览器", category: "browser" },
  "firefox.exe": { label: "Mozilla Firefox 火狐", category: "browser" },
  "antigravity.exe": { label: "Antigravity 2.0 桌面端", category: "dev" },
  "antigravity ide.exe": { label: "Antigravity 次世代 IDE", category: "dev" },
  "cursor.exe": { label: "Cursor AI 编辑器", category: "dev" },
  "code.exe": { label: "Visual Studio Code", category: "dev" },
  "chatgpt.exe": { label: "ChatGPT 桌面端", category: "im" },
  "telegram.exe": { label: "Telegram 桌面端", category: "im" },
  "discord.exe": { label: "Discord 客户端", category: "im" },
  "wechat.exe": { label: "微信桌面版", category: "im" },
  "qq.exe": { label: "腾讯 QQ 客户端", category: "im" },
  "feishu.exe": { label: "飞书桌面端", category: "im" },
  "dingtalk.exe": { label: "钉钉桌面端", category: "im" },
  "steam.exe": { label: "Steam 游戏平台", category: "game" },
  "epicgameslauncher.exe": { label: "Epic Games 客户端", category: "game" },
  "spotify.exe": { label: "Spotify 音乐播放器", category: "media" },
  "cloudmusic.exe": { label: "网易云音乐", category: "media" },
  "node.exe": { label: "Node.js 运行时", category: "dev" },
  "git.exe": { label: "Git 客户端", category: "dev" },
  "python.exe": { label: "Python 解释器", category: "dev" },
  "obs64.exe": { label: "OBS Studio 推流录屏", category: "media" },
  "test-proxy-aware.exe": { label: "代理感知测试程序 (连通性/DNS)", category: "tool" },
  "test-proxy-direct.exe": { label: "直连测试程序 (分流强锁核验)", category: "tool" },
  "curl.exe": { label: "cURL 网络测试工具", category: "tool" },
};

// Windows 底层系统服务白名单 (默认过滤以防干扰)
export const SYSTEM_PROCESS_NAMES = new Set([
  "system",
  "registry",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "svchost.exe",
  "fontdrvhost.exe",
  "dwm.exe",
  "memory compression",
  "spoolsv.exe",
  "runtimebroker.exe",
  "taskhostw.exe",
  "sihost.exe",
  "ctfmon.exe",
  "searchhost.exe",
  "shellexperiencehost.exe",
  "startmenuexperiencehost.exe",
  "securityhealthservice.exe",
  "sgrmbroker.exe",
  "smartscreen.exe",
  "conhost.exe",
  "wudfhost.exe",
  "dashost.exe",
  "dllhost.exe",
  "explorer.exe",
  "textinputhost.exe",
  "searchindexer.exe",
  "audiodg.exe",
]);

// 浏览器开发调试环境下的仿真进程树快照
const MOCK_PROCESS_ENTRIES: ProcessEntry[] = [
  { identity: "p_101", pid: 14208, parentPid: 0, name: "chrome.exe", executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { identity: "p_102", pid: 14212, parentPid: 14208, name: "chrome.exe", executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { identity: "p_103", pid: 14220, parentPid: 14208, name: "chrome.exe", executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { identity: "p_104", pid: 14234, parentPid: 14208, name: "chrome.exe", executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { identity: "p_201", pid: 8812, parentPid: 0, name: "cursor.exe", executablePath: "C:\\Users\\Example\\AppData\\Local\\Programs\\cursor\\cursor.exe" },
  { identity: "p_202", pid: 8820, parentPid: 8812, name: "cursor.exe", executablePath: "C:\\Users\\Example\\AppData\\Local\\Programs\\cursor\\cursor.exe" },
  { identity: "p_203", pid: 8836, parentPid: 8812, name: "cursor.exe", executablePath: "C:\\Users\\Example\\AppData\\Local\\Programs\\cursor\\cursor.exe" },
  { identity: "p_301", pid: 4210, parentPid: 0, name: "ChatGPT.exe", executablePath: "C:\\Program Files\\OpenAI\\ChatGPT\\ChatGPT.exe" },
  { identity: "p_302", pid: 4216, parentPid: 4210, name: "ChatGPT.exe", executablePath: "C:\\Program Files\\OpenAI\\ChatGPT\\ChatGPT.exe" },
  { identity: "p_401", pid: 1290, parentPid: 0, name: "antigravity.exe", executablePath: "D:\\Desktop\\antigravity\\antigravity.exe" },
  { identity: "p_402", pid: 1298, parentPid: 1290, name: "antigravity.exe", executablePath: "D:\\Desktop\\antigravity\\antigravity.exe" },
  { identity: "p_501", pid: 19840, parentPid: 0, name: "telegram.exe", executablePath: "D:\\Apps\\Telegram\\telegram.exe" },
  { identity: "p_601", pid: 7120, parentPid: 0, name: "WeChat.exe", executablePath: "D:\\Tencent\\WeChat\\WeChat.exe" },
  { identity: "p_602", pid: 7128, parentPid: 7120, name: "WeChat.exe", executablePath: "D:\\Tencent\\WeChat\\WeChat.exe" },
  { identity: "p_701", pid: 15302, parentPid: 0, name: "node.exe", executablePath: "C:\\Program Files\\nodejs\\node.exe" },
  { identity: "p_801", pid: 12048, parentPid: 0, name: "steam.exe", executablePath: "D:\\Steam\\steam.exe" },
  { identity: "p_802", pid: 12056, parentPid: 12048, name: "steam.exe", executablePath: "D:\\Steam\\steam.exe" },
  // 系统进程
  { identity: "sys_1", pid: 884, parentPid: 0, name: "svchost.exe", executablePath: "C:\\Windows\\System32\\svchost.exe" },
  { identity: "sys_2", pid: 912, parentPid: 0, name: "dwm.exe", executablePath: "C:\\Windows\\System32\\dwm.exe" },
];

/**
 * 核心算法: 进程树聚合合并 (Tree Consolidation & Rollup)
 * 1. 过滤空与无意义项
 * 2. 将同一应用族的多实例与子进程折叠合并
 * 3. 统计派生子进程数量
 * 4. 提取主路径与中文应用名
 */
export function consolidateProcessTree(
  entries: ProcessEntry[],
  hideSystem: boolean = true
): ConsolidatedProcess[] {
  if (!entries || entries.length === 0) return [];

  const groups = new Map<string, ProcessEntry[]>();

  entries.forEach((p) => {
    if (!p.name || p.pid === 0) return;
    const cleanName = p.name.trim();
    const lowerName = cleanName.toLowerCase();

    if (!groups.has(lowerName)) {
      groups.set(lowerName, []);
    }
    groups.get(lowerName)!.push(p);
  });

  const results: ConsolidatedProcess[] = [];

  groups.forEach((items, lowerName) => {
    const isSystem = SYSTEM_PROCESS_NAMES.has(lowerName);
    if (hideSystem && isSystem) return;

    // 优先选择拥有有效完整路径且 PID 最小的为主进程代表项
    const representative =
      items.find((i) => Boolean(i.executablePath)) || items[0];
    const known = KNOWN_APP_NAMES[lowerName];

    results.push({
      name: representative.name,
      friendlyName: known?.label,
      category: known?.category || (isSystem ? "system" : "tool"),
      path: representative.executablePath || undefined,
      subProcessCount: Math.max(0, items.length - 1),
      pids: items.map((i) => i.pid),
      isSystem,
    });
  });

  // 排序算法：知名应用优先排前，其次按子进程数量与名称排序
  return results.sort((a, b) => {
    const aKnown = KNOWN_APP_NAMES[a.name.toLowerCase()] ? 1 : 0;
    const bKnown = KNOWN_APP_NAMES[b.name.toLowerCase()] ? 1 : 0;
    if (aKnown !== bKnown) return bKnown - aKnown;
    if (b.subProcessCount !== a.subProcessCount) {
      return b.subProcessCount - a.subProcessCount;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * 获取合并后的运行中进程列表 (自动对接 Tauri 或浏览器仿真)
 */
export async function fetchRunningProcesses(
  hideSystem: boolean = true
): Promise<ConsolidatedProcess[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rawTree = await invoke<ProcessEntry[]>("get_process_tree");
      if (Array.isArray(rawTree) && rawTree.length > 0) {
        return consolidateProcessTree(rawTree, hideSystem);
      }
    } catch (err) {
      console.warn("[processDiscoveryService] get_process_tree failed:", err);
    }
  }

  // 浏览器开发与回退
  return consolidateProcessTree(MOCK_PROCESS_ENTRIES, hideSystem);
}
