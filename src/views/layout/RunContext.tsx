import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { Icon } from '../ui/Icon.tsx';

export function failedCriteriaOf(
  run: BenchmarkRunSummary | null,
  progress: BenchmarkRunProgress | null = null,
) {
  return run?.resultCriteriaFailed ?? progress?.failureMap.count ?? 0;
}

export function RunContext({
  benchmarkRun,
  availableRuns,
  failureTopics,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  availableRuns?: BenchmarkRunSummary[];
  /** Shown on the Data forge surface once its failure map has topics. */
  failureTopics?: number;
}) {
  if (!benchmarkRun) return null;
  const criteriaTotal = benchmarkRun.resultCriteriaTotal ?? benchmarkRun.expectedCriteria;
  const tasksTotal = benchmarkRun.resultTasksTotal ?? benchmarkRun.taskCount;

  return (
    <div class="m-run-context">
      <div class="m-run-context-copy">
        <span class="m-run-context-id">{benchmarkRun.benchmarkRunCode}</span>
        <span class="m-run-context-name">{benchmarkRun.benchmarkName}</span>
        <span class="m-run-context-tally" aria-label="Run summary">
          <span><b>{benchmarkRun.resultCriteriaPassed ?? '—'}/{criteriaTotal}</b><i>criteria</i></span>
          <span><b>{benchmarkRun.resultTasksPassed ?? '—'}/{tasksTotal}</b><i>tasks</i></span>
          {typeof failureTopics === 'number' ? (
            <span><b>{failureTopics}</b><i>failure topics</i></span>
          ) : null}
        </span>
      </div>
      {availableRuns?.length ? (
        <details class="m-run-switch">
          <summary>Switch run</summary>
          <form method="get">
            <select name="run" aria-label="Switch run">
              {availableRuns.map((run) => (
                <option value={String(run.benchmarkRunId)} selected={run.benchmarkRunId === benchmarkRun.benchmarkRunId}>
                  {run.benchmarkRunCode} · {run.label} · {run.model}
                </option>
              ))}
            </select>
            <button class="ghost compact" type="submit">Use run</button>
          </form>
        </details>
      ) : (
        <span class="m-run-switch-empty"><Icon name="chevron" /> Switch run</span>
      )}
    </div>
  );
}
