import { all, json, one, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { BenchmarkCriterionResult, BenchmarkRunSummary, JsonObject } from './model.ts';

type BenchmarkRunDbRow = Row & {
  benchmark_run_id: number;
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
  result: BenchmarkRunSummary['result'];
  result_criteria_total: number | null;
  result_criteria_passed: number | null;
  result_criteria_failed: number | null;
};

type CriterionDbRow = Row & {
  task_id: string;
  criterion_id: string;
  criterion_title: string;
  result: BenchmarkCriterionResult['result'];
  reasoning: string;
  match_criteria: string;
  judge_model: string;
  judge_error: number;
  error_type: string | null;
};

/** br = benchmark runs */

const SELECT = `
  SELECT br.id AS benchmark_run_id, b.id AS benchmark_id, b.name AS benchmark_name,
         b.lab, b.adapter, b.status AS benchmark_status, b.runnable,
         br.label, br.model, br.task_count, br.settings_json,
         result.metrics_json, result.result_path AS output_path,
         result.result,
         result.criteria_total AS result_criteria_total,
         result.criteria_passed AS result_criteria_passed,
         result.criteria_failed AS result_criteria_failed
    FROM benchmark_runs br
    JOIN benchmarks b ON b.id = br.benchmark_id
    LEFT JOIN benchmark_results result ON result.benchmark_run_id = br.id`;

function toBenchmarkRun(row: BenchmarkRunDbRow): BenchmarkRunSummary {
  return {
    benchmarkRunId: row.benchmark_run_id,
    benchmarkRunCode: code('benchmark_runs', row.benchmark_run_id),
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
    result: row.result,
    resultCriteriaTotal: row.result_criteria_total,
    resultCriteriaPassed: row.result_criteria_passed,
    resultCriteriaFailed: row.result_criteria_failed,
  };
}

export async function findByBenchmarkRunId(benchmarkRunId: number): Promise<BenchmarkRunSummary | null> {
  const row = await one<BenchmarkRunDbRow>(`${SELECT} WHERE br.id = ?`, [benchmarkRunId]);
  return row ? toBenchmarkRun(row) : null;
}

export async function listAll(): Promise<BenchmarkRunSummary[]> {
  const rows = await all<BenchmarkRunDbRow>(`${SELECT} ORDER BY br.created_at DESC, br.id DESC`);
  return rows.map(toBenchmarkRun);
}

/**
 * Every criterion verdict in one run, in task order.
 *
 * Reads only `criterion_results` for display text. There is deliberately no
 * join to `benchmark_task_criteria` — that table holds the criterion as it
 * stands today, and pairing it with reasoning written against an earlier
 * wording produces a row that reads fine and states something untrue.
 * Dropping that join is also why this query is three tables, not four.
 */
export async function listCriteriaByBenchmarkRun(benchmarkRunId: number): Promise<BenchmarkCriterionResult[]> {
  const rows = await all<CriterionDbRow>(
    `SELECT c.task_id, c.criterion_id, c.criterion_title, c.result, c.reasoning,
            c.match_criteria, c.judge_model, c.judge_error, c.error_type
       FROM criterion_results c
       JOIN task_results tr ON tr.id = c.task_result_id
       JOIN benchmark_results r ON r.id = tr.benchmark_result_id
      WHERE r.benchmark_run_id = ?
      ORDER BY c.task_result_id ASC, c.id ASC`,
    [benchmarkRunId],
  );
  return rows.map((row) => ({
    taskId: row.task_id,
    criterionId: row.criterion_id,
    title: row.criterion_title,
    result: row.result,
    reasoning: row.reasoning,
    matchCriteria: row.match_criteria,
    judgeModel: row.judge_model,
    judgeError: row.judge_error === 1,
    errorType: row.error_type,
  }));
}
