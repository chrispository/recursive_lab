/**
 * Display codes for entity ids.
 *
 * Primary keys are plain autoincrementing integers. The code a human sees —
 * `FM-00004`, `TP-00012`, `DOC-00031` — is a pure function of the table and that integer,
 * defined here and nowhere else.
 *
 * The previous app generated twelve random hex characters per row
 * (`FM-1E1A9BEE1A8E`), which no one could hold in their head or compare at a
 * glance. If a distributed/merge scenario ever appears, `code` and `parse` are
 * the only two functions that need to change.
 */

export const PREFIX = {
  benchmarks: 'BM',
  benchmark_runs: 'BR',
  benchmarks_results: 'BTR',
  failure_maps: 'FM',
  failure_items: 'FI',
  topics: 'TP',
  data_forge_runs: 'DF',
  documents: 'DOC',
  verifiers: 'VF',
  environments: 'ENV',
  environment_evaluations: 'EE',
  prompt_templates: 'PRM',
  prompt_revisions: 'REV',
  jobs: 'JOB',
} as const;

export type Entity = keyof typeof PREFIX;

/** Reverse lookup, built once so `parse` stays O(1). */
const BY_PREFIX = new Map<string, Entity>(
  Object.entries(PREFIX).map(([entity, prefix]) => [prefix, entity as Entity]),
);

/** `code('failure_maps', 4)` → `'FM-00004'`. */
export const code = (entity: Entity, id: number): string =>
  `${PREFIX[entity]}-${String(id).padStart(5, '0')}`;

/**
 * `parse('FM-00004')` → `{ entity: 'failure_maps', id: 4 }`, or null if the string
 * is not a code we mint. Callers must handle null — it is user input.
 */
export function parse(value: string): { entity: Entity; id: number } | null {
  const dash = value.lastIndexOf('-');
  if (dash < 1) return null;

  const entity = BY_PREFIX.get(value.slice(0, dash).toUpperCase());
  const id = Number(value.slice(dash + 1));
  if (!entity || !Number.isInteger(id) || id < 1) return null;

  return { entity, id };
}
