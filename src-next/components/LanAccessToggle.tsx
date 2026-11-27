import { CapsuleToggle } from "../primitives/CapsuleToggle";
import { describeLanAccess, type LanAccess } from "../utils/useLanAccess";

export function LanAccessToggle({ access, disabled, onShowNotice }: {
  access: LanAccess;
  disabled?: boolean;
  onShowNotice?: (message: string) => void;
}) {
  const change = async (allowLan: boolean) => {
    try {
      const { status } = await access.save({ allowLan });
      onShowNotice?.(`局域网访问 · ${describeLanAccess(status)}`);
    } catch (error) {
      onShowNotice?.(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="workbench-network-switch-row">
      <div className="min-w-0">
        <div>允许局域网</div>
        <div role="status" className="text-[10px] font-normal text-[var(--text-muted)]">
          {access.pending ? "正在应用…" : describeLanAccess(access.status)}
        </div>
      </div>
      <CapsuleToggle title="允许局域网" checked={access.checked} disabled={disabled || access.pending || !access.status}
        onChange={(checked) => void change(checked)} />
    </div>
  );
}
