/**
 * Env lab, stage 06: prove PI environments locally. One region —
 * `#env-lab-body` — owns everything below the run context, so build/evaluation
 * actions swap it whole and the job status polls separately.
 */
import type { EnvironmentRow, EvaluationSummary } from '../../domain/environments/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { isLive, type JobLogLine, type JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { EnvironmentInbox } from './env-lab/EnvironmentInbox.tsx';
import { EnvLabStages } from './env-lab/Stages.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';
import { JobLog } from '../jobs/Log.tsx';

export type EnvLabSettings = {
  policyModel: string;
  policyConfigured: boolean;
  judgeModel: string;
  judgeConfigured: boolean;
  primeInstalled: boolean;
};

export type EnvLabJobLog = { job: JobRow | null; lines: JobLogLine[] };

export function EnvLab({
  benchmarkRun,
  progress,
  availableRuns,
  environments,
  rlTest,
  validation,
  buildJob,
  evalJob,
  jobLog,
  settings,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  availableRuns: BenchmarkRunSummary[];
  environments: EnvironmentRow[];
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  buildJob: JobRow | null;
  evalJob: JobRow | null;
  jobLog: EnvLabJobLog;
  settings: EnvLabSettings;
}) {
  return (
    <>
      <div class="m-title">
        <h2>Environment lab</h2>
        <p>
          Prime runs the package and the policy model here. A passing local validation unlocks the
          immutable training handoff; the cluster always trains on 4 rollouts per example.
        </p>
      </div>
      <RunContext
        benchmarkRun={benchmarkRun}
        availableRuns={availableRuns}
        failureTopics={progress?.topicCount}
      />
      <EnvLabBody
        benchmarkRun={benchmarkRun}
        progress={progress}
        environments={environments}
        rlTest={rlTest}
        validation={validation}
        buildJob={buildJob}
        evalJob={evalJob}
        jobLog={jobLog}
        settings={settings}
      />
      <Handoff stage="env-lab" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

/** The swappable region: everything between the run context and the handoff. */
export function EnvLabBody({
  benchmarkRun,
  progress,
  environments,
  rlTest,
  validation,
  buildJob,
  evalJob,
  jobLog,
  settings,
  oob = false,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  environments: EnvironmentRow[];
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  buildJob: JobRow | null;
  evalJob: JobRow | null;
  jobLog: EnvLabJobLog;
  settings: EnvLabSettings;
  oob?: boolean;
}) {
  const built = environments.filter((e) => e.status === 'built' || e.status === 'ready');
  const rlPassed = built.filter((e) => e.rlTest && !e.rlTest.error && e.rlTest.meanReward !== null && e.rlTest.meanReward >= e.passThreshold).length;
  const validated = built.filter((e) => e.validation && !e.validation.error && e.validation.meanReward !== null && e.validation.meanReward >= e.passThreshold).length;
  const scaleReady = environments.filter((e) => e.scaleReady);
  const hasDocuments = (progress?.dataForgeRun.count ?? 0) > 0;
  const packageComplete = environments.length > 0 && built.length === environments.length;
  const canBuild = Boolean(benchmarkRun && hasDocuments && settings.primeInstalled && !packageComplete);
  const canEval = built.length > 0
    && settings.policyConfigured && settings.judgeConfigured && settings.primeInstalled;
  const evalBusy = isLive(evalJob);
  const cleanRl = Boolean(rlTest && rlTest.erroredEnvironments === 0 && rlTest.tasksScored > 0);

  return (
    <div id="env-lab-body" hx-swap-oob={oob ? 'true' : undefined}>
      <form
        id="env-lab-run-form"
        class="m-env-run-form"
        hx-post="/ui/env-lab/start"
        hx-target="#env-lab-status"
        hx-swap="none"
        hx-disabled-elt="find button"
      >
        <input type="hidden" name="benchmark_run_id" value={String(benchmarkRun?.benchmarkRunId ?? 0)} />
        <EnvLabStages
          environments={environments}
          rlTest={rlTest}
          validation={validation}
          buildJob={buildJob}
          evalJob={evalJob}
          canBuild={canBuild}
          canRunRl={canEval && !evalBusy}
          canRunValidation={canEval && cleanRl && !evalBusy}
          policyModel={settings.policyModel}
        />
        <ProveLocally
          environments={environments}
          progress={progress}
          rlTest={rlTest}
          validation={validation}
          settings={settings}
        />
      </form>

      <TableBox>
        <Cap title="Environment readiness" code={validation?.evaluationCode ?? rlTest?.evaluationCode ?? undefined}>
          <Tally items={[
            { value: environments.length, label: 'environments' },
            { value: built.length, label: 'built' },
            { value: rlPassed, label: 'rl passed' },
            { value: validated, label: 'validated' },
            { value: scaleReady.length, label: 'scale ready', hot: scaleReady.length > 0 },
            { value: (validation?.meanReward ?? rlTest?.meanReward ?? null)?.toFixed(3) ?? '—', label: 'mean reward' },
          ]} />
        </Cap>
        <EnvironmentInbox environments={environments} buildJob={buildJob} evalJob={evalJob} />
      </TableBox>

      <EnvLabStatus
        runId={benchmarkRun?.benchmarkRunId ?? null}
        buildJob={buildJob}
        evalJob={evalJob}
        rlTest={rlTest}
        validation={validation}
      />

      <JobLog job={jobLog.job} lines={jobLog.lines} />

    </div>
  );
}

function ProveLocally({
  environments,
  progress,
  rlTest,
  validation,
  settings,
}: {
  environments: EnvironmentRow[];
  progress: BenchmarkRunProgress | null;
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  settings: EnvLabSettings;
}) {
  const cleanRl = Boolean(rlTest && rlTest.erroredEnvironments === 0 && rlTest.tasksScored > 0);
  const totals = environments.reduce(
    (sum, e) => ({
      train: sum.train + e.taskCounts.train,
      canary: sum.canary + e.taskCounts.canary,
      heldout: sum.heldout + e.taskCounts.heldout,
    }),
    { train: 0, canary: 0, heldout: 0 },
  );
  const thin = totals.train + totals.canary + totals.heldout < environments.length * 3;
  const defaultRollouts = 4;
  const estimatedExamples = environments.reduce((total, environment) => total + Math.max(1, environment.taskCounts.tasks), 0);
  const estimatedRollouts = estimatedExamples * defaultRollouts;

  return (
    <section class="m-panel m-env-prove">
      <div class="m-panel-head">
        <h3>Prove locally</h3>
        <span class="m-code">RUN SETTINGS · COVERAGE</span>
      </div>

      <div class="m-env-run-settings">
        <div><small>Rollouts per task</small><strong>RL smoke 2 · validation 4</strong></div>
        <label class="m-env-field">
          <span>Local concurrency</span>
          <input type="number" name="max_concurrent" min="1" max="8" value="1" />
        </label>
        <div class="m-env-cost"><small>Estimated validation cost</small><strong>{estimatedRollouts} rollouts · ~{estimatedRollouts * 2} model calls</strong><span>train + canary + heldout · each rollout calls policy + judge</span></div>
      </div>

      {!settings.policyConfigured || !settings.judgeConfigured ? (
        <div class="m-env-settings-note"><span class="m-field-note">Configure the policy key and judge key + model in Settings first.</span></div>
      ) : null}
      {environments.length && !cleanRl && !validation ? (
        <div class="m-env-settings-note"><span class="m-field-note">Validation stays locked until the RL smoke test records rewards for the environments without execution errors.</span></div>
      ) : null}

      <div class="m-env-readiness" data-thin={thin ? '1' : undefined}>
        <p class="m-env-readiness-headline">
          {environments.length
            ? `${totals.train + totals.canary + totals.heldout} approved documents across ${environments.length} topics${thin ? ' — thin. Local validation gates the cluster handoff on very few examples.' : '.'}`
            : 'No environments yet. Build packages from this run\'s approved documents.'}
        </p>
        <div class="m-env-readiness-detail">
          <div class="m-env-chain">
            <small>Coverage</small>
            <div class="m-env-chain-steps">
              <span><b>{environments.length || (progress?.topicCount ?? 0)}</b> topics</span>
              <i aria-hidden="true">→</i>
              <span><b>{environments.length}</b> verifiers</span>
              <i aria-hidden="true">→</i>
              <span><b>{environments.length}</b> packages</span>
            </div>
          </div>
          {environments.length ? (
            <div class="m-env-splits">
              <small>Taskset splits · taskset/*.jsonl</small>
              <table class="m-env-split-table">
                <thead><tr><th>Topic</th><th class="n">train.jsonl</th><th class="n">canary.jsonl</th><th class="n">heldout.jsonl</th><th class="n">Total</th></tr></thead>
                <tbody>
                  {environments.map((e) => (
                    <tr>
                      <th scope="row">{e.topicName}</th>
                      <td class="n">{e.taskCounts.train}</td>
                      <td class="n">{e.taskCounts.canary}</td>
                      <td class="n">{e.taskCounts.heldout}</td>
                      <td class="n">{e.taskCounts.tasks}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row">Total</th><td class="n">{totals.train}</td><td class="n">{totals.canary}</td><td class="n">{totals.heldout}</td><td class="n">{totals.train + totals.canary + totals.heldout}</td></tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function EnvLabStatus({
  runId,
  buildJob,
  evalJob,
  rlTest,
  validation,
  refreshWhenReady = false,
}: {
  runId: number | null;
  buildJob: JobRow | null;
  evalJob: JobRow | null;
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  /** Only the polling endpoint sets this — a cold page load must not re-trigger itself. */
  refreshWhenReady?: boolean;
}) {
  const job = isLive(evalJob) ? evalJob : isLive(buildJob) ? buildJob : evalJob ?? buildJob;
  const id = 'env-lab-status';
  if (runId && job && isLive(job)) {
    const percent = Math.max(0, Math.min(100, Math.round(job.progress * 100)));
    return (
      <div
        id={id}
        class="m-analysis-progress"
        data-progress={percent > 0 ? 'determinate' : 'indeterminate'}
        role="status"
        aria-live="polite"
        hx-get={`/ui/env-lab/status?run=${runId}`}
        hx-trigger="every 1s"
        hx-swap="outerHTML"
      >
        <div class="m-analysis-progress-label">
          <span class="m-analysis-progress-step">{job.step || 'Working'}</span>
          <span class="m-id">{percent}% · {job.jobCode}</span>
        </div>
        <div class="m-analysis-progress-track" role="progressbar" aria-label="Local proof in progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={String(percent)}>
          <span class="m-analysis-progress-fill" style={`width:${percent}%`} aria-hidden="true" />
        </div>
        <form class="m-env-cancel" hx-post="/ui/env-lab/cancel" hx-target="#env-lab-status" hx-swap="none" hx-disabled-elt="find button">
          <input type="hidden" name="benchmark_run_id" value={String(runId)} />
          <div class="m-env-cancel-copy">
            <strong>ACTIVE RUN</strong>
            <span>Stop this run; completed work is kept.</span>
          </div>
          <button class="danger" type="submit">{job.kind === 'env_eval' ? `Cancel ${job.params.kind === 'validation' ? 'validation' : 'RL test'}` : 'Cancel package build'}</button>
        </form>
      </div>
    );
  }
  if (runId && job?.status === 'failed') {
    return (
      <div id={id} class="m-analysis-status">
        <Badge state="failed">{job.kind === 'env_eval' ? 'local proof failed' : 'build failed'}</Badge>
        <span>{job.error || 'The environment job failed.'}</span>
      </div>
    );
  }
  if (runId && job?.status === 'cancelled') {
    return (
      <div id={id} class="m-analysis-status">
        <Badge state="pending">cancelled</Badge>
        <span>{job.error || 'The environment job was cancelled.'}</span>
      </div>
    );
  }
  if (runId && job?.status === 'succeeded' && refreshWhenReady) {
    return (
      <div id={id} class="m-analysis-status" hx-get={`/env-lab?run=${runId}`} hx-trigger="load" hx-target="#workspace" hx-swap="innerHTML">
        <Badge state="ready">{job.kind === 'env_eval' ? 'local proof complete' : 'packages built'}</Badge>
        <span>Refreshing the env lab…</span>
      </div>
    );
  }
  if (runId && job?.status === 'succeeded') {
    const evaluation = job.kind === 'env_eval'
      ? job.params.kind === 'validation' ? validation : rlTest
      : null;
    const errorCount = evaluation?.erroredEnvironments ?? 0;
    return (
      <div id={id} class="m-analysis-status">
        <Badge state={errorCount ? 'error' : 'ready'}>{job.kind === 'env_eval' ? errorCount ? 'local proof completed with errors' : 'local proof complete' : 'packages built'}</Badge>
        {errorCount ? <span>{errorCount} environment{errorCount === 1 ? '' : 's'} errored before scoring.</span> : null}
      </div>
    );
  }
  return <div id={id} class="m-analysis-status"><Badge state="pending">idle</Badge><span>Build packages, then run the RL test and validation.</span></div>;
}
