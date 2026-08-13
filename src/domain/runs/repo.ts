import { all, json, one, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { JsonObject, RunSummary } from './model.ts';

type RunRow = Row & {
  run_id: number;
  benchmark_id: number;
  benchmark_name: string;
  lab: string;
  adapter: string;
  benchmark_status: 'importing' | 'ready' | 'failed';
  runnable: number;
  label: string;
  model: string;
  task_count: number;
  settings_json: string;
  metrics_json: string;
  output_path: string | null;
};

/** br = benchmark runs */

const SELECT = `
  SELECT br.id AS run_id, b.id AS benchmark_id, b.name AS benchmark_name,
         b.lab, b.adapter, b.status AS benchmark_status, b.runnable,
         br.label, br.model, br.task_count, br.settings_json, br.metrics_json,
         br.output_path
    FROM benchmark_runs br
    JOIN benchmarks b ON b.id = br.benchmark_id`;

function toRun(row: RunRow): RunSummary {
  return {
    runId: row.run_id,
    runCode: code('benchmark_runs', row.run_id),
    benchmarkCode: code('benchmarks', row.benchmark_id),
    benchmarkName: row.benchmark_name,
    lab: row.lab,
    adapter: row.adapter,
    benchmarkStatus: row.benchmark_status,
    runnable: row.runnable === 1,
    label: row.label,
    model: row.model,
    taskCount: row.task_count,
    settings: json<JsonObject>(row.settings_json, {}),
    metrics: json<JsonObject>(row.metrics_json, {}),
    outputPath: row.output_path,
  };
}

export async function findById(runId: number): Promise<RunSummary | null> {
  const row = await one<RunRow>(`${SELECT} WHERE br.id = ?`, [runId]);
  return row ? toRun(row) : null;
}

export async function listAll(): Promise<RunSummary[]> {
  const rows = await all<RunRow>(`${SELECT} ORDER BY br.created_at DESC, br.id DESC`);
  return rows.map(toRun);
}
