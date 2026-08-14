import type { BenchmarkTaskCriteria } from './model.ts';
import * as repo from './repo.ts';

export type {
  BenchmarkCriterionResult,
  BenchmarkRunSummary,
  BenchmarkTaskCriteria,
  JsonObject,
} from './model.ts';

export const byBenchmarkRunId = repo.findByBenchmarkRunId;
export const list = repo.listAll;
export const criteriaByBenchmarkRun = repo.listCriteriaByBenchmarkRun;

/**
 * The same verdicts, grouped by task.
 *
 * A criterion id only means something inside its task, so a flat list across a
 * multi-task run is unreadable — `C-001` appears once per task. The repo
 * already returns rows in task order, so this is one pass with no sort.
 */
export async function criteriaByTask(benchmarkRunId: number): Promise<BenchmarkTaskCriteria[]> {
  const groups = new Map<string, BenchmarkTaskCriteria>();
  for (const criterion of await repo.listCriteriaByBenchmarkRun(benchmarkRunId)) {
    let group = groups.get(criterion.taskId);
    if (!group) {
      group = { taskId: criterion.taskId, criteria: [], passed: 0, failed: 0 };
      groups.set(criterion.taskId, group);
    }
    group.criteria.push(criterion);
    if (criterion.result === 'pass') group.passed += 1;
    else group.failed += 1;
  }
  return [...groups.values()];
}

export async function current() {
  const [benchmarkRun] = await repo.listAll();
  return benchmarkRun ?? null;
}
