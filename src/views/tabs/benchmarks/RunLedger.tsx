import type { BenchmarkRunSummary } from '../../../domain/runs/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Bar } from '../../ui/Bar.tsx';
import { Cap } from '../../ui/Cap.tsx';
import { Id } from '../../ui/Id.tsx';
import { Table } from '../../ui/Table.tsx';
import { Tally } from '../../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

/**
 * The progress cell.
 *
 * The bar is `jobs.progress` (finished tasks plus a fraction of the in-flight
 * Harbor trial). The line under it is `jobs.step`, which names the phase —
 * starting, preparing, agent turns, scoring, saving — so a 1-task run is not
 * a silent empty bar. A run that has not started has neither, and says so.
 */
function Progress({ job }: { job: JobRow | undefined }) {
  if (!job) return <span class="sub">not started</span>;
  return (
    <div class="m-run-progress">
      <Bar value={job.progress} tone={job.status} label="complete" />
      <span class="sub">{job.step || job.status}</span>
    </div>
  );
}

/**
 * The two rates a run is judged by, per Harvey LAB's methodology.
 *
 * All-pass is the headline: a task passes only when *every* criterion passed.
 * Criterion pass rate is the diagnostic — how close the model came. Pooling
 * them across runs would hide exactly the difference the two numbers exist
 * to show, so every row carries its own pair.
 */
function Rates({ run }: { run: BenchmarkRunSummary }) {
  const allPass =
    run.resultTasksTotal && run.resultTasksTotal > 0 && run.resultTasksPassed !== null
      ? run.resultTasksPassed / run.resultTasksTotal
      : null;
  const criterionRate =
    run.resultCriteriaTotal && run.resultCriteriaTotal > 0 && run.resultCriteriaPassed !== null
      ? run.resultCriteriaPassed / run.resultCriteriaTotal
      : null;
  return (
    <>
      <td class="n">
        <span class="m-id">{pct(allPass)}</span>
        <span class="sub">{run.resultTasksPassed ?? 0}/{run.resultTasksTotal ?? 0} all-pass</span>
      </td>
      <td class="n">
        <span class="m-id">{pct(criterionRate)}</span>
        <span class="sub">{run.resultCriteriaPassed ?? 0}/{run.resultCriteriaTotal ?? 0} criteria</span>
      </td>
    </>
  );
}

export function RunLedger({
  benchmarkRun,
  runs,
  jobs,
  oob,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  /** Every run, newest first — the ledger is a per-run history now. */
  runs: BenchmarkRunSummary[];
  jobs: JobRow[];
  oob?: boolean;
}) {
  const metrics = benchmarkRun?.metrics ?? {};
  const job = jobs.find((item) => item.kind === 'benchmark_run');
  // Polling attributes are present only while the run is live, so the region
  // stops asking the moment the job closes. No client-side timer to clear.
  const active = isLive(job);
  const history = runs.filter((run) => run.benchmarkRunId !== benchmarkRun?.benchmarkRunId);

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
            { value: numberOf(metrics.criteria_total), label: 'criteria · current' },
          ]}
        />
      </Cap>
      {benchmarkRun ? (
        <Table>
          <thead>
            <tr>
              <th>Run</th><th>Benchmark</th><th>Model</th>
              <th class="n">Tasks</th><th class="n">All-pass</th><th class="n">Criteria</th>
              <th>Progress</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr data-state={job?.status ?? 'pending'}>
              <td><span class="nm">{benchmarkRun.label}</span><span class="sub"><Id value={benchmarkRun.benchmarkRunCode} /></span></td>
              <td>{benchmarkRun.benchmarkName}<span class="sub">{benchmarkRun.lab} · {benchmarkRun.adapter}</span></td>
              <td><span class="m-id">{benchmarkRun.model}</span></td>
              <td class="n">{benchmarkRun.taskCount}</td>
              <Rates run={benchmarkRun} />
              <td><Progress job={job} /></td>
              <td><Badge state={job?.status ?? 'pending'}>{job?.status ?? 'not run'}</Badge></td>
            </tr>
            {history.map((run) => (
              <tr data-state={run.result === 'failed' ? 'error' : run.result === 'passed' ? 'succeeded' : 'pending'}>
                <td><span class="nm">{run.label}</span><span class="sub"><Id value={run.benchmarkRunCode} /></span></td>
                <td>{run.benchmarkName}<span class="sub">{run.lab} · {run.adapter}</span></td>
                <td><span class="m-id">{run.model}</span></td>
                <td class="n">{run.taskCount}</td>
                <Rates run={run} />
                <td><span class="sub">{run.result ? 'closed' : '—'}</span></td>
                <td><Badge state={run.result === 'failed' ? 'error' : 'ready'}>{run.result ?? 'not run'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <div class="m-empty">No benchmark run has been created.</div>}
    </section>
  );
}
