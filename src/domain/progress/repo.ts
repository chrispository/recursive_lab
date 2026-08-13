/** SQL for pipeline progress. Replaces the old `workflow_lineages` view. */
import { all, json, one, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import { step, type Progress } from './model.ts';

type ProgressRow = Row & {
  run_id: number;
  label: string;
  model: string;
  metrics_json: string;
  benchmark_result_id: number | null;
  failure_map_id: number | null;
  data_forge_run_id: number | null;
  failure_count: number;
  topic_count: number;
  document_count: number;
  environment_count: number;
};

/**
 * One row per benchmark run, carrying the id of every downstream entity and the
 * counts under each. Results and failure maps are task-scoped, so the current
 * run read model selects the newest downstream row while aggregating counts
 * across every result in the run.
 */
const SELECT = `
  SELECT br.id                AS run_id,
         br.label             AS label,
         br.model             AS model,
         br.metrics_json      AS metrics_json,
         (SELECT r.id FROM benchmarks_results r
           WHERE r.benchmark_run_id = br.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS benchmark_result_id,
         (SELECT fm.id FROM failure_maps fm JOIN benchmarks_results r ON r.id = fm.benchmark_result_id
           WHERE r.benchmark_run_id = br.id ORDER BY fm.created_at DESC, fm.id DESC LIMIT 1) AS failure_map_id,
         (SELECT df.id FROM data_forge_runs df JOIN failure_maps fm ON fm.id = df.failure_map_id
           JOIN benchmarks_results r ON r.id = fm.benchmark_result_id
           WHERE r.benchmark_run_id = br.id ORDER BY df.created_at DESC, df.id DESC LIMIT 1) AS data_forge_run_id,
         (SELECT count(*) FROM failure_items fi JOIN failure_maps fm ON fm.id = fi.failure_map_id
           JOIN benchmarks_results r ON r.id = fm.benchmark_result_id WHERE r.benchmark_run_id = br.id) AS failure_count,
         (SELECT count(*) FROM topics tp JOIN failure_maps fm ON fm.id = tp.failure_map_id
           JOIN benchmarks_results r ON r.id = fm.benchmark_result_id WHERE r.benchmark_run_id = br.id) AS topic_count,
         (SELECT count(*) FROM documents d JOIN data_forge_runs df ON df.id = d.data_forge_run_id
           JOIN failure_maps fm ON fm.id = df.failure_map_id
           JOIN benchmarks_results r ON r.id = fm.benchmark_result_id WHERE r.benchmark_run_id = br.id) AS document_count,
         (SELECT count(*) FROM environments    WHERE run_id         = br.id) AS environment_count
    FROM benchmark_runs br
`;

function toProgress(row: ProgressRow): Progress {
  const metrics = json<{ pass_rate?: number }>(row.metrics_json, {});
  return {
    runId: row.run_id,
    runCode: code('benchmark_runs', row.run_id),
    label: row.label,
    model: row.model,
    passRate: metrics.pass_rate ?? null,
    benchmarkResult: step('benchmarks_results', row.benchmark_result_id, 1),
    failureMapId: row.failure_map_id,
    failureMap: step('failure_maps', row.failure_map_id, row.failure_count),
    topicCount: row.topic_count,
    dataForgeRun: step('data_forge_runs', row.data_forge_run_id, row.document_count),
    environments: step('benchmark_runs', row.environment_count ? row.run_id : null, row.environment_count),
  };
}

export async function findByRun(runId: number): Promise<Progress | null> {
  const row = await one<ProgressRow>(`${SELECT} WHERE br.id = ?`, [runId]);
  return row ? toProgress(row) : null;
}

/** Most recent run first — the app's default "current" run is the newest. */
export async function listAll(): Promise<Progress[]> {
  const rows = await all<ProgressRow>(`${SELECT} ORDER BY br.created_at DESC, br.id DESC`);
  return rows.map(toProgress);
}
