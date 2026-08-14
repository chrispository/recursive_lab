/** SQL for pipeline progress. Replaces the old `workflow_lineages` view. */
import { all, one, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import { step, type BenchmarkRunProgress } from './model.ts';

type ProgressDbRow = Row & {
  benchmark_run_id: number;
  label: string;
  model: string;
  pass_rate: number | null;
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
 * counts under each. `benchmark_results` is unique per run, so the subselects
 * below take the newest of each downstream row and count across all of them —
 * which is the same thing today, and stays correct if a run ever grows a
 * second result.
 */
const SELECT = `
  SELECT br.id                AS benchmark_run_id,
         br.label             AS label,
         br.model             AS model,
         -- The column, not metrics_json: both are written, and a rail reading
         -- the JSON copy goes blank whenever the two drift.
         result.pass_rate     AS pass_rate,
         (SELECT r.id FROM benchmark_results r
           WHERE r.benchmark_run_id = br.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS benchmark_result_id,
         (SELECT fm.id FROM failure_maps fm JOIN benchmark_results r ON r.id = fm.benchmark_result_id
           WHERE r.benchmark_run_id = br.id ORDER BY fm.created_at DESC, fm.id DESC LIMIT 1) AS failure_map_id,
         (SELECT df.id FROM data_forge_runs df JOIN failure_maps fm ON fm.id = df.failure_map_id
           JOIN benchmark_results r ON r.id = fm.benchmark_result_id
           WHERE r.benchmark_run_id = br.id ORDER BY df.created_at DESC, df.id DESC LIMIT 1) AS data_forge_run_id,
         (SELECT count(*) FROM failure_items fi JOIN failure_maps fm ON fm.id = fi.failure_map_id
           JOIN benchmark_results r ON r.id = fm.benchmark_result_id WHERE r.benchmark_run_id = br.id) AS failure_count,
         (SELECT count(*) FROM topics tp JOIN failure_maps fm ON fm.id = tp.failure_map_id
           JOIN benchmark_results r ON r.id = fm.benchmark_result_id WHERE r.benchmark_run_id = br.id) AS topic_count,
         (SELECT count(*) FROM documents d JOIN data_forge_runs df ON df.id = d.data_forge_run_id
           JOIN failure_maps fm ON fm.id = df.failure_map_id
           JOIN benchmark_results r ON r.id = fm.benchmark_result_id WHERE r.benchmark_run_id = br.id) AS document_count,
         (SELECT count(*) FROM environments    WHERE benchmark_run_id = br.id) AS environment_count
    FROM benchmark_runs br
    LEFT JOIN benchmark_results result ON result.benchmark_run_id = br.id
`;

function toProgress(row: ProgressDbRow): BenchmarkRunProgress {
  return {
    benchmarkRunId: row.benchmark_run_id,
    benchmarkRunCode: code('benchmark_runs', row.benchmark_run_id),
    label: row.label,
    model: row.model,
    passRate: row.pass_rate,
    benchmarkResult: step('benchmark_results', row.benchmark_result_id, 1),
    failureMapId: row.failure_map_id,
    failureMap: step('failure_maps', row.failure_map_id, row.failure_count),
    topicCount: row.topic_count,
    dataForgeRun: step('data_forge_runs', row.data_forge_run_id, row.document_count),
    environments: step('benchmark_runs', row.environment_count ? row.benchmark_run_id : null, row.environment_count),
  };
}

export async function findByBenchmarkRun(benchmarkRunId: number): Promise<BenchmarkRunProgress | null> {
  const row = await one<ProgressDbRow>(`${SELECT} WHERE br.id = ?`, [benchmarkRunId]);
  return row ? toProgress(row) : null;
}

/** Most recent run first — the app's default "current" run is the newest. */
export async function listAll(): Promise<BenchmarkRunProgress[]> {
  const rows = await all<ProgressDbRow>(`${SELECT} ORDER BY br.created_at DESC, br.id DESC`);
  return rows.map(toProgress);
}
