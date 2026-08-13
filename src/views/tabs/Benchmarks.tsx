import type { RunSummary } from '../../domain/runs/model.ts';
import type { JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Id } from '../ui/Id.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

export function Benchmarks({ run, jobs }: { run: RunSummary | null; jobs: JobRow[] }) {
  const metrics = run?.metrics ?? {};
  const passRate = numberOf(metrics.pass_rate);
  const runJob = jobs.find((job) => job.kind === 'benchmark_run');

  return (
    <>
      <div class="m-title">
        <h2>Run the model through NeMo Gym + Harbor</h2>
        <p>
          NeMo Gym orchestrates the rollout; Harbor executes the task, records the trajectory, and
          scores every criterion. Failed criteria become the input to the failure map.
        </p>
      </div>

      <TableBox>
        <Cap title="Benchmark run ledger">
          <Tally
            items={[
              { value: run ? 1 : 0, label: 'runs' },
              { value: run?.taskCount ?? 0, label: 'tasks' },
              { value: numberOf(metrics.criteria_total), label: 'criteria' },
              { value: `${(passRate * 100).toFixed(1)}%`, label: 'pass rate', hot: passRate < 0.8 },
            ]}
          />
        </Cap>
        {run ? (
          <Table>
            <thead>
              <tr><th>Run</th><th>Benchmark</th><th>Model</th><th class="n">Tasks</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr data-state={runJob?.status ?? 'pending'}>
                <td><span class="nm">{run.label}</span><span class="sub"><Id value={run.runCode} /></span></td>
                <td>{run.benchmarkName}<span class="sub">{run.lab} · {run.adapter}</span></td>
                <td><span class="m-id">{run.model}</span></td>
                <td class="n">{run.taskCount}</td>
                <td><Badge state={runJob?.status ?? 'pending'}>{runJob?.status ?? 'not run'}</Badge></td>
              </tr>
            </tbody>
          </Table>
        ) : <div class="m-empty">No benchmark run has been created.</div>}
      </TableBox>

      <div class="m-split">
        <Panel title="Run configuration" code={run?.runCode ?? 'no run'}>
          <Field label="Benchmark">
            <div class="m-input">{run ? `${run.benchmarkName} / ${run.benchmarkCode}` : '—'}</div>
          </Field>
          <Field label="Model under test">
            <div class="m-input">{run?.model ?? '—'}</div>
          </Field>
          <Field label="Output path">
            <div class="m-input">{run?.outputPath ?? '—'}</div>
          </Field>
        </Panel>
        <Panel title="System preflight" code="status">
          <div class="m-status-list">
            <div><span>Benchmark catalog</span><Badge state={run?.benchmarkStatus ?? 'pending'}>{run?.benchmarkStatus ?? 'missing'}</Badge></div>
            <div><span>Run completed</span><Badge state={runJob?.status ?? 'pending'}>{runJob?.status ?? 'pending'}</Badge></div>
            <div><span>Runnable</span><Badge state={run?.runnable ? 'ready' : 'pending'}>{run?.runnable ? 'yes' : 'no'}</Badge></div>
          </div>
        </Panel>
      </div>
    </>
  );
}
