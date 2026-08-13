import * as repo from './repo.ts';

export type { BenchmarkCriterionResult, BenchmarkRunSummary, JsonObject } from './model.ts';

export const byBenchmarkRunId = repo.findByBenchmarkRunId;
export const list = repo.listAll;
export const criteriaByBenchmarkRun = repo.listCriteriaByBenchmarkRun;

export async function current() {
  const [benchmarkRun] = await repo.listAll();
  return benchmarkRun ?? null;
}
