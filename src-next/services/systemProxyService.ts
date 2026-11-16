// ==========================================================================
// ProcWeaver src-next 系统代理中枢服务
// 规范溯源: rust-pro (系统代理接管与注册表状态感知)
// 对接指令: set_system_proxy, get_system_proxy_status
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";

let mockProxyActive = false;

export async function toggleSystemProxy(
  enable?: boolean,
  port: number = 7890
): Promise<boolean> {
  const current = await getSystemProxyState();
  const targetEnable = enable !== undefined ? enable : !current;

  if (isTauriEnvironment()) {
    return invokeCommand<boolean>("set_system_proxy", { enable: targetEnable, port });
  }

  // 纯前端开发模式模拟
  mockProxyActive = targetEnable;
  return new Promise((resolve) => setTimeout(() => resolve(mockProxyActive), 150));
}

export async function getSystemProxyState(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await invokeCommand<boolean>("get_system_proxy_status");
    } catch (e) {
      console.warn("[systemProxyService] get_system_proxy_status failed:", e);
      return false;
    }
  }
  return mockProxyActive;
}
