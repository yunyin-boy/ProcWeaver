import { EngineMode } from "../types/core";

export const ROUTING_MODES = [
  { id: "rule", label: "规则" },
  { id: "global", label: "全局" },
  { id: "direct", label: "直连" },
] as const;

interface RoutingModeControlProps {
  mode: string;
  onChange: (mode: EngineMode) => void;
  disabled?: boolean;
}

export function RoutingModeControl({ mode, onChange, disabled }: RoutingModeControlProps) {
  return (
    <div className="workbench-segments" role="group" aria-label="分流模式">
      {ROUTING_MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          aria-pressed={mode.toLowerCase() === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
