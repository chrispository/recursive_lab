export function Bar({ value, below = false, tone, label = 'reward' }: {
  value: number | null;
  below?: boolean;
  /** Colours the fill by job status. Omit for the default reward green. */
  tone?: string;
  /** What the fill measures, for the accessible name. */
  label?: string;
}) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div class="m-bar" aria-label={value === null ? `No ${label} measured` : `${percent.toFixed(1)}% ${label}`}>
      <span class="m-bar-track">
        <b
          class="m-bar-fill"
          data-below={below ? '1' : undefined}
          data-tone={tone}
          style={`width:${percent}%`}
        />
      </span>
    </div>
  );
}
