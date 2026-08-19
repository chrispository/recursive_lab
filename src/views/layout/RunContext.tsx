import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { Icon } from '../ui/Icon.tsx';

export function failedCriteriaOf(
  run: BenchmarkRunSummary | null,
  progress: BenchmarkRunProgress | null = null,
) {
  return run?.resultCriteriaFailed ?? progress?.failureMap.count ?? 0;
}

function passRateOf(run: BenchmarkRunSummary, progress: BenchmarkRunProgress | null) {
  if (progress?.passRate !== null && progress?.passRate !== undefined) {
    return `${(progress.passRate * 100).toFixed(1)}%`;
  }
  if (run.resultCriteriaPassed !== null && run.resultCriteriaTotal) {
    return `${((run.resultCriteriaPassed / run.resultCriteriaTotal) * 100).toFixed(1)}%`;
  }
  return '—';
}

export function RunContext({
  benchmarkRun,
  progress,
  availableRuns,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress?: BenchmarkRunProgress | null;
  availableRuns?: BenchmarkRunSummary[];
}) {
  if (!benchmarkRun) return null;
  const criteria = benchmarkRun.resultCriteriaTotal ?? benchmarkRun.expectedCriteria;
  const failures = failedCriteriaOf(benchmarkRun, progress ?? null);

  return (
    <div class="m-run-context">
      <div class="m-run-context-copy">
        <span class="m-run-context-id">{benchmarkRun.benchmarkRunCode}</span>
        <span class="m-run-context-prose">
          {benchmarkRun.benchmarkName} · <b>{benchmarkRun.model}</b> · {criteria} criteria · <b>{passRateOf(benchmarkRun, progress ?? null)}</b> pass · {failures} failed
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
