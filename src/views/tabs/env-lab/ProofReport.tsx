import type { EnvironmentRow, EvaluationSummary } from '../../../domain/environments/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Meter } from '../../ui/Meter.tsx';

export function ProofReport({
  rlTest,
  validation,
  environments,
  evalJob,
}: {
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  environments: EnvironmentRow[];
  evalJob: JobRow | null;
}) {
  const evaluation = validation ?? rlTest;
  const liveEvalJob = isLive(evalJob) ? evalJob : null;
  const expectedTasks = environments.reduce((total, environment) => total + environment.taskCounts.tasks, 0);

  return (
    <section class="m-panel m-env-report">
      <div class="m-panel-head">
        <h3>Local proof report</h3>
        <span class="m-code">{evaluation ? `${evaluation.evaluationCode} · ${evaluation.kind === 'validation' ? 'VALIDATION' : 'RL TEST'}` : 'NO RUN YET'}</span>
      </div>
      {evaluation ? (
        <>
          <div class="m-env-report-status">
            {liveEvalJob ? <Badge state="pending">new {liveEvalJob.params.kind === 'validation' ? 'validation' : 'RL test'} running · {liveEvalJob.jobCode}</Badge> : null}
            <span>Showing the latest recorded result from {evaluation.createdAt.replace('T', ' ').replace('Z', ' UTC')}.</span>
            {evaluation.erroredEnvironments > 0 ? <strong>{evaluation.erroredEnvironments} environment{evaluation.erroredEnvironments === 1 ? '' : 's'} errored before producing rewards.</strong> : null}
          </div>
          <div class="m-env-tiles">
            <div><small>Mean reward</small><strong>{evaluation.meanReward?.toFixed(3) ?? '—'}</strong></div>
            <div><small>Above threshold</small><strong>{evaluation.aboveThreshold}/{environments.length}</strong></div>
            <div><small>Tasks scored</small><strong>{evaluation.tasksScored}/{expectedTasks}</strong></div>
            <div><small>Rollouts per task</small><strong>{evaluation.rolloutsPerExample}</strong></div>
            <div><small>Trainable signal</small><strong>{evaluation.trainableSignal ?? 0}/{environments.length}</strong></div>
            <div><small>Environment errors</small><strong>{evaluation.erroredEnvironments}</strong></div>
          </div>
          <div class="m-env-comparison">
            <div class="m-env-chart-head"><h4>Reward by environment</h4><span>RL test and validation stay paired; values are raw judge coverage fractions.</span></div>
            <table class="m-env-results-table">
              <thead><tr><th>Environment</th><th>RL test</th><th>Validation</th><th>Delta</th></tr></thead>
              <tbody>
                {environments.map((environment) => {
                  const rl = environment.rlTest;
                  const val = environment.validation;
                  const delta = rl && val && !rl.error && !val.error && rl.meanReward !== null && val.meanReward !== null ? val.meanReward - rl.meanReward : null;
                  return (
                    <tr>
                      <th scope="row">{environment.topicName}</th>
                      <td><MeasureCell measure={rl} threshold={environment.passThreshold} label="RL test" /></td>
                      <td><MeasureCell measure={val} threshold={environment.passThreshold} label="Validation" /></td>
                      <td class="m-env-delta">{delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="m-env-gate">
            <div class="m-env-chart-head"><h4>Learnability gate by environment</h4><span>Validation must pass all three gates independently. A run mean cannot hide a weak topic.</span></div>
            <table class="m-env-gate-table">
              <thead><tr><th>Environment</th><th>Mean ≥ 0.30</th><th>Spread ≥ 0.05</th><th>Saturation ≤ 0.80</th><th>Scale</th></tr></thead>
              <tbody>
                {environments.map((environment) => {
                  const measure = environment.validation;
                  const errored = Boolean(measure?.error);
                  const available = measure !== null && !errored;
                  return (
                    <tr>
                      <th scope="row">{environment.topicName}</th>
                      <td><GateCell available={available} errored={errored} passed={available && measure.meanReward !== null && measure.meanReward >= environment.passThreshold} value={measure?.meanReward?.toFixed(3) ?? '—'} /></td>
                      <td><GateCell available={available} errored={errored} passed={available && measure.withinTaskStd >= 0.05} value={measure?.withinTaskStd.toFixed(3) ?? '—'} /></td>
                      <td><GateCell available={available} errored={errored} passed={available && measure.saturatedFraction <= 0.8} value={measure?.saturatedFraction.toFixed(3) ?? '—'} /></td>
                      <td><Badge state={environment.scaleReady ? 'ready' : 'pending'}>{environment.scaleReady ? 'READY' : 'GATED'}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p class="m-note">Healthy signal is usually a 0.35–0.75 mean with spread ≥ 0.05 and saturation ≤ 0.80. Validation uses 4 rollouts to match the cluster; a high reward with no spread teaches nothing.</p>
          </div>
        </>
      ) : (
        <div class="m-empty">No local proof yet — run the RL test after building packages.</div>
      )}
    </section>
  );
}

function MeasureCell({ measure, threshold, label }: { measure: EnvironmentRow['rlTest']; threshold: number; label: string }) {
  const passed = measure !== null && !measure.error && measure.meanReward !== null && measure.meanReward >= threshold;
  return (
    <div class="m-env-result-cell">
      <Meter
        value={measure?.error ? null : measure?.meanReward ?? null}
        threshold={threshold}
        state={measure?.error ? 'error' : measure === null ? 'none' : passed ? 'pass' : 'fail'}
        label={label}
      />
      {measure?.error ? <Badge state="error">ERROR</Badge> : <span>{measure?.meanReward === null ? '—' : measure ? measure.meanReward.toFixed(3) : '—'}</span>}
    </div>
  );
}

function GateCell({ available, errored, passed, value }: { available: boolean; errored: boolean; passed: boolean; value: string }) {
  return (
    <div class="m-env-gate-cell">
      <span>{errored ? '—' : value}</span>
      <Badge state={errored ? 'error' : !available ? 'pending' : passed ? 'ready' : 'failed'}>{errored ? 'ERROR' : !available ? '—' : passed ? 'PASS' : 'FAIL'}</Badge>
    </div>
  );
}
