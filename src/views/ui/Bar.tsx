export function Bar({ value, below = false }: { value: number | null; below?: boolean }) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div class="m-bar" aria-label={value === null ? 'No reward measured' : `${percent.toFixed(1)}% reward`}>
      <span class="m-bar-track">
        <b class="m-bar-fill" data-below={below ? '1' : undefined} style={`width:${percent}%`} />
      </span>
    </div>
  );
}
