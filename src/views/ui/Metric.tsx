/**
 * Metric-cell rendering shared by the results and failure-map tables.
 *
 * The one rule that matters here: missing data is an em dash, never a zero. A
 * run that recorded nothing did not score nothing, so the dash carries that
 * distinction everywhere a total would otherwise read as "0".
 */

export const dash = <span class="none">—</span>;

/**
 * A count, tinted only when it is non-zero.
 *
 * A green 0 passed and a red 0 failed both claim something the number does not,
 * so the colour is reserved for counts that actually happened.
 */
export function count(value: number | null, tone: 'pass' | 'fail' | 'warn') {
  if (value === null) return dash;
  return <b class={value > 0 ? tone : undefined}>{value}</b>;
}

/** A share of a total, as the group beside it defines it. */
export function rate(part: number | null, total: number | null) {
  if (part === null || total === null || total === 0) return dash;
  return `${((part / total) * 100).toFixed(1)}%`;
}
