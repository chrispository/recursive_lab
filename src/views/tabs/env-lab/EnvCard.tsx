/**
 * One topic-verifier environment card: what it grades, how it's split, what
 * the local proofs measured, and what the next scale step is.
 */
import type { EnvironmentRow } from '../../../domain/environments/model.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Id } from '../../ui/Id.tsx';
import { Meter } from '../../ui/Meter.tsx';

type MeasureLine = {
  label: string;
  measure: EnvironmentRow['rlTest'];
};

export function EnvCard({ environment }: { environment: EnvironmentRow }) {
  const rlPassed = environment.rlTest !== null && !environment.rlTest.error && environment.rlTest.meanReward !== null && environment.rlTest.meanReward >= environment.passThreshold;
  const valPassed = environment.validation !== null && !environment.validation.error && environment.validation.meanReward !== null && environment.validation.meanReward >= environment.passThreshold;
  const spread = environment.validation && !environment.validation.error ? environment.validation.withinTaskStd : null;
  const trainable = spread !== null && spread >= 0.05;
  const hasError = Boolean(environment.rlTest?.error || environment.validation?.error);
  const ticks = [
    { key: 'package', done: environment.status === 'built' || environment.status === 'ready', title: 'Package' },
    { key: 'rl', done: rlPassed, title: 'RL test' },
    { key: 'validation', done: valPassed, title: 'Validation' },
    { key: 'scale', done: environment.scaleReady, now: valPassed && !environment.scaleReady, title: 'Scale' },
    { key: 'cluster', done: false, title: 'Cluster' },
  ];
  const next = ticks.find((tick) => !tick.done);

  return (
    <article class="m-env-card" data-state={hasError ? 'error' : environment.status}>
      <div class="m-env-card-head">
        <div>
          <h4>{environment.topicName}</h4>
          <div class="m-env-card-sub"><Id value={environment.topicCode} /> · {environment.taskCounts.tasks} {environment.taskCounts.tasks === 1 ? 'doc' : 'docs'} packaged</div>
        </div>
        <Badge state={environment.status === 'failed' ? 'failed' : environment.status === 'draft' ? 'pending' : 'built'}>
          {environment.status}
        </Badge>
      </div>

      <div class="m-env-verifier">
        <div class="m-env-verifier-line">
          <span class="m-env-verifier-mode" title="A judge model reads the answer against each verifier target. Reward is the fraction satisfied.">Judge coverage</span>
          <span>pass ≥ <b>{environment.passThreshold.toFixed(2)}</b></span>
          <span>verifier v1</span>
        </div>
        <p class="m-env-verifier-strategy">{environment.verifierStrategy}</p>
      </div>

      <div class="m-env-spec">
        <div><small>Tasks</small><strong>{environment.taskCounts.tasks}</strong></div>
        <div><small>Train</small><strong>{environment.taskCounts.train}</strong></div>
        <div><small>Canary</small><strong>{environment.taskCounts.canary}</strong></div>
        <div><small>Heldout</small><strong>{environment.taskCounts.heldout}</strong></div>
      </div>

      <div class="m-env-measures">
        <MeasureLine label="RL test" measure={environment.rlTest} threshold={environment.passThreshold} />
        <MeasureLine label="Validation" measure={environment.validation} threshold={environment.passThreshold} />
        {environment.validation || environment.rlTest ? (
          <div class="m-env-measure-note">
            {environment.rlTest?.tasksScored ?? environment.validation?.tasksScored ?? 0} of {environment.taskCounts.tasks} {environment.taskCounts.tasks === 1 ? 'task' : 'tasks'} scored
            {spread !== null ? ` · ±${spread.toFixed(3)}` : ''}
          </div>
        ) : null}
        {environment.validation !== null ? (
          <div class={`m-env-signal${trainable ? ' is-strong' : ' is-weak'}`}>
            <span>{trainable ? 'Trainable signal' : 'No trainable signal'}</span>
            <em>within-task spread {spread?.toFixed(3) ?? '—'}</em>
          </div>
        ) : null}
      </div>

      <div class="m-env-proof">
        <span class="m-ticks" aria-label="Proof stages">
          {ticks.map((tick) => (
            <i class={tick.done ? 'done' : tick.now ? 'now' : ''} title={tick.title} />
          ))}
        </span>
        <span class="m-env-proof-copy">{next ? `Next: ${next.title.toLowerCase()}` : 'Ready for the cluster'}</span>
      </div>
    </article>
  );
}

function MeasureLine({ label, measure, threshold }: MeasureLine & { threshold: number }) {
  const passed = measure !== null && !measure.error && measure.meanReward !== null && measure.meanReward >= threshold;
  return (
    <div class="m-env-measure-row">
      <span class="m-env-measure-label">{label}</span>
      <Meter
        value={measure?.error ? null : measure?.meanReward ?? null}
        threshold={threshold}
        state={measure?.error ? 'error' : measure === null ? 'none' : passed ? 'pass' : 'fail'}
        label={label}
      />
      <span class="m-env-measure-value">{measure?.error || measure?.meanReward === null ? '—' : measure ? measure.meanReward.toFixed(3) : '—'}</span>
      <span class="m-env-measure-verdict">
        {measure === null ? <Badge state="pending">not run</Badge> : measure.error ? <Badge state="error">ERROR</Badge> : <Badge state={passed ? 'ready' : 'failed'}>{passed ? 'PASS' : 'FAIL'}</Badge>}
      </span>
    </div>
  );
}
