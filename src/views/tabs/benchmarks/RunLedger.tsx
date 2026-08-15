import type { BenchmarkRunSummary } from '../../../domain/runs/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Bar } from '../../ui/Bar.tsx';
import { Cap } from '../../ui/Cap.tsx';
import { Id } from '../../ui/Id.tsx';
import { Table } from '../../ui/Table.tsx';
import { Tally } from '../../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

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

export function RunLedger({
  benchmarkRun,
  jobs,
  oob,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  jobs: JobRow[];
  oob?: boolean;
}) {
  const metrics = benchmarkRun?.metrics ?? {};
  const passRate = numberOf(metrics.pass_rate);
  const job = jobs.find((item) => item.kind === 'benchmark_run');
  // Polling attributes are present only while the run is live, so the region
  // stops asking the moment the job closes. No client-side timer to clear.
  const active = isLive(job);

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
              { value: benchmarkRun ? 1 : 0, label: 'runs' },
              { value: benchmarkRun?.taskCount ?? 0, label: 'tasks' },
              { value: numberOf(metrics.criteria_total), label: 'criteria' },
              { value: `${(passRate * 100).toFixed(1)}%`, label: 'pass rate', hot: passRate < 0.8 },
            ]}
          />
        </Cap>
        {benchmarkRun ? (
          <Table>
            <thead><tr><th>Run</th><th>Benchmark</th><th>Model</th><th class="n">Tasks</th><th>Progress</th><th>Status</th></tr></thead>
            <tbody>
              <tr data-state={job?.status ?? 'pending'}>
                <td><span class="nm">{benchmarkRun.label}</span><span class="sub"><Id value={benchmarkRun.benchmarkRunCode} /></span></td>
                <td>{benchmarkRun.benchmarkName}<span class="sub">{benchmarkRun.lab} · {benchmarkRun.adapter}</span></td>
                <td><span class="m-id">{benchmarkRun.model}</span></td>
                <td class="n">{benchmarkRun.taskCount}</td>
                <td><Progress job={job} /></td>
                <td><Badge state={job?.status ?? 'pending'}>{job?.status ?? 'not run'}</Badge></td>
              </tr>
            </tbody>
          </Table>
        ) : <div class="m-empty">No benchmark run has been created.</div>}
    </section>
  );
}
