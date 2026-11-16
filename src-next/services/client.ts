// ==========================================================================
// ProcWeaver src-next 通信底座与双模适配网关
// 规范溯源: rust-pro (IPC 契约与防崩溃设计)
// ==========================================================================

export const isTauriEnvironment = (): boolean => {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    Boolean((window as any).__TAURI_POST_MESSAGE__) ||
    Boolean((window as any).__TAURI_IPC__)
  );
};

/**
 * 统一执行 Tauri Command，在纯浏览器开发模式下自动由 MockAdapter 兜底
 */
export async function invokeCommand<T>(
  cmd: string,
  args?: Record<string, unknown>,
  mockFallback?: () => Promise<T> | T
): Promise<T> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<T>(cmd, args);
    } catch (err: unknown) {
      // 结构化提取 Rust 返回的错误，杜绝未处理异常
      console.error(`[Tauri IPC Error: ${cmd}]`, err);
      throw err;
    }
  }

  // 纯浏览器环境执行 Mock 适配
  if (mockFallback) {
    return await mockFallback();
  }

  throw new Error(`[MockAdapter] 未为命令 "${cmd}" 提供纯前端调试模拟数据`);
}
