/**
 * A reward meter with a threshold notch — the card's core visual.
 * `value` is 0..1 reward; `threshold` draws the pass floor as a notch.
 */
export function Meter({ value, threshold, state, label }: {
  value: number | null;
  threshold: number;
  state: 'pass' | 'fail' | 'error' | 'none';
  label: string;
}) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  const notch = Math.max(0, Math.min(100, threshold * 100));
  return (
    <span
      class="m-meter"
      data-state={state}
      style={`--value:${percent}%;--threshold:${notch}%`}
      role="img"
      aria-label={value === null
        ? `${label} not measured`
        : `${label} ${value.toFixed(3)} against threshold ${threshold.toFixed(2)}`}
    >
      <i aria-hidden="true" />
      <b aria-hidden="true" />
    </span>
  );
}
