import type { BenchmarkTaskCriteria, BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

export function Results({ benchmarkRun, jobs, tasks, availableRuns }: {
  benchmarkRun: BenchmarkRunSummary | null;
  jobs: JobRow[];
  /** Criterion verdicts grouped by task — `C-001` repeats across tasks. */
  tasks: BenchmarkTaskCriteria[];
  availableRuns: BenchmarkRunSummary[];
}) {
  const criterionCount = tasks.reduce((sum, task) => sum + task.criteria.length, 0);
  const metrics = benchmarkRun?.metrics ?? {};
  const total = numberOf(benchmarkRun?.resultCriteriaTotal ?? metrics.criteria_total);
  const passed = numberOf(benchmarkRun?.resultCriteriaPassed ?? metrics.criteria_passed);
  const failed = numberOf(benchmarkRun?.resultCriteriaFailed ?? Math.max(0, total - passed));
  const errored = tasks.reduce((sum, task) => sum + task.errored, 0);
  const rate = total > 0 ? passed / total : 0;
  const resultStatus = benchmarkRun?.result ?? 'pending';

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
            // Ungraded is its own column, never folded into failed: a criterion
            // the judge could not grade is not one the model got wrong, and it
            // means the pass rate beside it is over a smaller denominator than
            // the run asked for.
            { value: errored, label: 'ungraded', hot: errored > 0 },
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
        <Cap
          title="Criterion inspection"
          code={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} · ${criterionCount} criteria`}
        />
        {tasks.length ? (
          <div class="m-criteria-list">
            {tasks.map((task) => (
              <section class="m-criteria-task">
                {/* Criterion ids restart at C-001 on every task, so the task
                    heading is what makes the rows below unambiguous. */}
                <header class="m-criteria-task-head">
                  <span class="m-id">{task.taskId}</span>
                  <span class="m-criteria-task-tally">
                    {task.passed} passed · <b class={task.failed > 0 ? 'hot' : ''}>{task.failed} failed</b>
                    {task.errored > 0 ? <> · {task.errored} ungraded</> : null}
                  </span>
                </header>
                {/* Errored criteria open alongside failed ones. A judge that
                    could not grade is a problem with the run, not a quiet
                    footnote — the reason it errored belongs on the summary
                    line, not two disclosures down. */}
                {task.criteria.map((criterion) => (
                  <details class={`m-criterion ${criterion.result}`} open={criterion.result !== 'pass'}>
                    <summary>
                      <span class="m-criterion-result">{criterion.result.toUpperCase()}</span>
                      <span class="m-id">{criterion.criterionId}</span>
                      <span class="m-criterion-title">{criterion.title}</span>
                      {criterion.judgeError ? (
                        <span class="m-criterion-error">{criterion.errorType ?? 'judge error'}</span>
                      ) : null}
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
              </section>
            ))}
          </div>
        ) : (
          // "Nothing imported" is only one reason this list is empty, and it was
          // the wrong one to show a run that errored before it graded anything —
          // it sent you looking at the import for a fault in the run.
          <div class="m-empty">
            {resultStatus === 'error'
              ? 'This run errored before anything was graded. The execution ledger below has the reason.'
              : resultStatus === 'pending'
                ? 'No run selected yet.'
                : 'No criterion-level inspection was imported.'}
          </div>
        )}
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
                {/* A failed job's error is the whole point of the row. Showing
                    the step instead left the ledger reporting the phase it died
                    in and nothing about what killed it. */}
                <td>{job.error || job.step}</td>
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
          {/* `settings_json` is written from RunSettings, so the keys are camelCase. */}
          <Field label="Judge parallelism"><div class="m-input">{String(benchmarkRun?.settings.judgeParallelism ?? '—')}</div></Field>
        </Panel>
      </div>
    </>
  );
}
