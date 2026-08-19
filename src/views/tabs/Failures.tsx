import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { isLive, type JobRow } from '../../domain/jobs/model.ts';
import type {
  BenchmarkCriterionResult,
  BenchmarkRunSummary,
  BenchmarkTaskCriteria,
} from '../../domain/runs/model.ts';
import type { TopicRow } from '../../domain/topics/model.ts';
import { tally, type TopicTally } from '../../domain/topics/service.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Id } from '../ui/Id.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';
import { Icon } from '../ui/Icon.tsx';

type FailuresProps = {
  progress: BenchmarkRunProgress | null;
  benchmarkRun: BenchmarkRunSummary | null;
  availableRuns: BenchmarkRunSummary[];
  analysisJob: JobRow | null;
  /** Criterion verdicts grouped by task — criterion ids repeat across tasks. */
  tasks: BenchmarkTaskCriteria[];
  topics: TopicRow[];
  uncategorised: number;
};

const dash = <span class="none">—</span>;

function count(value: number | null, tone: 'pass' | 'fail' | 'warn') {
  if (value === null) return dash;
  return <b class={value > 0 ? tone : undefined}>{value}</b>;
}

function rate(part: number | null, total: number | null) {
  if (part === null || total === null || total === 0) return dash;
  return `${((part / total) * 100).toFixed(1)}%`;
}

function failureCounts(tasks: BenchmarkTaskCriteria[]) {
  return tasks.reduce(
    (counts, task) => ({
      failed: counts.failed + task.failed,
      errored: counts.errored + task.errored,
    }),
    { failed: 0, errored: 0 },
  );
}

export function Failures({
  progress,
  benchmarkRun,
  availableRuns,
  analysisJob,
  tasks,
  topics,
  uncategorised,
}: FailuresProps) {
  const counts = failureCounts(tasks);
  const summary = tally(topics, uncategorised);

  return (
    <>
      <div class="m-title">
        <h2>Turn misses into capability topics</h2>
        <p>
          Inspect one benchmark run and carry only its failure signal into topic generation.
        </p>
      </div>
      <RunContext benchmarkRun={benchmarkRun} progress={progress} availableRuns={availableRuns} />

      <SelectedRunSummary
        benchmarkRun={benchmarkRun}
        progress={progress}
        failed={counts.failed}
      />

      <FailureAnalysisHandoff
        benchmarkRun={benchmarkRun}
        progress={progress}
        analysisJob={analysisJob}
        failed={counts.failed}
      />

      <TopicTable summary={summary} topics={topics} hasMap={Boolean(progress?.failureMap.entity)} />

      <details class="m-evidence">
        <summary>
          <span class="m-evidence-toggle" aria-hidden="true"><Icon name="chevron" /></span>
          <span class="m-evidence-title">Failure inventory</span>
          <span class="m-evidence-note">source criteria</span>
        </summary>
        <div class="m-evidence-body">
          <FailureInventory tasks={tasks} failed={counts.failed} errored={counts.errored} />
        </div>
      </details>
      <Handoff stage="failures" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

function FailureAnalysisHandoff({
  benchmarkRun,
  progress,
  analysisJob,
  failed,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  analysisJob: JobRow | null;
  failed: number;
}) {
  return (
    <section class="m-analysis-handoff">
      <div class="m-analysis-handoff-copy">
        <h3>Turn these misses into capability topics</h3>
        <p>The frontier analyst will inspect each failed criterion and group the signal into a failure map.</p>
        <div class="m-analysis-meta">
          <span><b>{failed}</b> failed criteria</span>
          <span><b>{progress?.topicCount ?? 0}</b> topics</span>
        </div>
      </div>
      <div class="m-analysis-action">
        <small>next step · 03</small>
        <form
          hx-post="/ui/failures/map"
          hx-target="#failure-analysis-status"
          hx-swap="outerHTML"
          hx-disabled-elt="find button"
        >
          <input type="hidden" name="benchmark_run_id" value={benchmarkRun ? String(benchmarkRun.benchmarkRunId) : ''} />
          <button
            type="submit"
            disabled={!benchmarkRun || !progress?.benchmarkResult.entity || !failed || Boolean(progress.failureMap.entity) || isLive(analysisJob)}
          >
            {isLive(analysisJob) ? 'Analysis running…' : progress?.failureMap.entity ? 'Failure map created' : 'Create failure map + topics'}
          </button>
        </form>
      </div>
      <FailureAnalysisStatus runId={benchmarkRun?.benchmarkRunId ?? null} job={analysisJob} progress={progress} />
    </section>
  );
}

export function FailureAnalysisStatus({
  runId,
  job,
  progress,
  refreshWhenReady = false,
}: {
  runId: number | null;
  job: JobRow | null;
  progress: BenchmarkRunProgress | null;
  refreshWhenReady?: boolean;
}) {
  const id = 'failure-analysis-status';
  if (runId && job && isLive(job)) {
    return (
      <div id={id} class="m-analysis-status" hx-get={`/ui/failures/status?run=${runId}`} hx-trigger="every 1s" hx-swap="outerHTML">
        <Badge state="running">analysis running</Badge>
        <span>{job.step || 'Working'} · {job.jobCode}</span>
      </div>
    );
  }
  if (runId && job?.status === 'failed') {
    return (
      <div id={id} class="m-analysis-status">
        <Badge state="failed">analysis failed</Badge>
        <span>{job.error || 'The failure analyst job failed.'}</span>
      </div>
    );
  }
  if (runId && progress?.failureMap.entity && refreshWhenReady) {
    return (
      <div id={id} class="m-analysis-status" hx-get={`/failures?run=${runId}`} hx-trigger="load" hx-target="#workspace" hx-swap="innerHTML">
        <Badge state="ready">failure map ready</Badge>
        <span>Refreshing the selected run…</span>
      </div>
    );
  }
  if (progress?.failureMap.entity) {
    return <div id={id} class="m-analysis-status"><Badge state="ready">failure map ready</Badge><span>{progress.failureMap.entity}</span></div>;
  }
  return <div id={id} class="m-analysis-status"><Badge state="pending">not started</Badge><span>Use the selected run's failed criteria to create a map.</span></div>;
}

function SelectedRunSummary({
  benchmarkRun,
  progress,
  failed,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  failed: number;
}) {
  return (
    <TableBox>
      <Cap
        title="Selected run"
        code={benchmarkRun ? `${benchmarkRun.taskCount} ${benchmarkRun.taskCount === 1 ? 'task' : 'tasks'}` : 'no run'}
      >
        <Tally
          items={[
            { value: failed, label: 'failed' },
            { value: progress?.topicCount ?? 0, label: 'topics' },
          ]}
        />
      </Cap>
      {benchmarkRun ? (
        <Table>
          <thead>
            <tr class="m-table-group">
              <th colspan={3} />
              <th class="g" colspan={5}>Tasks</th>
              <th class="g" colspan={5}>Criteria</th>
              <th />
            </tr>
            <tr>
              <th>Run</th>
              <th>Benchmark</th>
              <th>Test model</th>
              <th class="n g">Total</th>
              <th class="n">Passed</th>
              <th class="n">Failed</th>
              <th class="n">Errored</th>
              <th class="n">Pass rate</th>
              <th class="n g">Total</th>
              <th class="n">Passed</th>
              <th class="n">Failed</th>
              <th class="n">Ungraded</th>
              <th class="n">Pass rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr data-state={benchmarkRun.result === 'failed' ? 'failed' : benchmarkRun.result === 'error' ? 'error' : 'ready'}>
              <td>
                <span class="nm">{benchmarkRun.label}</span>
                <span class="sub"><Id value={benchmarkRun.benchmarkRunCode} /></span>
              </td>
              <td>
                {benchmarkRun.benchmarkName}
                <span class="sub"><Id value={benchmarkRun.benchmarkCode} /></span>
              </td>
              <td>{benchmarkRun.model}</td>
              <td class="n g">{benchmarkRun.resultTasksTotal ?? benchmarkRun.taskCount}</td>
              <td class="n">{count(benchmarkRun.resultTasksPassed, 'pass')}</td>
              <td class="n">{count(benchmarkRun.resultTasksFailed, 'fail')}</td>
              <td class="n">{count(benchmarkRun.resultTasksErrored, 'warn')}</td>
              <td class="n rate">{rate(benchmarkRun.resultTasksPassed, benchmarkRun.resultTasksTotal)}</td>
              <td class="n g">{benchmarkRun.resultCriteriaTotal === null ? dash : benchmarkRun.resultCriteriaTotal}</td>
              <td class="n">{count(benchmarkRun.resultCriteriaPassed, 'pass')}</td>
              <td class="n">{count(benchmarkRun.resultCriteriaFailed, 'fail')}</td>
              <td class="n">{count(benchmarkRun.resultCriteriaUngraded, 'warn')}</td>
              <td class="n rate">{rate(benchmarkRun.resultCriteriaPassed, benchmarkRun.resultCriteriaTotal)}</td>
              <td><Badge state={benchmarkRun.result === 'failed' ? 'failed' : benchmarkRun.result === 'error' ? 'pending' : 'ready'}>{benchmarkRun.result ?? 'pending'}</Badge></td>
            </tr>
          </tbody>
        </Table>
      ) : <div class="m-empty">No benchmark runs available.</div>}
    </TableBox>
  );
}

function TopicTable({ summary, topics, hasMap }: { summary: TopicTally; topics: TopicRow[]; hasMap: boolean }) {
  return (
    <TableBox>
      <Cap title="Topics extracted from failed criteria">
        <Tally
          items={[
            { value: summary.topics, label: 'topics' },
            { value: summary.failures, label: 'failures mapped', hot: summary.failures > 0 },
            { value: summary.uncategorised, label: 'uncategorized' },
            { value: summary.documents, label: 'docs approved' },
          ]}
        />
      </Cap>
      {topics.length ? (
        <Table>
          <thead>
            <tr>
              <th>Topic</th>
              <th>Id</th>
              <th class="n">Fails</th>
              <th class="n">Docs</th>
              <th>Verifier strategy</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic) => (
              <tr data-hot={topic.slug === summary.hottestSlug ? '1' : undefined}>
                <td>
                  <span class="nm">{topic.name}</span>
                  <span class="sub">{topic.description}</span>
                </td>
                <td><Id value={topic.code} /></td>
                <td class="n">{topic.failureCount}</td>
                <td class="n">{topic.documentCount}</td>
                <td><span class="sub">{topic.verifierStrategy}</span></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div class="m-empty">{hasMap ? 'No topics extracted for this failure map.' : 'Create a failure map to populate the topic taxonomy.'}</div>
      )}
    </TableBox>
  );
}

function FailureInventory({ tasks, failed, errored }: { tasks: BenchmarkTaskCriteria[]; failed: number; errored: number }) {
  return (
    <TableBox class="m-failure-box">
      <Cap title="Failure inventory" code={`${failed + errored} ${failed + errored === 1 ? 'criterion' : 'criteria'}`}>
        <Tally
          items={[
            { value: failed, label: 'failed', hot: failed > 0 },
            { value: errored, label: 'ungraded' },
          ]}
        />
      </Cap>
      {tasks.some((task) => task.failed + task.errored > 0) ? (
        <div class="m-criteria-list">
          {tasks.map((task) => {
            const failures = task.criteria.filter((criterion) => criterion.result !== 'pass');
            if (!failures.length) return null;
            return (
              <section class="m-criteria-task" data-unpassed={failures.length}>
                <header class="m-criteria-task-head">
                  <span class="m-id">{task.taskId}</span>
                  <span class="m-criteria-task-tally">
                    {failures.length} {failures.length === 1 ? 'unpassed criterion' : 'unpassed criteria'}
                  </span>
                </header>
                {failures.map((criterion) => <FailureCriterion criterion={criterion} />)}
              </section>
            );
          })}
        </div>
      ) : (
        <div class="m-empty">
          {tasks.length ? 'This run passed every imported criterion.' : 'No criterion verdicts were imported for this run.'}
        </div>
      )}
    </TableBox>
  );
}

function FailureCriterion({ criterion }: { criterion: BenchmarkCriterionResult }) {
  return (
    <details class={`m-criterion ${criterion.result}`} open>
      <summary>
        <span class="m-criterion-result">{criterion.result === 'error' ? 'UNGRADED' : 'FAILED'}</span>
        <span class="m-id">{criterion.criterionId}</span>
        <span class="m-criterion-title">{criterion.title}</span>
        {criterion.judgeError ? <span class="m-criterion-error">{criterion.errorType ?? 'judge error'}</span> : null}
        <span class="m-criterion-chev" aria-hidden="true"><Icon name="chevron" /></span>
      </summary>
      <div class="m-criterion-body">
        <p class="m-criterion-reasoning">{criterion.reasoning || 'No judge reasoning was recorded.'}</p>
        <p class="m-failure-meta">
          <span>Judge: {criterion.judgeModel || 'not recorded'}</span>
          <span>Criterion wording: {criterion.matchCriteria || 'not recorded'}</span>
        </p>
      </div>
    </details>
  );
}
