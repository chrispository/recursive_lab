import type { BenchmarkCriterionResult, BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

export function Results({ benchmarkRun, jobs, criteria, availableRuns }: {
  benchmarkRun: BenchmarkRunSummary | null;
  jobs: JobRow[];
  criteria: BenchmarkCriterionResult[];
  availableRuns: BenchmarkRunSummary[];
}) {
  const metrics = benchmarkRun?.metrics ?? {};
  const total = numberOf(benchmarkRun?.resultCriteriaTotal ?? metrics.criteria_total);
  const passed = numberOf(benchmarkRun?.resultCriteriaPassed ?? metrics.criteria_passed);
  const failed = numberOf(benchmarkRun?.resultCriteriaFailed ?? Math.max(0, total - passed));
  const rate = total > 0 ? passed / total : 0;
  const resultStatus = benchmarkRun?.resultOutcome ?? 'pending';

  return (
    <>
      <div class="m-title">
        <h2>Benchmark results</h2>
        <p>Criterion-level failures become the only inputs to capability analysis.</p>
        {availableRuns.length ? (
          <form class="m-run-picker" method="get">
            <label for="results-run">Benchmark run</label>
            <select id="results-run" name="run">
              {availableRuns.map((run) => (
                <option value={String(run.benchmarkRunId)} selected={run.benchmarkRunId === benchmarkRun?.benchmarkRunId}>
                  {run.benchmarkRunCode} · {run.label} · {run.model}
                </option>
              ))}
            </select>
            <button class="compact" type="submit">Show results</button>
          </form>
        ) : null}
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
        {benchmarkRun ? (
          <Table>
            <thead><tr><th>Run</th><th>Model</th><th class="n">Rollouts</th><th class="n">Input tokens</th><th class="n">Output tokens</th><th>Status</th></tr></thead>
            <tbody>
              <tr data-state={resultStatus}>
                <td><span class="nm">{benchmarkRun.label}</span><span class="sub">{benchmarkRun.benchmarkRunCode} · {benchmarkRun.benchmarkName}</span></td>
                <td>{benchmarkRun.model}</td>
                <td class="n">{numberOf(metrics.rollouts)}</td>
                <td class="n">{numberOf(metrics.input_tokens).toLocaleString()}</td>
                <td class="n">{numberOf(metrics.output_tokens).toLocaleString()}</td>
                <td><Badge state={resultStatus}>{resultStatus}</Badge></td>
              </tr>
            </tbody>
          </Table>
        ) : <div class="m-empty">No verified benchmark results.</div>}
      </TableBox>

      <TableBox class="m-criteria-box">
        <Cap title="Criterion inspection" code={`${criteria.length} criteria`} />
        {criteria.length ? (
          <div class="m-criteria-list">
            {criteria.map((criterion) => (
              <details class={`m-criterion ${criterion.verdict}`} open={criterion.verdict === 'fail'}>
                <summary>
                  <span class="m-criterion-verdict">{criterion.verdict.toUpperCase()}</span>
                  <span class="m-id">{criterion.criterionId}</span>
                  <span class="m-criterion-title">{criterion.title}</span>
                </summary>
                <div class="m-criterion-body">
                  <p class="m-criterion-reasoning">{criterion.reasoning}</p>
                  <details class="m-criterion-source">
                    <summary>View task / judge score</summary>
                    <div class="m-criterion-source-body">
                      <div><span class="m-code">Task criterion</span><p>{criterion.matchCriteria || 'No task criterion text was recorded.'}</p></div>
                      <div><span class="m-code">Judge</span><p>{criterion.judgeModel || 'Model not recorded'}{criterion.judgeError ? ` · ${criterion.errorType ?? 'judge error'}` : ''}</p></div>
                    </div>
                  </details>
                </div>
              </details>
            ))}
          </div>
        ) : <div class="m-empty">No criterion-level inspection was imported.</div>}
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
          <Field label="Repeats"><div class="m-input">{String(benchmarkRun?.settings.repeats ?? '—')}</div></Field>
          <Field label="Judge parallelism"><div class="m-input">{String(benchmarkRun?.settings.judge_parallelism ?? '—')}</div></Field>
        </Panel>
      </div>
    </>
  );
}
