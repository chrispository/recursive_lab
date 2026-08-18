import type { BenchmarkRunSummary } from '../../../domain/runs/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';
import type { LiveProgress } from '../../../gym/progress.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Cap } from '../../ui/Cap.tsx';
import { Id } from '../../ui/Id.tsx';
import { Tally } from '../../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

function expected(run: BenchmarkRunSummary) {
  return `${run.expectedCriteria} expected ${run.expectedCriteria === 1 ? 'check' : 'checks'}`;
}

const repeatsOf = (run: BenchmarkRunSummary) => Math.max(1, numberOf(run.settings.repeats) || 1);
const isOverall = () => Math.floor(Date.now() / 5_000) % 2 === 0;

/** The live run is work in progress, not a prematurely-scored result. */
function LiveRun({ run, job, live }: { run: BenchmarkRunSummary; job: JobRow; live: LiveProgress | null }) {
  const repeats = repeatsOf(run);
  const total = run.taskCount * repeats;
  const unit = repeats === 1 ? 'tasks' : 'task attempts';
  const done = Math.min(total, live?.done ?? 0);
  const active = Math.min(Math.max(0, total - done), live?.active ?? 0);
  const waiting = Math.max(0, total - done - active);
  const overall = isOverall();
  const progress = total ? `${(done / total) * 100}%` : '0%';
  return (
    <article class="m-ledger-row m-ledger-live" data-state={job.status}>
      <div class="m-ledger-orb-wrap">
        <Id value={run.benchmarkRunCode} />
        <canvas
          class="m-thinking-orb m-ledger-orb"
          data-thinking-orb
          data-tone={job.status}
          width="64"
          height="64"
          role="img"
          aria-label="Composing while the benchmark runs"
        />
      </div>
      <div class="m-ledger-identity">
        <strong>{run.benchmarkName}</strong>
        <span class="sub"><span class="m-id">{run.model}</span> · {run.taskCount} selected {run.taskCount === 1 ? 'task' : 'tasks'}</span>
      </div>
      <div class="m-ledger-progress" data-ledger-view={overall ? 'overall' : 'active'}>
        {overall ? (
          <>
            <span class="m-ledger-kicker">Overall progress</span>
            <strong>{done} of {total} {unit} completed · {active} in progress · {waiting} waiting</strong>
            <span class="sub">{expected(run)}</span>
            <span class="m-ledger-track" role="progressbar" aria-label={`${done} of ${total} ${unit} completed`} aria-valuenow={done} aria-valuemax={total}>
              <i style={`width:${progress}`} />
            </span>
          </>
        ) : (
          <>
            <span class="m-ledger-kicker">Active work</span>
            <strong>{job.step || 'Starting the benchmark run'}</strong>
            <span class="sub">{active ? `${active} ${active === 1 ? 'task is' : 'tasks are'} in progress` : 'Waiting for Harbor to begin work'} · {expected(run)}</span>
          </>
        )}
      </div>
    </article>
  );
}

/** Completed rows are history: outcome first, not the machinery that made it. */
function CompletedRun({ run }: { run: BenchmarkRunSummary }) {
  const allPass =
    run.resultTasksTotal && run.resultTasksTotal > 0 && run.resultTasksPassed !== null
      ? run.resultTasksPassed / run.resultTasksTotal
      : null;
  const criterionRate =
    run.resultCriteriaTotal && run.resultCriteriaTotal > 0 && run.resultCriteriaPassed !== null
      ? run.resultCriteriaPassed / run.resultCriteriaTotal
      : null;
  const state = run.result === 'failed' || run.result === 'error' ? 'error' : run.result === 'passed' ? 'succeeded' : 'pending';
  return (
    <article class="m-ledger-row m-ledger-complete" data-state={state}>
      <div class="m-ledger-identity">
        <strong>{run.label}</strong>
        <span class="sub"><Id value={run.benchmarkRunCode} /> · <span class="m-id">{run.model}</span> · {run.taskCount} {run.taskCount === 1 ? 'task' : 'tasks'}</span>
      </div>
      <div class="m-ledger-outcome">
        <Badge state={state}>{run.result ?? 'not run'}</Badge>
        <span class="sub">{run.result === 'failed' ? 'One or more tasks did not all-pass.' : run.result === 'error' ? 'The run could not be completed.' : 'Verifier closed the run.'}</span>
      </div>
      <div class="m-ledger-scores">
        <strong>{pct(allPass)} all-pass</strong>
        <span class="sub">{run.resultTasksPassed ?? 0}/{run.resultTasksTotal ?? 0} tasks · {pct(criterionRate)} ({run.resultCriteriaPassed ?? 0}/{run.resultCriteriaTotal ?? 0} checks)</span>
      </div>
    </article>
  );
}

export function RunLedger({
  benchmarkRun,
  runs,
  jobs,
  live,
  oob,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  /** Every run, newest first — the ledger is a per-run history. */
  runs: BenchmarkRunSummary[];
  jobs: JobRow[];
  live?: LiveProgress | null;
  oob?: boolean;
}) {
  const job = jobs.find((item) => item.kind === 'benchmark_run');
  const active = isLive(job);
  const history = runs.filter((run) => run.benchmarkRunId !== benchmarkRun?.benchmarkRunId);
  const resultCriteria = numberOf(benchmarkRun?.metrics.criteria_total);
  const headlineChecks = benchmarkRun?.result ? resultCriteria : benchmarkRun?.expectedCriteria ?? 0;

  return (
    <section
      id="benchmarks-ledger"
      class="m-tablebox"
      hx-get={active ? '/ui/benchmarks/ledger' : undefined}
      hx-trigger={active ? 'every 1s' : undefined}
      hx-swap={active ? 'outerHTML' : undefined}
      hx-swap-oob={oob ? 'true' : undefined}
    >
      <Cap title="Benchmark run ledger">
        <Tally
          items={[
            { value: runs.length, label: 'runs' },
            { value: benchmarkRun?.taskCount ?? 0, label: 'tasks · current' },
            { value: headlineChecks, label: benchmarkRun?.result ? 'checks · scored' : 'checks · expected' },
          ]}
        />
      </Cap>
      {benchmarkRun ? (
        <div class="m-run-ledger">
          {active && job ? <LiveRun run={benchmarkRun} job={job} live={live ?? null} /> : <CompletedRun run={benchmarkRun} />}
          {history.map((run) => <CompletedRun run={run} />)}
        </div>
      ) : <div class="m-empty">No benchmark run has been created.</div>}
    </section>
  );
}
