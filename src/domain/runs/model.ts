import type { InValue } from '@libsql/client';

export type JsonObject = Record<string, InValue>;

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
  settings: JsonObject;
  metrics: JsonObject;
  outputPath: string | null;
  /** `benchmark_results.result` — null until the run has produced one. */
  result: 'passed' | 'failed' | 'error' | 'skipped' | null;
  resultCriteriaTotal: number | null;
  resultCriteriaPassed: number | null;
  resultCriteriaFailed: number | null;
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
