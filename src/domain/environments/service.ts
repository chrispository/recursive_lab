import * as repo from './repo.ts';

export type { EnvironmentRow, EvaluationSummary } from './model.ts';

export const listByBenchmarkRun = repo.listByBenchmarkRun;
export const latestEvaluation = repo.latestEvaluation;
