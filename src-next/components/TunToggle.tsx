import { CapsuleToggle } from "../primitives/CapsuleToggle";
import { captureModeName, describeTunStatus, HOOK_RESTART_NOTICE, type TunAccess } from "../utils/useTunAccess";

export function TunToggle({ access, disabled, onShowNotice }: {
  access: TunAccess;
  disabled?: boolean;
  onShowNotice?: (message: string) => void;
}) {
  const change = async (enabled: boolean) => {
    try {
      const { result, status } = await access.change(enabled);
      const mode = result.trafficMode;
      if (enabled) {
        onShowNotice?.(`TUN · ${describeTunStatus(status)}`);
      } else if (status?.activeMode === mode) {
        const reminder = mode === "user_mode" ? `。${HOOK_RESTART_NOTICE}` : "";
        onShowNotice?.(`TUN 已关闭，已恢复${captureModeName(mode)}${reminder}`);
      } else if (status && !status.running) {
        onShowNotice?.(`已保存${captureModeName(mode)}，启动核心后应用`);
      } else {
        onShowNotice?.(describeTunStatus(status));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onShowNotice?.(`TUN 切换失败，${detail}`);
    }
  };
  return (
    <div className="workbench-network-switch-row">
      <div className="min-w-0">
        <div>TUN 虚拟网卡</div>
        <div role="status" title={access.status?.detail ?? undefined} className="text-[10px] font-normal text-[var(--text-muted)]">
          {access.pending ? "正在应用…" : describeTunStatus(access.status)}
        </div>
      </div>
      <CapsuleToggle title="TUN 虚拟网卡" checked={access.checked} disabled={disabled || access.pending || !access.status?.supported}
        onChange={(checked) => void change(checked)} />
    </div>
  );
}
