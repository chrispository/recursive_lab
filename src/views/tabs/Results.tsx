import type { RunSummary } from '../../domain/runs/model.ts';
import type { JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

export function Results({ run, jobs }: { run: RunSummary | null; jobs: JobRow[] }) {
  const metrics = run?.metrics ?? {};
  const total = numberOf(metrics.criteria_total);
  const passed = numberOf(metrics.criteria_passed);
  const failed = Math.max(0, total - passed);
  const rate = numberOf(metrics.pass_rate);

  return (
    <>
      <div class="m-title">
        <h2>Verified benchmark results</h2>
        <p>Criterion-level failures become the only inputs to capability analysis.</p>
      </div>

      <TableBox>
        <Cap title="Result rollup">
          <Tally items={[
            { value: total, label: 'criteria' },
            { value: passed, label: 'passed' },
            { value: failed, label: 'failed', hot: failed > 0 },
            { value: `${(rate * 100).toFixed(1)}%`, label: 'pass rate' },
          ]} />
        </Cap>
        {run ? (
          <Table>
            <thead><tr><th>Run</th><th>Model</th><th class="n">Rollouts</th><th class="n">Input tokens</th><th class="n">Output tokens</th><th>Status</th></tr></thead>
            <tbody>
              <tr data-state="succeeded">
                <td><span class="nm">{run.label}</span><span class="sub">{run.runCode} · {run.benchmarkName}</span></td>
                <td>{run.model}</td>
                <td class="n">{numberOf(metrics.rollouts)}</td>
                <td class="n">{numberOf(metrics.input_tokens).toLocaleString()}</td>
                <td class="n">{numberOf(metrics.output_tokens).toLocaleString()}</td>
                <td><Badge state="succeeded">verified</Badge></td>
              </tr>
            </tbody>
          </Table>
        ) : <div class="m-empty">No verified benchmark results.</div>}
      </TableBox>

      <TableBox>
        <Cap title="Execution ledger" code={`${jobs.length} jobs`} />
        {jobs.length ? (
          <Table>
            <thead><tr><th>Job</th><th>Stage</th><th>Subject</th><th>Step</th><th>Status</th></tr></thead>
            <tbody>{jobs.map((job) => (
              <tr data-state={job.status}>
                <td><span class="m-id">{job.jobCode}</span></td>
                <td>{job.kind.replaceAll('_', ' ')}</td>
                <td><span class="m-id">{job.subjectCode}</span></td>
                <td>{job.step}</td>
                <td><Badge state={job.status}>{job.status}</Badge></td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div class="m-empty">No execution jobs for this run.</div>}
      </TableBox>

      <div class="m-split">
        <Panel title="Interpretation" code="criteria">
          <p class="m-note">The result is a criterion pass rate, not a document-quality score. The {failed} failed criteria are the source of the current failure map.</p>
        </Panel>
        <Panel title="Run settings" code="saved with BR">
          <Field label="Repeats"><div class="m-input">{String(run?.settings.repeats ?? '—')}</div></Field>
          <Field label="Judge parallelism"><div class="m-input">{String(run?.settings.judge_parallelism ?? '—')}</div></Field>
        </Panel>
      </div>
    </>
  );
}
