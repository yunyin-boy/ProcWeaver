import { useCallback, useEffect, useRef, useState } from "react";
import { getTunStatus, setTunEnabled, type TunStatus } from "../services/settingsService";
import { PROCESS_DRIVER_OPTIONS, type CaptureMode } from "../types/processRouting";

export function useTunAccess(running: boolean) {
  const [{ status, checked }, setSnapshot] = useState<{ status?: TunStatus | null; checked: boolean }>({ checked: false });
  const [pending, setPending] = useState(false);
  const changing = useRef(false);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    const next = await getTunStatus(running).catch(() => null);
    if (id === request.current) {
      setSnapshot((previous) => ({
        status: next,
        checked: next ? (next.running ? next.effective ?? previous.checked : next.configured) : previous.checked,
      }));
    }
    return next;
  }, [running]);

  useEffect(() => {
    let reading = false;
    const read = async () => {
      if (reading || changing.current) return;
      reading = true;
      try { await refresh(); }
      finally { reading = false; }
    };
    void read();
    const timer = window.setInterval(() => void read(), 2000);
    return () => {
      window.clearInterval(timer);
      ++request.current;
    };
  }, [refresh]);

  const apply = async <T,>(operation: () => Promise<T>) => {
    if (changing.current) throw new Error("接管方式正在切换");
    changing.current = true;
    ++request.current;
    setPending(true);
    try {
      const result = await operation();
      return { result, status: await refresh() };
    } catch (error) {
      await refresh();
      throw error;
    } finally {
      changing.current = false;
      setPending(false);
    }
  };

  return {
    status, pending, refresh, apply, checked,
    change: (enabled: boolean) => apply(() => setTunEnabled(enabled)),
  };
}

export type TunAccess = ReturnType<typeof useTunAccess>;

export const HOOK_RESTART_NOTICE = "已运行的目标程序需要在进程分流页受控重启";

export function captureModeName(mode: CaptureMode): string {
  return mode === "tun" ? "TUN 虚拟网卡" : PROCESS_DRIVER_OPTIONS.find((option) => option.id === mode)!.title;
}

export function describeCaptureMode(status: TunStatus | null | undefined, pending = false): string {
  if (pending) return "正在切换…";
  if (status === undefined) return "正在读取";
  if (!status) return "状态读取失败";
  if (status.activeMode) return captureModeName(status.activeMode);
  if (!status.running) return "核心已停止";
  return `${captureModeName(status.configuredMode)} · 待就绪`;
}

export function describeTunStatus(status: TunStatus | null | undefined): string {
  if (status === undefined) return "正在读取";
  if (!status) return "状态读取失败";
  if (!status.supported) return "当前系统不支持";
  if (!status.running) {
    if (status.configured) return status.detail ? "核心启动失败" : "启动后应用";
    return "已停用";
  }
  if (status.effective === null) return "状态未确认";
  if (status.effective) return status.autoRoute ? "自动路由就绪" : "网卡就绪 · 手动路由";
  return status.configured ? "尚未生效" : "已停用";
}
