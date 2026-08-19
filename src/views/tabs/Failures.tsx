import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { isLive, type JobRow } from '../../domain/jobs/model.ts';
import type {
  BenchmarkCriterionResult,
  BenchmarkRunSummary,
  BenchmarkTaskCriteria,
} from '../../domain/runs/model.ts';
import { isBelowThreshold, type TopicRow } from '../../domain/topics/model.ts';
import { tally, type TopicTally } from '../../domain/topics/service.ts';
import { Badge } from '../ui/Badge.tsx';
import { Bar } from '../ui/Bar.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Id } from '../ui/Id.tsx';
import { Panel } from '../ui/Panel.tsx';
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
  runProgress: BenchmarkRunProgress[];
  analysisJob: JobRow | null;
  /** Criterion verdicts grouped by task — criterion ids repeat across tasks. */
  tasks: BenchmarkTaskCriteria[];
  topics: TopicRow[];
  uncategorised: number;
};

const formatReward = (value: number | null) => (value === null ? '—' : value.toFixed(3));

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
  runProgress,
  analysisJob,
  tasks,
  topics,
  uncategorised,
}: FailuresProps) {
  const counts = failureCounts(tasks);
  const selectedFailures = counts.failed + counts.errored;
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
        errored={counts.errored}
        selectedFailures={selectedFailures}
      />

      <div class="m-split">
        <Panel title="Failure analysis" code="selected run">
          <Field label="Benchmark run">
            <div class="m-input">
              {benchmarkRun ? (
                <>
                  <Id value={benchmarkRun.benchmarkRunCode} />
                  {' · '}{benchmarkRun.label} · {benchmarkRun.model}
                </>
              ) : 'No benchmark run selected'}
            </div>
          </Field>
          <Field label="Analysis input" note="The failure inventory below is the handoff to the frontier analyst.">
            <div class="m-input">
              {selectedFailures ? `${selectedFailures} criteria need analysis` : 'No failed criteria yet'}
            </div>
          </Field>
          <div class="m-actions">
            <form
              hx-post="/ui/failures/map"
              hx-target="#failure-analysis-status"
              hx-swap="outerHTML"
              hx-disabled-elt="find button"
            >
              <input type="hidden" name="benchmark_run_id" value={benchmarkRun ? String(benchmarkRun.benchmarkRunId) : ''} />
              <button
                type="submit"
                disabled={!benchmarkRun || !progress?.benchmarkResult.entity || !counts.failed || Boolean(progress.failureMap.entity) || isLive(analysisJob)}
              >
                {isLive(analysisJob) ? 'Analysis running…' : progress?.failureMap.entity ? 'Failure map created' : 'Create failure map + topics'}
              </button>
            </form>
          </div>
          <FailureAnalysisStatus runId={benchmarkRun?.benchmarkRunId ?? null} job={analysisJob} progress={progress} />
        </Panel>

        <Panel title="Analysis boundary" code="anti-benchmax">
          <p class="m-note">
            Only criterion titles and judge reasoning belong in this analysis surface. Benchmark
            source documents, task answers, names, dates, and figures stay outside topic and
            verifier generation.
          </p>
          <p class="m-note">
            Topics are scoped to the failure map that produced them, so later data generation can
            use the topic description and verifier strategy without seeing the originating task.
          </p>
        </Panel>
      </div>

      <FailureMapLedger
        selectedRunId={benchmarkRun?.benchmarkRunId ?? null}
        runProgress={runProgress}
        availableRuns={availableRuns}
      />

      <TopicTable summary={summary} topics={topics} hasMap={Boolean(progress?.failureMap.entity)} />

      <FailureInventory tasks={tasks} failed={counts.failed} errored={counts.errored} />
      <Handoff stage="failures" benchmarkRun={benchmarkRun} progress={progress} />
    </>
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
  errored,
  selectedFailures,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  failed: number;
  errored: number;
  selectedFailures: number;
}) {
  return (
    <TableBox>
      <Cap
        title="Selected run"
        code={benchmarkRun ? `${benchmarkRun.taskCount} ${benchmarkRun.taskCount === 1 ? 'task' : 'tasks'}` : 'no run'}
      >
        <Tally
          items={[
            { value: selectedFailures, label: 'criteria to analyse', hot: selectedFailures > 0 },
            { value: failed, label: 'failed' },
            { value: errored, label: 'ungraded' },
            { value: progress?.topicCount ?? 0, label: 'topics' },
            { value: progress?.dataForgeRun.count ?? 0, label: 'docs generated' },
          ]}
        />
      </Cap>
      {benchmarkRun ? (
        <Table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Benchmark</th>
              <th>Model</th>
              <th>Status</th>
              <th class="n">Pass rate</th>
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
              <td><Badge state={benchmarkRun.result === 'failed' ? 'failed' : benchmarkRun.result === 'error' ? 'pending' : 'ready'}>{benchmarkRun.result ?? 'pending'}</Badge></td>
              <td class="n">{progress?.passRate === null || progress?.passRate === undefined ? '—' : `${(progress.passRate * 100).toFixed(1)}%`}</td>
            </tr>
          </tbody>
        </Table>
      ) : <div class="m-empty">No benchmark runs available.</div>}
    </TableBox>
  );
}

function FailureMapLedger({
  selectedRunId,
  runProgress,
  availableRuns,
}: {
  selectedRunId: number | null;
  runProgress: BenchmarkRunProgress[];
  availableRuns: BenchmarkRunSummary[];
}) {
  const runsById = new Map(availableRuns.map((run) => [run.benchmarkRunId, run]));
  const maps = runProgress.filter((item) => item.failureMap.entity);

  return (
    <TableBox>
      <Cap title="Failure map ledger" code={maps.length ? `${maps.length} ${maps.length === 1 ? 'map' : 'maps'}` : 'no maps'} />
      {maps.length ? (
        <Table>
          <thead>
            <tr>
              <th>Map</th>
              <th>Source run</th>
              <th class="n">Failures</th>
              <th class="n">Topics</th>
              <th class="n">Docs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {maps.map((item) => {
              const run = runsById.get(item.benchmarkRunId);
              if (!run) return null;
              return (
                <tr data-state="ready" class={item.benchmarkRunId === selectedRunId ? 'selected' : undefined}>
                  <td>
                    <span class="nm"><Id value={item.failureMap.entity!} /></span>
                    <span class="sub">Connected to {item.benchmarkRunCode}</span>
                  </td>
                  <td>
                    <a class="nm" href={`/failures?run=${item.benchmarkRunId}`}>{run.label}</a>
                    <span class="sub">{run.model}</span>
                  </td>
                  <td class="n">{item.failureMap.count}</td>
                  <td class="n">{item.topicCount}</td>
                  <td class="n">{item.dataForgeRun.count}</td>
                  <td><Badge state="ready">mapped</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <div class="m-empty">No failure maps yet. The selected run's inventory is ready below.</div>
      )}
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
            { value: summary.documents, label: 'docs generated' },
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
              <th class="n">Reward</th>
              <th>Verifier</th>
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
                <td class="n">{formatReward(topic.reward)}</td>
                <td><Bar value={topic.reward} below={isBelowThreshold(topic)} /></td>
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
                    {failures.length} {failures.length === 1 ? 'criterion' : 'criteria'} for analysis
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
