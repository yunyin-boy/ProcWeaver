// ==========================================================================
// ProcWeaver src-next 桌面视口与窗口生命周期通信服务
// 规范溯源: tauri-desktop-layout-typography / rust-pro (IPC 契约)
// ==========================================================================

import { invokeCommand, isTauriEnvironment } from "./client";

/**
 * 最小化窗口至任务栏 (调用 Rust 专有 IPC 命令)
 */
export async function windowMinimize(): Promise<void> {
  if (!isTauriEnvironment()) {
    console.log("[Mock] windowMinimize");
    return;
  }
  return await invokeCommand<void>("window_minimize", undefined, () => {});
}

/**
 * 启动窗口物理拖拽 (直接调用 Rust 后端底层 window_start_dragging)
 */
export async function windowStartDragging(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  return await invokeCommand<void>("window_start_dragging", undefined, () => {});
}

/**
 * 切换窗口最大化 / 还原
 */
export async function windowToggleMaximize(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    console.log("[Mock] windowToggleMaximize");
    return false;
  }
  return await invokeCommand<boolean>("window_toggle_maximize", undefined, () => false);
}

/**
 * 查询当前窗口是否处于最大化状态
 */
export async function windowIsMaximized(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }
  return await invokeCommand<boolean>("window_is_maximized", undefined, () => false);
}

/**
 * 触发窗口关闭请求
 * 遵循系统设置中的 close_action: "minimize" (进托盘) | "exit" (退出) | "ask" (抛出事件由前端弹窗)
 */
export async function windowClose(): Promise<void> {
  // 零延迟双保险：第一时间直接派发前端事件唤醒关闭模态框
  window.dispatchEvent(new CustomEvent("netbox-request-close"));

  if (isTauriEnvironment()) {
    try {
      await invokeCommand<void>("window_close");
    } catch (err) {
      console.warn("[windowService] 调用 window_close 发生非致命异常:", err);
    }
  }
}

/**
 * 用户在弹窗确认后执行确定的关闭动作
 * @param action "minimize" (隐藏到托盘) | "exit" (彻底退出应用)
 * @param remember 是否记住本次选择
 */
export async function windowExecuteClose(
  action: "minimize" | "exit",
  remember: boolean = false
): Promise<void> {
  if (!isTauriEnvironment()) {
    console.log(`[Mock] windowExecuteClose: action=${action}, remember=${remember}`);
    return;
  }
  return await invokeCommand<void>(
    "window_execute_close",
    { action, remember },
    () => {}
  );
}

/**
 * 切换窗口置顶状态
 */
export async function windowSetAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  return await invokeCommand<void>(
    "window_set_always_on_top",
    { alwaysOnTop },
    () => {}
  );
}

/**
 * 切换窗口形态 (mini: 380x580 迷你桌面挂件 / standard: 1160x740 标准大窗口)
 */
export async function windowSetFormFactor(factor: "mini" | "compact" | "standard"): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  return await invokeCommand<void>(
    "window_set_form_factor",
    { factor },
    () => {}
  );
}
