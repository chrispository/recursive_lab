import type { BenchmarkCriterionResult, BenchmarkTaskCriteria, BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { Cap } from '../ui/Cap.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Icon } from '../ui/Icon.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

/** An em dash, not a zero. A run that recorded nothing did not score nothing. */
const dash = <span class="none">—</span>;

/**
 * A count, tinted only when it is non-zero.
 *
 * A green 0 passed and a red 0 failed both claim something the number does not,
 * so the colour is reserved for counts that actually happened.
 */
function count(value: number | null, tone: 'pass' | 'fail') {
  if (value === null) return dash;
  return <b class={value > 0 ? tone : undefined}>{value}</b>;
}

/**
 * A share of a total, as the group beside it defines it.
 *
 * Deliberately unlabelled: it sits last in its column group, so the header
 * spanning that group says which denominator it is over.
 */
function rate(part: number | null, total: number | null) {
  if (part === null || total === null || total === 0) return dash;
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** Stable per-criterion dialog id. Criterion ids repeat across tasks, so both. */
const dialogId = (taskId: string, criterionId: string) =>
  `cd-${`${taskId}-${criterionId}`.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/**
 * The criterion as the benchmark wrote it.
 *
 * Re-indented for reading and nothing else — no key is renamed, dropped, or
 * reordered, because the point of showing the raw definition is to read what
 * the benchmark actually says rather than this app's account of it. Text that
 * will not parse is shown exactly as stored.
 */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function CriterionDialog({ taskId, criterion }: { taskId: string; criterion: BenchmarkCriterionResult }) {
  return (
    <dialog id={dialogId(taskId, criterion.criterionId)} class="m-dialog">
      <div class="m-dialog-head">
        <div>
          <span class="m-id">{criterion.criterionId}</span>
          <strong>{criterion.title}</strong>
          <span class="m-dialog-sub">{taskId}</span>
        </div>
        <button type="button" class="ghost compact" data-close-dialog aria-label="Close"><Icon name="close" /></button>
      </div>
      <div class="m-dialog-body">
        {criterion.sourceDrifted ? (
          <p class="m-dialog-warn">
            The catalog has been re-imported since this run. The definition below is the current one —
            it is <b>not</b> what the judge applied. The graded wording is shown underneath.
          </p>
        ) : null}
        <span class="m-code">Criterion definition</span>
        {criterion.sourceJson
          ? <pre class="m-dialog-json">{prettyJson(criterion.sourceJson)}</pre>
          : <p class="m-note">No stored definition — the catalog row for this criterion is gone.</p>}

        {/* The wording the judge was given, kept next to the verdict rather
            than inferred from the catalog. When the two agree this is simply
            the same sentence twice, which is the reassuring case. */}
        <span class="m-code">Wording applied by the judge</span>
        <p class="m-dialog-text">{criterion.matchCriteria || 'No criterion text was recorded for this run.'}</p>

        <span class="m-code">Judge</span>
        <p class="m-dialog-text">
          {criterion.judgeModel || 'Model not recorded'}
          {criterion.judgeError ? ` · ${criterion.errorType ?? 'judge error'}` : ''}
        </p>

        <span class="m-code">Verdict</span>
        <p class="m-dialog-text">
          <b class={`m-criterion-result ${criterion.result}`}>{criterion.result.toUpperCase()}</b>
          {' — '}{criterion.reasoning || 'No reasoning recorded.'}
        </p>
      </div>
    </dialog>
  );
}

/**
 * One run per row, with its own counts.
 *
 * The counts used to live in the caption tally at the top right, which meant a
 * page listing several runs showed exactly one run's numbers and left you to
 * guess which. Each pass rate sits immediately after the group it divides —
 * task pass rate closes the task columns, criterion pass rate closes the
 * criterion columns — so neither needs a word to say what its denominator is.
 */
function RunRow({ run, selected }: { run: BenchmarkRunSummary; selected: boolean }) {
  const metrics = run.metrics;
  const graded = run.result !== null && run.result !== 'error';
  const tasksTotal = run.resultTasksTotal ?? run.taskCount;
  const tasksPassed = run.resultTasksPassed;
  const criteriaTotal = run.resultCriteriaTotal ?? 0;
  const criteriaPassed = run.resultCriteriaPassed;
  const ungraded = run.resultCriteriaUngraded ?? 0;
  const name = run.label || run.benchmarkName;
  const rollouts = numberOf(metrics.rollouts) || run.taskCount;
  const state = run.result === 'failed' ? 'failed'
    : run.result === 'error' ? 'error'
    : run.result === 'passed' ? 'succeeded'
    : 'pending';
  const stateWord = run.result === 'passed' ? 'passed' : run.result === 'failed' ? 'failed' : run.result === 'error' ? 'error' : 'pending';
  return (
    <tr data-state={state} class={selected ? 'selected' : undefined}>
      <td>
        <a class="nm" href={`/results?run=${run.benchmarkRunId}`}>{name}</a>
        {/* The benchmark is only worth repeating when the run is not named
            after it, which is the common case once a run carries a label. */}
        <span class="sub">
          {run.benchmarkRunCode}{name === run.benchmarkName ? '' : ` · ${run.benchmarkName}`}
          {' · '}{rollouts} {rollouts === 1 ? 'rollout' : 'rollouts'}
        </span>
      </td>
      <td class="n g">{tasksTotal}</td>
      <td class="n">{count(tasksPassed, 'pass')}</td>
      <td class="n">{count(run.resultTasksFailed, 'fail')}</td>
      <td class="n">{count(run.resultTasksErrored, 'fail')}</td>
      <td class="n rate">{rate(tasksPassed, run.resultTasksTotal)}</td>
      <td class="n g">{graded ? criteriaTotal : dash}</td>
      <td class="n">{count(criteriaPassed, 'pass')}</td>
      <td class="n">{count(run.resultCriteriaFailed, 'fail')}</td>
      {/* Ungraded is its own column, never folded into failed: a criterion the
          judge could not grade is not one the model got wrong, and it means the
          pass rate beside it is over a smaller denominator than the run asked
          for. */}
      <td class="n">{graded ? <b class={ungraded > 0 ? 'warn' : undefined}>{ungraded}</b> : dash}</td>
      <td class="n rate">{rate(criteriaPassed, run.resultCriteriaTotal)}</td>
      <td><Badge state={state}>{stateWord}</Badge></td>
    </tr>
  );
}

export function Results({ benchmarkRun, progress, tasks, availableRuns }: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  /** Criterion verdicts grouped by task — `C-001` repeats across tasks. */
  tasks: BenchmarkTaskCriteria[];
  availableRuns: BenchmarkRunSummary[];
}) {
  const criterionCount = tasks.reduce((sum, task) => sum + task.criteria.length, 0);
  /* Ungraded criteria count as not-passed here on purpose: a criterion the
     judge could not grade is one you still have to look at. */
  const notPassed = tasks.reduce((sum, task) => sum + task.failed + task.errored, 0);
  const resultStatus = benchmarkRun?.result ?? 'pending';

  return (
    <>
      <div class="m-title">
        <h2>Benchmark results</h2>
        <p>Criterion-level failures become the only inputs to capability analysis.</p>
      </div>
      <RunContext benchmarkRun={benchmarkRun} progress={progress} availableRuns={availableRuns} />

      <TableBox>
        <Cap title="Results by run" code={benchmarkRun ? 'criteria below are the selected run' : undefined} />
        {availableRuns.length ? (
          <Table>
            {/* Two header rows: eleven columns of counts do not read without
                the grouping, and the grouping is what lets each pass rate be
                unlabelled. */}
            <thead>
              <tr class="m-table-group">
                <th />
                <th class="g" colspan={5}>Tasks</th>
                <th class="g" colspan={5}>Criteria</th>
              </tr>
              <tr>
                <th>Run</th>
                <th class="n g">Total</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">Errored</th><th class="n">Pass rate</th>
                <th class="n g">Total</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">Ungraded</th><th class="n">Pass rate</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {availableRuns.map((run) => (
                <RunRow run={run} selected={run.benchmarkRunId === benchmarkRun?.benchmarkRunId} />
              ))}
            </tbody>
          </Table>
        ) : <div class="m-empty">No verified benchmark results.</div>}
      </TableBox>

      <TableBox class="m-criteria-box">
        <Cap
          title="Criterion inspection"
          code={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} · ${criterionCount} criteria`}
        >
          {/* The filter is off by default: the panel's job is to show what the
              judge said about every criterion, and hiding passes by default
              would make a clean run look like an empty one. */}
          {notPassed > 0 ? (
            <button
              type="button"
              class="ghost compact m-criteria-filter"
              data-criteria-filter
              aria-pressed="false"
            >Show failed only</button>
          ) : null}
        </Cap>
        {tasks.length ? (
          <div class="m-criteria-list">
            {tasks.map((task) => (
              /* data-unpassed lets the failed-only filter drop whole tasks that
                 have nothing to show, rather than leaving a bare task heading
                 over an empty gap. */
              <section class="m-criteria-task" data-unpassed={task.failed + task.errored}>
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
                      {/* Disclosure state is carried by a glyph, not a marker:
                          the default triangle cannot sit in a fixed column. */}
                      <span class="m-criterion-chev" aria-hidden="true"><Icon name="chevron" /></span>
                    </summary>
                    <div class="m-criterion-body">
                      <p class="m-criterion-reasoning">{criterion.reasoning}</p>
                      <button
                        type="button"
                        class="ghost compact"
                        data-open-dialog={dialogId(task.taskId, criterion.criterionId)}
                      >View task / judge score</button>
                    </div>
                  </details>
                ))}
              </section>
            ))}
            {/* Dialogs live outside the disclosures above on purpose: a
                <dialog> inside a closed <details> has a hidden ancestor and
                cannot open at all. */}
            {tasks.flatMap((task) =>
              task.criteria.map((criterion) => (
                <CriterionDialog taskId={task.taskId} criterion={criterion} />
              )),
            )}
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

      <Handoff stage="results" benchmarkRun={benchmarkRun} progress={progress} />

    </>
  );
}
