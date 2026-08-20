import type { InValue } from '@libsql/client';

export type JsonObject = Record<string, InValue>;

/**
 * Where collecting rollouts stops and ingesting them begins, on the run's
 * 0..1 progress scale.
 *
 * Rollouts own 0 → 0.9 and ingest owns the rest, so the bar only ever moves
 * forward. Within that 0.9, `gym/progress.ts` counts finished tasks plus a
 * fraction of the in-flight Harbor trial (turns, then scoring), so a 1-task
 * run is not stuck at 0 until gym writes its JSONL line. It lives here
 * because both halves of the run need it and neither owns the other —
 * `service.ts` counts up to it, `ingest.ts` starts from it.
 */
export const ROLLOUT_SHARE = 0.9;

/**
 * One judge verdict, exactly as it was recorded.
 *
 * Every field here comes from `criterion_results` — the historical record — and
 * never from the `benchmark_task_criteria` catalog, even though the catalog
 * holds a column of the same name. The catalog says what a criterion is *now*;
 * this says what the judge actually graded against. Mixing the two puts a
 * current criterion title above a reasoning paragraph written about the old
 * one, which renders without error and is simply false. See AGENTS.md.
 */
export type BenchmarkCriterionResult = {
  /**
   * Which task this verdict belongs to. Required, not decorative: criterion ids
   * are unique only within a task — the same id is reused by every task — and a
   * multi-task run returns many rows that are otherwise indistinguishable.
   */
  taskId: string;
  criterionId: string;
  title: string;
  /** One criterion's outcome. Tasks and runs use passed/failed instead. */
  result: 'pass' | 'fail' | 'error';
  reasoning: string;
  matchCriteria: string;
  judgeModel: string;
  judgeError: boolean;
  errorType: string | null;
  /**
   * The criterion exactly as the benchmark defines it, verbatim from the
   * source `task.json`. Shown on demand so a verdict can be checked against the
   * definition rather than against a paraphrase of it. Empty when the catalog
   * row is gone — a re-import can drop it while the verdict survives.
   */
  sourceJson: string;
  /**
   * The catalog's wording has changed since this verdict was graded, so the raw
   * JSON above describes a criterion the judge never saw.
   */
  sourceDrifted: boolean;
};

/** Criterion verdicts for one task, as the Results page groups them. */
export type BenchmarkTaskCriteria = {
  taskId: string;
  criteria: BenchmarkCriterionResult[];
  passed: number;
  failed: number;
  /** Criteria the judge could not grade. Never folded into `failed`. */
  errored: number;
};

export type BenchmarkRunSummary = {
  benchmarkRunId: number;
  benchmarkRunCode: string;
  benchmarkCode: string;
  benchmarkName: string;
  lab: string;
  adapter: string;
  benchmarkStatus: 'importing' | 'ready' | 'failed';
  runnable: boolean;
  label: string;
  model: string;
  taskCount: number;
  /** Criteria in the immutable task selection, known before Harbor starts. */
  expectedCriteria: number;
  settings: JsonObject;
  metrics: JsonObject;
  outputPath: string | null;
  /** `benchmark_results.result` — null until the run has produced one. */
  result: 'passed' | 'failed' | 'error' | 'skipped' | null;
  /** Tasks that passed every criterion — the all-pass headline, per run. */
  resultTasksTotal: number | null;
  resultTasksPassed: number | null;
  resultCriteriaTotal: number | null;
  resultCriteriaPassed: number | null;
  resultCriteriaFailed: number | null;
  /**
   * Criteria the judge could not grade. Never folded into `resultCriteriaFailed`
   * — a criterion that could not be graded is not one the model got wrong, and
   * it means the pass rate beside it is over a smaller denominator than the run
   * asked for.
   */
  resultCriteriaUngraded: number | null;
  resultTasksFailed: number | null;
  /** Same argument one level up: a task that errored is not a task that failed. */
  resultTasksErrored: number | null;
};

export type RunSettings = {
  repeats: number;
  concurrency: number;
  temperature: number;
  topP: number;
  outputTokenStrategy: 'adaptive' | 'fixed';
  maxOutputTokens: number;
  maxTurns: number;
  shellTimeout: number;
  agentModelTimeout: number;
  judgeParallelism: number;
  judgeTimeout: number;
  judgeMaxTokens: number;
  judgeRetries: number;
};

export type RunRequest = {
  benchmarkId: number;
  model: string;
  taskIds: string[];
  settings: RunSettings;
};
