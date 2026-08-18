import { all, db, insert, json, now, one, run, type Row } from '../../db/client.ts';
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
  expected_criteria: number;
  settings_json: string;
  metrics_json: string;
  output_path: string | null;
  result: BenchmarkRunSummary['result'];
  result_tasks_total: number | null;
  result_tasks_passed: number | null;
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
  source_json: string | null;
  catalog_match_criteria: string | null;
};

/** br = benchmark runs */

const SELECT = `
  SELECT br.id AS benchmark_run_id, b.id AS benchmark_id, b.name AS benchmark_name,
         b.lab, b.adapter, b.status AS benchmark_status, b.runnable,
         br.label, br.model, br.task_count,
         (SELECT COUNT(*)
            FROM benchmark_run_tasks chosen
            JOIN benchmark_task_criteria expected
              ON expected.benchmark_id = chosen.benchmark_id
             AND expected.dataset = chosen.dataset
             AND expected.task_id = chosen.task_id
           WHERE chosen.benchmark_run_id = br.id) AS expected_criteria,
         br.settings_json,
         result.metrics_json, result.result_path AS output_path,
         result.result,
         result.tasks_total AS result_tasks_total,
         result.tasks_passed AS result_tasks_passed,
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
    expectedCriteria: row.expected_criteria,
    settings: json<JsonObject>(row.settings_json, {}),
    metrics: json<JsonObject>(row.metrics_json, {}),
    outputPath: row.output_path,
    result: row.result,
    resultTasksTotal: row.result_tasks_total,
    resultTasksPassed: row.result_tasks_passed,
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
 * Every *displayed* value comes from `criterion_results`, which is the criterion
 * as the judge saw it. The join to `benchmark_task_criteria` is only for
 * `source_json`, the raw definition, and it stays strictly in that lane: pairing
 * today's catalog wording with reasoning written against an earlier one produces
 * a row that reads fine and states something untrue. The raw JSON is shown on
 * demand and labelled as the catalog's current definition, and `sourceDrifted`
 * says outright when the catalog no longer matches what was graded.
 *
 * LEFT JOIN because a re-imported catalog can drop the row this verdict was
 * graded against; losing the raw JSON must not lose the verdict.
 */
export async function listCriteriaByBenchmarkRun(benchmarkRunId: number): Promise<BenchmarkCriterionResult[]> {
  const rows = await all<CriterionDbRow>(
    `SELECT c.task_id, c.criterion_id, c.criterion_title, c.result, c.reasoning,
            c.match_criteria, c.judge_model, c.judge_error, c.error_type,
            k.source_json, k.match_criteria AS catalog_match_criteria
       FROM criterion_results c
       JOIN task_results tr ON tr.id = c.task_result_id
       JOIN benchmark_results r ON r.id = tr.benchmark_result_id
       LEFT JOIN benchmark_task_criteria k
              ON k.id = c.benchmark_task_criterion_id AND k.task_id = c.task_id
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
    sourceJson: row.source_json ?? '',
    // Compared against the run's own copy, not against the title: the wording
    // is what the judge was asked to apply.
    sourceDrifted: Boolean(row.catalog_match_criteria) && row.catalog_match_criteria !== row.match_criteria,
  }));
}

export async function insertRun(input: {
  benchmarkId: number;
  label: string;
  model: string;
  taskCount: number;
  settings: Record<string, unknown>;
}): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO benchmark_runs (benchmark_id, label, model, task_count, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.benchmarkId, input.label, input.model, input.taskCount, JSON.stringify(input.settings), at, at],
  );
}

export async function insertRunTasks(
  benchmarkRunId: number,
  benchmarkId: number,
  taskIds: string[],
): Promise<void> {
  const rows = taskIds.map((taskId, position) => ({
    sql: `INSERT INTO benchmark_run_tasks (benchmark_run_id, benchmark_id, dataset, task_id, position)
          VALUES (?, ?, 'validation', ?, ?)`,
    args: [benchmarkRunId, benchmarkId, taskId, position],
  }));
  for (let start = 0; start < rows.length; start += 500) {
    await db.batch(rows.slice(start, start + 500), 'write');
  }
}

export async function insertResult(input: {
  benchmarkRunId: number;
  benchmarkId: number;
  result: 'passed' | 'failed' | 'error' | 'skipped';
  tasksTotal: number;
  tasksPassed: number;
  tasksFailed: number;
  tasksError: number;
  tasksSkipped: number;
  criteriaTotal: number;
  criteriaPassed: number;
  criteriaFailed: number;
  passRate: number | null;
  reward: number | null;
  resultPath: string;
  metrics: Record<string, unknown>;
}): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO benchmark_results (
       benchmark_run_id, benchmark_id, result,
       tasks_total, tasks_passed, tasks_failed, tasks_error, tasks_skipped,
       criteria_total, criteria_passed, criteria_failed, pass_rate, reward,
       result_path, metrics_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.benchmarkRunId, input.benchmarkId, input.result,
      input.tasksTotal, input.tasksPassed, input.tasksFailed, input.tasksError, input.tasksSkipped,
      input.criteriaTotal, input.criteriaPassed, input.criteriaFailed, input.passRate, input.reward,
      input.resultPath, JSON.stringify(input.metrics), at, at,
    ],
  );
}

export async function insertTaskResult(input: {
  benchmarkResultId: number;
  benchmarkId: number;
  taskId: string;
  trialName: string;
  result: 'passed' | 'failed' | 'error' | 'skipped';
  reward: number | null;
  criteriaTotal: number;
  criteriaPassed: number;
  criteriaFailed: number;
  resultPath: string | null;
  metrics: Record<string, unknown>;
}): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO task_results (
       benchmark_result_id, benchmark_id, dataset, task_id, trial_name, result, reward,
       criteria_total, criteria_passed, criteria_failed, result_path, metrics_json, created_at, updated_at
     ) VALUES (?, ?, 'validation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.benchmarkResultId, input.benchmarkId, input.taskId, input.trialName, input.result, input.reward,
      input.criteriaTotal, input.criteriaPassed, input.criteriaFailed, input.resultPath,
      JSON.stringify(input.metrics), at, at,
    ],
  );
}

export async function insertCriterionResult(input: {
  taskResultId: number;
  catalogCriterionId: number;
  taskId: string;
  trialName: string;
  criterionId: string;
  title: string;
  result: 'pass' | 'fail' | 'error';
  reasoning: string;
  matchCriteria: string;
  judgeModel: string;
  judgeError: boolean;
  errorType: string | null;
}): Promise<void> {
  const at = now();
  await run(
    `INSERT INTO criterion_results (
       task_result_id, benchmark_task_criterion_id, task_id, trial_name, criterion_id,
       criterion_title, result, reasoning, match_criteria, judge_model, judge_error, error_type,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.taskResultId, input.catalogCriterionId, input.taskId, input.trialName, input.criterionId,
      input.title, input.result, input.reasoning, input.matchCriteria, input.judgeModel,
      input.judgeError ? 1 : 0, input.errorType, at, at,
    ],
  );
}

export async function updateResult(
  resultId: number,
  input: {
    result: 'passed' | 'failed' | 'error' | 'skipped';
    tasksTotal: number;
    tasksPassed: number;
    tasksFailed: number;
    tasksError: number;
    tasksSkipped: number;
    criteriaTotal: number;
    criteriaPassed: number;
    criteriaFailed: number;
    passRate: number | null;
    reward: number | null;
    metrics: Record<string, unknown>;
  },
): Promise<void> {
  await run(
    `UPDATE benchmark_results SET
       result = ?, tasks_total = ?, tasks_passed = ?, tasks_failed = ?, tasks_error = ?, tasks_skipped = ?,
       criteria_total = ?, criteria_passed = ?, criteria_failed = ?, pass_rate = ?, reward = ?,
       metrics_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.result, input.tasksTotal, input.tasksPassed, input.tasksFailed, input.tasksError, input.tasksSkipped,
      input.criteriaTotal, input.criteriaPassed, input.criteriaFailed, input.passRate, input.reward,
      JSON.stringify(input.metrics), now(), resultId,
    ],
  );
}

export async function taskIdsByRun(benchmarkRunId: number): Promise<{ benchmarkId: number; taskIds: string[] }> {
  const rows = await all<Row & { benchmark_id: number; task_id: string }>(
    `SELECT benchmark_id, task_id FROM benchmark_run_tasks
      WHERE benchmark_run_id = ? ORDER BY position`,
    [benchmarkRunId],
  );
  if (rows.length === 0) return { benchmarkId: 0, taskIds: [] };
  return { benchmarkId: rows[0]!.benchmark_id, taskIds: rows.map((row) => row.task_id) };
}

export async function existingTaskIds(benchmarkId: number, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const found = new Set<string>();
  for (let start = 0; start < taskIds.length; start += 500) {
    const page = taskIds.slice(start, start + 500);
    const placeholders = page.map(() => '?').join(', ');
    const rows = await all<Row & { task_id: string }>(
      `SELECT task_id FROM benchmark_tasks WHERE benchmark_id = ? AND task_id IN (${placeholders})`,
      [benchmarkId, ...page],
    );
    for (const row of rows) found.add(row.task_id);
  }
  return found;
}
