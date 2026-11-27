import { useCallback, useEffect, useRef, useState } from "react";
import { getLanAccessStatus, saveGeneralSettings, type GeneralSettingsPatch, type LanAccessStatus } from "../services/settingsService";

export function useLanAccess(running: boolean, mixedPort: number) {
  const [status, setStatus] = useState<LanAccessStatus | null>();
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    const next = await getLanAccessStatus(running).catch(() => null);
    if (id === request.current) setStatus(next);
    return next;
  }, [running]);

  useEffect(() => {
    let reading = false;
    const read = async () => {
      if (reading || saving.current) return;
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
  }, [refresh, mixedPort]);

  const save = async (patch: GeneralSettingsPatch) => {
    if (patch.allowLan === undefined) return { settings: await saveGeneralSettings(patch), status };
    if (saving.current) throw new Error("局域网设置正在应用");
    saving.current = true;
    ++request.current;
    setPending(true);
    try {
      const settings = await saveGeneralSettings(patch);
      return { settings, status: await refresh() };
    } catch (error) {
      await refresh();
      throw error;
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return {
    status, pending, refresh, save,
    checked: status ? (status.running ? status.effective === true : status.configured) : false,
  };
}

export type LanAccess = ReturnType<typeof useLanAccess>;

export function describeLanAccess(status: LanAccessStatus | null | undefined): string {
  if (status === undefined) return "正在读取";
  if (!status) return "状态读取失败";
  if (!status.running) return status.configured ? "已保存，启动后生效" : "核心已停止";
  if (status.effective === null) return "监听未确认";
  if (status.effective !== status.configured) return "设置未生效";
  return status.effective ? "局域网监听中" : "仅本机监听";
}
