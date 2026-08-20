import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import { handoffGate, type BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { Icon } from '../ui/Icon.tsx';
import { failedCriteriaOf } from './RunContext.tsx';
import { STAGES, stageNumber, type Stage } from './tabs.ts';

export function Handoff({
  stage,
  benchmarkRun,
  progress,
}: {
  stage: Stage['tab'];
  benchmarkRun: BenchmarkRunSummary | null;
  progress?: BenchmarkRunProgress | null;
}) {
  const index = STAGES.findIndex((item) => item.tab === stage);
  const next = STAGES[index + 1] ?? null;
  const previous = index > 0 ? STAGES[index - 1] : null;
  const runId = benchmarkRun?.benchmarkRunId;
  const query = runId ? `?run=${runId}` : '';
  const gate = next ? handoffGate(next.tab, progress ?? null) : null;

  return (
    <div class="m-handoff">
      <span class="m-handoff-what">
        {benchmarkRun
          ? <>Carrying <b>{benchmarkRun.benchmarkRunCode}</b> · {failedCriteriaOf(benchmarkRun, progress ?? null)} failed criteria</>
          : 'No run selected'}
      </span>
      <div class="m-handoff-actions">
        {previous ? <a class="m-handoff-back" href={`/${previous.tab}${query}`}><Icon name="back" /> {stageNumber(index - 1)} {previous.label}</a> : null}
        {next && gate?.open ? (
          <a class="m-handoff-go" href={`/${next.tab}${query}`}>
            <span>{stageNumber(index + 1)}</span>
            {next.tab === 'results' ? 'View Results' : `Send to ${next.label}`} <Icon name="arrow" />
          </a>
        ) : next ? (
          /* `disabled` is not valid on an anchor; no href makes this state
             genuinely inert while the title explains the missing prerequisite. */
          <span class="m-handoff-go is-disabled" aria-disabled="true" title={gate?.reason ?? undefined}>
            <span>{stageNumber(index + 1)}</span>
            {next.tab === 'results' ? 'View Results' : `Send to ${next.label}`} <Icon name="arrow" />
          </span>
        ) : (
          <span class="m-handoff-terminal">
            {stage === 'cluster' && !progress?.clusterHandoff.count ? 'Prepare the ready environments above' : 'Pipeline handoff complete'}
          </span>
        )}
      </div>
    </div>
  );
}
