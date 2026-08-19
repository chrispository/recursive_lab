import type { PromptRevision } from '../../domain/prompts/model.ts';
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
import { PromptCard } from '../ui/PromptCard.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';
import { Icon } from '../ui/Icon.tsx';
import { count, dash, rate } from '../ui/Metric.tsx';

type FailuresProps = {
  progress: BenchmarkRunProgress | null;
  benchmarkRun: BenchmarkRunSummary | null;
  availableRuns: BenchmarkRunSummary[];
  analysisJob: JobRow | null;
  /** Criterion verdicts grouped by task — criterion ids repeat across tasks. */
  tasks: BenchmarkTaskCriteria[];
  topics: TopicRow[];
  uncategorised: number;
  prompt: PromptRevision | null;
  promptRevisions: PromptRevision[];
  analystModel: string;
  hasApiKey: boolean;
};

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
  prompt,
  promptRevisions,
  analystModel,
  hasApiKey,
}: FailuresProps) {
  const counts = failureCounts(tasks);
  const summary = tally(topics, uncategorised);

  return (
    <>
      <div class="m-title">
        <h2>Failure map</h2>
        <p>
          Inspect one benchmark run and carry only its failure signal into topic generation.
        </p>
      </div>
      <RunContext
        benchmarkRun={benchmarkRun}
        availableRuns={availableRuns}
        failureTopics={progress?.failureMap.entity ? progress.topicCount : undefined}
      />

      <SelectedRunSummary
        benchmarkRun={benchmarkRun}
        progress={progress}
        failed={counts.failed}
      />

      <div class="m-forge-layout">
        <FailureAnalysisConfig
          benchmarkRun={benchmarkRun}
          progress={progress}
          analysisJob={analysisJob}
          failed={counts.failed}
          promptRevisionId={prompt?.promptRevisionId ?? null}
          analystModel={analystModel}
          hasApiKey={hasApiKey}
          hasDataForge={Boolean(progress?.dataForgeRun.entity)}
        />
        <PromptCard
          prompt={prompt}
          revisions={promptRevisions}
          benchmarkRunId={benchmarkRun?.benchmarkRunId ?? null}
          promptRevisionLocked={Boolean(progress?.dataForgeRun.entity)}
          promptKey="failure-analysis"
          title="Failure analysis prompt"
          dialogId="failure-analysis-prompt-editor"
          cardId="failure-prompt-card"
          targetInputId="failure-prompt-revision"
          promptUrl="/ui/failures/prompt"
          revisionsUrl="/ui/failures/prompt/revisions"
        />
      </div>

      <FailureAnalysisStatus
        runId={benchmarkRun?.benchmarkRunId ?? null}
        job={analysisJob}
        progress={progress}
      />

      <TopicTable
        summary={summary}
        topics={topics}
        hasMap={Boolean(progress?.failureMap.entity)}
        failureMapCode={progress?.failureMap.entity ?? null}
      />

      <details class="m-evidence">
        <summary>
          <span class="m-evidence-toggle" aria-hidden="true"><Icon name="chevron" /></span>
          <span class="m-evidence-title">Failure inventory</span>
          <Tally
            items={[
              { value: counts.failed, label: 'failed', hot: counts.failed > 0 },
              { value: counts.errored, label: 'ungraded' },
            ]}
          />
          <span class="m-code m-evidence-note">{counts.failed + counts.errored} {counts.failed + counts.errored === 1 ? 'criterion' : 'criteria'}</span>
        </summary>
        <div class="m-evidence-body">
          <FailureInventory tasks={tasks} />
        </div>
      </details>

      <Handoff stage="failures" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

function FailureAnalysisConfig({
  benchmarkRun,
  progress,
  analysisJob,
  failed,
  promptRevisionId,
  analystModel,
  hasApiKey,
  hasDataForge,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  analysisJob: JobRow | null;
  failed: number;
  promptRevisionId: number | null;
  analystModel: string;
  hasApiKey: boolean;
  hasDataForge: boolean;
}) {
  const running = isLive(analysisJob);
  const hasMap = Boolean(progress?.failureMap.entity);
  const canStart = Boolean(
    benchmarkRun && progress?.benchmarkResult.entity && failed > 0 && hasApiKey && Boolean(analystModel) && !running && !hasDataForge,
  );

  return (
    <section class="m-forge-card">
      <div class="m-forge-card-head">
        <div>
          <h3>Failure analysis run</h3>
          <p>The frontier analyst will inspect each failed criterion and group the signal into a failure map.</p>
        </div>
        <span class="m-code">{progress?.failureMap.entity ?? 'next step · 03'}</span>

      </div>
      <form
        class="m-forge-form"
        hx-post="/ui/failures/map"
        hx-target="#failure-analysis-status"
        hx-swap="outerHTML"
        hx-disabled-elt="find button"
      >
        <input type="hidden" name="benchmark_run_id" value={benchmarkRun ? String(benchmarkRun.benchmarkRunId) : ''} />
        <input id="failure-prompt-revision" type="hidden" name="prompt_revision_id" value={promptRevisionId ? String(promptRevisionId) : ''} />

        <div class="m-forge-field full">
          <label>Selected benchmark run</label>
          <div class="m-input">{benchmarkRun ? `${benchmarkRun.benchmarkRunCode} · ${benchmarkRun.benchmarkName}` : 'No benchmark run selected'}</div>
        </div>

        <div class="m-forge-field">
          <label for="failure-model">Analyst model</label>
          <input id="failure-model" value={analystModel || 'deepseek-v4-flash'} disabled />
        </div>

        <div class="m-forge-field">
          <label>Failed criteria</label>
          <div class="m-input">{failed} {failed === 1 ? 'criterion' : 'criteria'}</div>
        </div>

        <div class="m-forge-actions full">
          <button type="submit" disabled={!canStart}>
            {running
              ? 'Analysis running…'
              : hasMap
                ? 'Regenerate failure map'
                : 'Create failure map + topics'}
          </button>
          {!hasApiKey ? <span class="m-field-note">Configure an analysis or judge API key in Settings first.</span> : null}
          {hasDataForge ? <span class="m-field-note">Locked: Data forge run has already started for this failure map.</span> : null}
        </div>
      </form>
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
      <div
        id={id}
        class="m-analysis-progress"
        role="status"
        aria-live="polite"
        hx-get={`/ui/failures/status?run=${runId}`}
        hx-trigger="every 1s"
        hx-swap="outerHTML"
      >
        <div class="m-analysis-progress-label">
          <span class="m-analysis-progress-step">{job.step || 'Working'}</span>
          <span class="m-id">{job.jobCode}</span>
        </div>
        <div class="m-analysis-progress-track" role="progressbar" aria-label="Analysis in progress">
          <span class="m-analysis-progress-fill" aria-hidden="true" />
        </div>
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
    return <div id={id} class="m-analysis-status"><Badge state="ready">failure map ready</Badge></div>;
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

function TopicTable({
  summary,
  topics,
  hasMap,
  failureMapCode,
}: {
  summary: TopicTally;
  topics: TopicRow[];
  hasMap: boolean;
  failureMapCode?: string | null;
}) {
  return (
    <TableBox>
      <Cap title="Topics extracted from failed criteria" code={failureMapCode ?? undefined}>
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

function FailureInventory({ tasks }: { tasks: BenchmarkTaskCriteria[] }) {
  if (!tasks.some((task) => task.failed + task.errored > 0)) {
    return (
      <div class="m-empty">
        {tasks.length ? 'This run passed every imported criterion.' : 'No criterion verdicts were imported for this run.'}
      </div>
    );
  }
  return (
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
