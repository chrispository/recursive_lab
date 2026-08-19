import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import { handoffGate, type BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { Icon } from '../ui/Icon.tsx';
import { failedCriteriaOf } from './RunContext.tsx';
import { STAGES, type Stage } from './tabs.ts';

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
  const next = STAGES[(index + 1) % STAGES.length] ?? STAGES[0];
  const previous = index > 0 ? STAGES[index - 1] : null;
  const runId = benchmarkRun?.benchmarkRunId;
  const query = runId ? `?run=${runId}` : '';
  const gate = handoffGate(next.tab, progress ?? null);
  const handoffLabel = (
    <>
      <span>{next === STAGES[0] ? '01' : String(index + 2).padStart(2, '0')}</span>
      Send to {next.label} <Icon name="arrow" />
    </>
  );

  return (
    <div class="m-handoff">
      <span class="m-handoff-what">
        {benchmarkRun
          ? <>Carrying <b>{benchmarkRun.benchmarkRunCode}</b> · {failedCriteriaOf(benchmarkRun, progress ?? null)} failed criteria</>
          : 'No run selected'}
      </span>
      <div class="m-handoff-actions">
        {previous ? <a class="m-handoff-back" href={`/${previous.tab}${query}`}><Icon name="back" /> {String(index).padStart(2, '0')} {previous.label}</a> : null}
        {gate.open ? (
          <a class="m-handoff-go" href={`/${next.tab}${query}`}>{handoffLabel}</a>
        ) : (
          /* `disabled` is not valid on an anchor; no href makes this state
             genuinely inert while the title explains the missing prerequisite. */
          <span class="m-handoff-go is-disabled" aria-disabled="true" title={gate.reason ?? undefined}>
            {handoffLabel}
          </span>
        )}
      </div>
    </div>
  );
}
