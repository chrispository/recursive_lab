import type { EnvironmentMeasure, EnvironmentRow, EvaluationMetrics } from '../../../domain/environments/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Id } from '../../ui/Id.tsx';
import { Meter } from '../../ui/Meter.tsx';

type QueueBucket = 'pending' | 'ready' | 'error' | 'active';
type StageState = 'done' | 'todo' | 'error' | 'active';
type ActiveStage = 'package' | 'rl_test' | 'validation' | null;
type EvaluationEntry = NonNullable<EvaluationMetrics['environments']>[number];
type LiveEvaluation = { kind: 'rl_test' | 'validation'; environments: EvaluationEntry[]; rolloutsPerExample: number };

function packageReady(environment: EnvironmentRow) {
  return environment.status === 'built' || environment.status === 'ready';
}

function measurePassed(measure: EnvironmentMeasure | null, threshold: number) {
  return Boolean(measure && !measure.error && measure.meanReward !== null && measure.meanReward >= threshold);
}

function liveEvaluationOf(job: JobRow | null): LiveEvaluation | null {
  if (!job || !isLive(job) || job.kind !== 'env_eval') return null;
  const kind = job.params.kind === 'validation' ? 'validation' : 'rl_test';
  const rawEntries = job.result.environments;
  const environments = Array.isArray(rawEntries)
    ? rawEntries.filter((entry): entry is EvaluationEntry => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Record<string, unknown>;
        return Number.isInteger(candidate.environment_id)
          && typeof candidate.mean_reward === 'number'
          && typeof candidate.pass_rate === 'number'
          && typeof candidate.within_task_std === 'number'
          && typeof candidate.saturated_fraction === 'number'
          && typeof candidate.tasks_scored === 'number';
      })
    : [];
  const requestedRollouts = Number(job.params.rollouts);
  return {
    kind,
    environments,
    rolloutsPerExample: Number.isInteger(requestedRollouts) && requestedRollouts > 0 ? requestedRollouts : kind === 'validation' ? 4 : 2,
  };
}

function liveEntryOf(liveEvaluation: LiveEvaluation | null, kind: ActiveStage, environmentId: number) {
  if (!liveEvaluation || !kind || liveEvaluation.kind !== kind) return null;
  return liveEvaluation.environments.find((entry) => entry.environment_id === environmentId) ?? null;
}

function measureOfEntry(entry: EvaluationEntry, rolloutsPerExample: number): EnvironmentMeasure {
  return {
    meanReward: entry.error ? null : entry.mean_reward,
    passRate: entry.pass_rate,
    withinTaskStd: entry.within_task_std,
    saturatedFraction: entry.saturated_fraction,
    tasksScored: entry.tasks_scored,
    rolloutsPerExample,
    error: entry.error ?? null,
  };
}

function bucketOf(environment: EnvironmentRow, activeStage: ActiveStage, liveEvaluation: LiveEvaluation | null): QueueBucket {
  if (activeStage === 'package') return 'active';
  const liveEntry = liveEntryOf(liveEvaluation, activeStage, environment.environmentId);
  if (activeStage && liveEvaluation?.kind === activeStage) {
    if (liveEntry) return liveEntry.error ? 'error' : 'ready';
    return 'active';
  }
  if (activeStage) return 'active';
  if (environment.status === 'failed' || environment.rlTest?.error || environment.validation?.error) return 'error';
  if (packageReady(environment) && environment.rlTest && environment.validation) return 'ready';
  return 'pending';
}

function bucketLabel(bucket: QueueBucket) {
  return bucket === 'active' ? 'running' : bucket === 'pending' ? 'next action' : bucket === 'ready' ? 'proof recorded' : 'needs attention';
}

function nextAction(environment: EnvironmentRow, activeStage: ActiveStage = null, liveEvaluation: LiveEvaluation | null = null) {
  if (activeStage === 'package') return 'Building package';
  if (activeStage === 'rl_test') return liveEntryOf(liveEvaluation, activeStage, environment.environmentId)?.error ? 'Rerun RL test' : liveEntryOf(liveEvaluation, activeStage, environment.environmentId) ? 'RL test complete' : 'RL test running';
  if (activeStage === 'validation') return liveEntryOf(liveEvaluation, activeStage, environment.environmentId)?.error ? 'Rerun validation' : liveEntryOf(liveEvaluation, activeStage, environment.environmentId) ? 'Validation complete' : 'Validation running';
  if (!packageReady(environment)) return 'Build package';
  if (!environment.rlTest) return 'Run RL test';
  if (environment.rlTest.error) return 'Rerun RL test';
  if (!environment.validation) return 'Run validation';
  if (environment.validation.error) return 'Rerun validation';
  if (!environment.scaleReady) return 'Review scale gate';
  return 'Ready for scale';
}

function stageState(done: boolean, error = false): StageState {
  return error ? 'error' : done ? 'done' : 'todo';
}

function stageCopy(state: StageState, done: string, todo: string, error: string) {
  return state === 'error' ? error : state === 'done' ? done : state === 'active' ? 'in progress' : todo;
}

function statusBadge(bucket: QueueBucket) {
  return <Badge state={bucket === 'ready' ? 'ready' : bucket === 'error' ? 'error' : bucket === 'active' ? 'running' : 'pending'}>{bucketLabel(bucket)}</Badge>;
}

function EnvStage({ number, label, state, copy }: { number: string; label: string; state: StageState; copy: string }) {
  return (
    <div class="m-env-inbox-stage" data-state={state}>
      <span class="m-env-inbox-stage-number">{number}</span>
      <strong>{label}</strong>
      <span>{copy}</span>
    </div>
  );
}

function MeasureSummary({ label, measure, threshold, running = false }: { label: string; measure: EnvironmentMeasure | null; threshold: number; running?: boolean }) {
  const passed = measurePassed(measure, threshold);
  const state = running ? 'active' : measure?.error ? 'error' : measure === null ? 'pending' : passed ? 'ready' : 'failed';
  const meterState = running ? 'none' : measure?.error ? 'error' : measure === null ? 'none' : passed ? 'pass' : 'fail';
  const reward = running ? '…' : measure?.meanReward === null || measure?.meanReward === undefined ? '—' : measure.meanReward.toFixed(3);

  return (
    <div class="m-env-inbox-measure" data-state={state}>
      <div class="m-env-inbox-measure-head"><strong>{label}</strong><Badge state={running ? 'running' : state}>{running ? 'running' : measure === null ? 'not run' : measure?.error ? 'error' : passed ? 'pass' : 'below floor'}</Badge></div>
      <div class="m-env-inbox-measure-meter"><Meter value={running || measure?.error ? null : measure?.meanReward ?? null} threshold={threshold} state={meterState} label={label} /><b>{reward}</b></div>
      <small>{running ? `Current run in progress${measure ? ` · previous result ${measure.meanReward === null ? 'unscored' : measure.meanReward.toFixed(3)}` : ''}` : measure ? `${measure.tasksScored} task${measure.tasksScored === 1 ? '' : 's'} scored · ${measure.rolloutsPerExample} rollout${measure.rolloutsPerExample === 1 ? '' : 's'} · spread ±${measure.withinTaskStd.toFixed(3)}` : 'No reward has been recorded yet.'}</small>
      {!running && measure?.error ? <p class="m-env-inbox-error">{measure.error}</p> : null}
    </div>
  );
}

function EnvironmentDetail({ environment, selected, activeStage, liveEvaluation }: { environment: EnvironmentRow; selected: boolean; activeStage: ActiveStage; liveEvaluation: LiveEvaluation | null }) {
  const bucket = bucketOf(environment, activeStage, liveEvaluation);
  const packageState = stageState(packageReady(environment), environment.status === 'failed');
  const rlEntry = liveEntryOf(liveEvaluation, 'rl_test', environment.environmentId);
  const validationEntry = liveEntryOf(liveEvaluation, 'validation', environment.environmentId);
  const rlState: StageState = activeStage === 'rl_test' ? rlEntry ? rlEntry.error ? 'error' : 'done' : 'active' : stageState(Boolean(environment.rlTest && !environment.rlTest.error), Boolean(environment.rlTest?.error));
  const validationState: StageState = activeStage === 'validation' ? validationEntry ? validationEntry.error ? 'error' : 'done' : 'active' : stageState(Boolean(environment.validation && !environment.validation.error), Boolean(environment.validation?.error));
  const currentPackage = activeStage === 'package';
  const scaleState = stageState(environment.scaleReady);
  const rlMeasure = rlEntry ? measureOfEntry(rlEntry, liveEvaluation?.rolloutsPerExample ?? 2) : environment.rlTest;
  const validationMeasure = validationEntry ? measureOfEntry(validationEntry, liveEvaluation?.rolloutsPerExample ?? 4) : environment.validation;
  const rlRunning = activeStage === 'rl_test' && !rlEntry;
  const validationRunning = activeStage === 'validation' && !validationEntry;

  return (
    <article id={`environment-review-detail-${environment.environmentCode}`} class="m-review-detail" data-review-detail={environment.environmentCode} hidden={!selected}>
      <div class="m-review-detail-head">
        <div>
          <div class="m-review-eyebrow">{environment.topicName} / environment</div>
          <h4>{environment.topicName}</h4>
          <div class="m-review-meta">
            <span><Id value={environment.environmentCode} /></span>
            <span>{environment.slug}</span>
            <span>pass floor {environment.passThreshold.toFixed(2)}</span>
            <span>{environment.inferenceModel}</span>
          </div>
        </div>
        {statusBadge(bucket)}
      </div>

      <div class="m-env-inbox-stage-strip" aria-label="Environment readiness stages">
        <EnvStage number="01" label="Package" state={currentPackage ? 'active' : packageState} copy={currentPackage ? 'building' : stageCopy(packageState, 'ready', 'not built', 'failed')} />
        <EnvStage number="02" label="RL test" state={rlState} copy={stageCopy(rlState, 'reward recorded', 'not run', 'errored')} />
        <EnvStage number="03" label="Validation" state={validationState} copy={stageCopy(validationState, 'reward recorded', 'not run', 'errored')} />
        <EnvStage number="04" label="Scale" state={scaleState} copy={scaleState === 'done' ? 'ready' : 'gated'} />
      </div>

      <div class="m-review-tabs" role="tablist" aria-label={`Environment ${environment.environmentCode}`}>
        <button type="button" class="is-active" data-review-tab="proof" aria-selected="true">Proof signal</button>
        <button type="button" data-review-tab="verifier" aria-selected="false">Verifier</button>
        <button type="button" data-review-tab="taskset" aria-selected="false">Taskset</button>
      </div>

      <div class="m-review-reading" data-review-tab-panel="proof">
        <h5>Latest local proof</h5>
        <p class="m-env-inbox-explainer">The RL test is a small smoke test. Validation repeats the same environment with broader coverage. The meter fill is mean reward; the notch is this environment’s pass floor.</p>
        <div class="m-env-inbox-measures">
          <MeasureSummary label={activeStage === 'rl_test' ? 'RL test · current run' : 'RL test · 2 rollouts'} measure={rlMeasure} threshold={environment.passThreshold} running={rlRunning} />
          <MeasureSummary label={activeStage === 'validation' ? 'Validation · current run' : 'Validation · 4 rollouts'} measure={validationMeasure} threshold={environment.passThreshold} running={validationRunning} />
        </div>
        <div class="m-env-inbox-next"><span>Next action</span><strong>{nextAction(environment, activeStage, liveEvaluation)}</strong></div>
      </div>

      <div class="m-review-reading" data-review-tab-panel="verifier" hidden>
        <h5>Judge coverage</h5>
        <p class="m-env-inbox-explainer">A judge model reads each policy answer against the verifier targets. The reward is the fraction of the target behavior it finds, not a human approval score.</p>
        <div class="m-env-inbox-verifier-fact"><span>Pass floor</span><strong>{environment.passThreshold.toFixed(2)}</strong></div>
        <p class="m-env-inbox-verifier-strategy">{environment.verifierStrategy}</p>
      </div>

      <div class="m-review-reading" data-review-tab-panel="taskset" hidden>
        <h5>Packaged taskset</h5>
        <p class="m-env-inbox-explainer">Approved documents become tasks in the local Prime package. The split counts show what is used for training, the small canary check, and held-out validation.</p>
        <div class="m-env-inbox-counts">
          <div><small>Total tasks</small><strong>{environment.taskCounts.tasks}</strong></div>
          <div><small>Train</small><strong>{environment.taskCounts.train}</strong></div>
          <div><small>Canary</small><strong>{environment.taskCounts.canary}</strong></div>
          <div><small>Heldout</small><strong>{environment.taskCounts.heldout}</strong></div>
        </div>
        <div class="m-env-inbox-verifier-fact"><span>Package model</span><strong>{environment.baseModel}</strong></div>
        {environment.localPath ? <p class="m-env-inbox-path"><Id value={environment.environmentCode} /> · {environment.localPath}</p> : <p class="m-env-inbox-path">Package path will appear after the build completes.</p>}
      </div>

      <div class="m-review-actions">
        <span><Id value={environment.environmentCode} /> · local environment</span>
        <span class="m-env-inbox-action">{nextAction(environment, activeStage, liveEvaluation)}</span>
      </div>
    </article>
  );
}

export function EnvironmentInbox({ environments, buildJob, evalJob, oob = false }: { environments: EnvironmentRow[]; buildJob: JobRow | null; evalJob: JobRow | null; oob?: boolean }) {
  const activeJob = isLive(evalJob) ? evalJob : isLive(buildJob) ? buildJob : null;
  const activeStage: ActiveStage = activeJob?.kind === 'env_build' ? 'package' : activeJob?.params.kind === 'validation' ? 'validation' : activeJob ? 'rl_test' : null;
  const liveEvaluation = liveEvaluationOf(evalJob);
  const pending = environments.filter((environment) => bucketOf(environment, activeStage, liveEvaluation) === 'pending');
  const ready = environments.filter((environment) => bucketOf(environment, activeStage, liveEvaluation) === 'ready');
  const errors = environments.filter((environment) => bucketOf(environment, activeStage, liveEvaluation) === 'error');
  const active = environments.filter((environment) => bucketOf(environment, activeStage, liveEvaluation) === 'active');
  const initialBucket: QueueBucket = activeStage && active.length ? 'active' : pending.length ? 'pending' : errors.length ? 'error' : 'ready';
  const initialEnvironments = initialBucket === 'active' ? active : initialBucket === 'pending' ? pending : initialBucket === 'error' ? errors : ready;
  const selected = initialEnvironments[0] ?? environments[0] ?? null;
  const liveCompleted = liveEvaluation?.environments.length ?? 0;
  const liveErrors = liveEvaluation?.environments.filter((entry) => Boolean(entry.error)).length ?? 0;
  const liveStageName = activeStage === 'validation' ? 'Validation' : 'RL test';

  return (
    <details
      id="environment-review-inbox"
      class="m-review-inbox m-env-inbox"
      data-review-inbox
      data-review-status-filter={initialBucket}
      data-review-selected={selected?.environmentCode ?? ''}
      hx-swap-oob={oob ? 'true' : undefined}
      open
    >
      <summary class="m-review-inbox-head">
        <div>
          <h3>Environment review queue</h3>
          <p>{environments.length} package{environments.length === 1 ? '' : 's'}, one environment open, one next action at a time.</p>
        </div>
        <span class="m-review-head-tools"><span class="m-review-recommended">recommended path</span><span class="m-review-collapse"><span class="m-review-collapse-open">collapse</span><span class="m-review-collapse-closed">open</span></span></span>
      </summary>

      <div class="m-review-decision-bar m-env-inbox-decision">
        <div class="m-review-decision-copy">
          <strong>{activeStage && activeStage !== 'package' && liveEvaluation?.kind === activeStage ? `${active.length} environment${active.length === 1 ? '' : 's'} in progress${liveCompleted ? ` · ${liveCompleted} complete` : ''}` : activeStage ? `${active.length} environment${active.length === 1 ? '' : 's'} in progress` : pending.length ? `${pending.length} environment${pending.length === 1 ? '' : 's'} need the next step` : errors.length ? `${errors.length} environment${errors.length === 1 ? '' : 's'} need attention` : 'All local proof stages have recorded results'}</strong>
          <p>{activeStage && activeStage !== 'package' && liveEvaluation?.kind === activeStage ? `${liveStageName} is running; ${liveCompleted} of ${environments.length} environments have finished${liveErrors ? `, including ${liveErrors} error${liveErrors === 1 ? '' : 's'}` : ''}.` : activeStage ? `${activeStage === 'package' ? 'Packages are building' : activeStage === 'rl_test' ? 'The RL smoke test is running' : 'Validation is running'}; displayed rewards are from the last completed run until this job finishes.` : 'Select an environment to inspect its verifier, taskset split, and latest reward signal. Run controls stay in the Prove locally panel below.'}</p>
        </div>
        <div class="m-env-inbox-flow" aria-label="Recommended environment workflow"><span><b>01</b> package</span><i>→</i><span><b>02</b> RL smoke</span><i>→</i><span><b>03</b> validation</span></div>
      </div>

      <div class="m-review-split">
        <div class="m-review-queue">
          <div class="m-review-queue-tools" role="tablist" aria-label="Environment readiness filter">
            <button type="button" class={initialBucket === 'pending' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="pending" aria-pressed={initialBucket === 'pending' ? 'true' : 'false'}>Next action {pending.length}</button>
            <button type="button" class={initialBucket === 'active' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="active" aria-pressed={initialBucket === 'active' ? 'true' : 'false'}>Running {active.length}</button>
            <button type="button" class={initialBucket === 'ready' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="ready" aria-pressed={initialBucket === 'ready' ? 'true' : 'false'}>Proof recorded {ready.length}</button>
            <button type="button" class={initialBucket === 'error' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="error" aria-pressed={initialBucket === 'error' ? 'true' : 'false'}>Errors {errors.length}</button>
            <button type="button" class="m-review-filter" data-review-filter="all" aria-pressed="false">All {environments.length}</button>
          </div>
          <div class="m-review-queue-list">
            {environments.map((environment) => {
              const bucket = bucketOf(environment, activeStage, liveEvaluation);
              return (
                <button type="button" class={`m-review-queue-row m-env-inbox-row ${environment.environmentCode === selected?.environmentCode ? 'is-selected' : ''}`} data-review-queue-row data-review-select={environment.environmentCode} data-review-status={bucket} data-review-topic={environment.topicCode} aria-controls={`environment-review-detail-${environment.environmentCode}`} hidden={bucket !== initialBucket}>
                  <i class={`m-review-dot ${bucket === 'ready' ? 'approved' : bucket === 'error' ? 'blocked' : bucket === 'active' ? 'running' : ''}`} aria-hidden="true" />
                  <span><strong>{environment.topicName}</strong><small><Id value={environment.environmentCode} /> · {environment.taskCounts.tasks} task{environment.taskCounts.tasks === 1 ? '' : 's'} · {nextAction(environment, activeStage, liveEvaluation)}</small></span>
                  {statusBadge(bucket)}
                </button>
              );
            })}
            {environments.length ? <div class="m-review-empty m-review-filter-empty" data-review-filter-empty hidden>No environments match this filter.</div> : <div class="m-review-empty">No environment packages yet. Build packages from this run to open the queue.</div>}
          </div>
        </div>

        <div class="m-review-details" aria-live="polite">
          {environments.map((environment) => <EnvironmentDetail environment={environment} activeStage={activeStage} liveEvaluation={liveEvaluation} selected={environment.environmentCode === selected?.environmentCode} />)}
          {!environments.length ? <div class="m-review-empty m-review-empty-detail">Build the approved documents to create the first environment package.</div> : null}
        </div>
      </div>
    </details>
  );
}
