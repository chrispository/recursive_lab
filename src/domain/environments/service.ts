import * as repo from './repo.ts';

export type { EnvironmentRow, EvaluationSummary } from './model.ts';

export const listByRun = repo.listByRun;
export const latestEvaluation = repo.latestEvaluation;
