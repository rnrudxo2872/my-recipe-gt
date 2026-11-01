import { Minus, Plus } from "lucide-react";
import { formatQty } from "../../shared/recipe";

/** 양을 −/+로 조절한다. 단위는 옆에 붙여 보여 준다. */
export function AmountStepper(props: {
  value: number;
  unit: string;
  step: number;
  max?: number;
  min?: number;
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
}) {
  const { value, unit, step, max, min = 0, disabled, label, onChange } = props;
  const fix = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <span className="amount-stepper" role="group" aria-label={label}>
      <button type="button" disabled={disabled || value <= min} aria-label={`${label} 줄이기`} onClick={() => onChange(Math.max(min, fix(value - step)))}>
        <Minus />
      </button>
      <output className="num" aria-live="polite">
        {value > 0 ? formatQty(value) : "0"}
        {unit}
      </output>
      <button
        type="button"
        disabled={disabled || (max != null && value >= max)}
        aria-label={`${label} 늘리기`}
        onClick={() => onChange(max != null ? Math.min(max, fix(value + step)) : fix(value + step))}
      >
        <Plus />
      </button>
    </span>
  );
}
