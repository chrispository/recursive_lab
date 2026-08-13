/** SQL for the lineage. Replaces the old `workflow_lineages` view. */
import { all, json, one, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import { step, type Lineage } from './model.ts';

type LineageRow = Row & {
  run_id: number;
  label: string;
  model: string;
  metrics_json: string;
  failure_map_id: number | null;
  taxonomy_id: number | null;
  forge_run_id: number | null;
  failure_count: number;
  topic_count: number;
  document_count: number;
  environment_count: number;
};

/**
 * One row per benchmark run, carrying the id of every downstream entity and the
 * counts under each. The cardinality guarantees (one FM per BR, one TX per FM,
 * one DF per FM) are what let these be plain LEFT JOINs rather than subqueries.
 */
const SELECT = `
  SELECT br.id                AS run_id,
         br.label             AS label,
         br.model             AS model,
         br.metrics_json      AS metrics_json,
         fm.id                AS failure_map_id,
         tx.id                AS taxonomy_id,
         df.id                AS forge_run_id,
         (SELECT count(*) FROM failure_items   WHERE failure_map_id = fm.id) AS failure_count,
         (SELECT count(*) FROM taxonomy_topics WHERE taxonomy_id    = tx.id) AS topic_count,
         (SELECT count(*) FROM documents       WHERE forge_run_id   = df.id) AS document_count,
         (SELECT count(*) FROM environments    WHERE run_id         = br.id) AS environment_count
    FROM benchmark_runs br
    LEFT JOIN failure_maps fm ON fm.run_id         = br.id
    LEFT JOIN taxonomies   tx ON tx.failure_map_id = fm.id
    LEFT JOIN forge_runs   df ON df.failure_map_id = fm.id`;

function toLineage(row: LineageRow): Lineage {
  const metrics = json<{ pass_rate?: number }>(row.metrics_json, {});
  return {
    runId: row.run_id,
    runCode: code('benchmark_runs', row.run_id),
    label: row.label,
    model: row.model,
    passRate: metrics.pass_rate ?? null,
    failureMap: step('failure_maps', row.failure_map_id, row.failure_count),
    taxonomy: step('taxonomies', row.taxonomy_id, row.topic_count),
    forgeRun: step('forge_runs', row.forge_run_id, row.document_count),
    environments: step('benchmark_runs', row.environment_count ? row.run_id : null, row.environment_count),
  };
}

export async function findByRun(runId: number): Promise<Lineage | null> {
  const row = await one<LineageRow>(`${SELECT} WHERE br.id = ?`, [runId]);
  return row ? toLineage(row) : null;
}

/** Most recent run first — the app's default "current" run is the newest. */
export async function listAll(): Promise<Lineage[]> {
  const rows = await all<LineageRow>(`${SELECT} ORDER BY br.created_at DESC, br.id DESC`);
  return rows.map(toLineage);
}
