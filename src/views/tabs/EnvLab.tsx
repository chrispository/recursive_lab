import type { EnvironmentRow, EvaluationSummary } from '../../domain/environments/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
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

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

export function EnvLab({
  benchmarkRun,
  progress,
  availableRuns,
  environments,
  evaluation,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  availableRuns: BenchmarkRunSummary[];
  environments: EnvironmentRow[];
  evaluation: EvaluationSummary | null;
}) {
  const built = environments.filter((environment) => environment.status === 'built' || environment.status === 'ready').length;
  const scaleReady = environments.filter((environment) => environment.scaleReady).length;
  const learnable = evaluation !== null && (evaluation.withinTaskStd ?? 0) >= 0.05 && (evaluation.saturatedFraction ?? 1) <= 0.8;

  return (
    <>
      <div class="m-title">
        <h2>Prove environments locally, then hand them to the cluster</h2>
        <p>Prime runs the local package and model evaluation here. A passing local validation unlocks the immutable training handoff; publishing to Prime is optional.</p>
      </div>
      <RunContext
        benchmarkRun={benchmarkRun}
        availableRuns={availableRuns}
        failureTopics={progress?.topicCount}
      />

      <TableBox>
        <Cap title="Environment readiness">
          <Tally items={[
            { value: environments.length, label: 'environments' },
            { value: built, label: 'built' },
            { value: scaleReady, label: 'scale ready', hot: scaleReady > 0 },
            { value: pct(evaluation?.meanReward ?? null), label: 'mean reward' },
          ]} />
        </Cap>
        {environments.length ? (
          <Table>
            <thead><tr><th>Environment</th><th>Topic</th><th>Verifier</th><th>Models</th><th class="n">Threshold</th><th>Status</th><th>Cluster</th></tr></thead>
            <tbody>{environments.map((environment) => (
              <tr data-state={environment.status}>
                <td><span class="nm">{environment.environmentCode}</span><span class="sub">{environment.localPath ?? 'no local path'}</span></td>
                <td>{environment.topicName}<span class="sub"><Id value={environment.topicCode} /></span></td>
                <td><span class="m-id">{environment.verifierName}</span></td>
                <td>{environment.baseModel}<span class="sub">inference: {environment.inferenceModel}</span></td>
                <td class="n">{environment.passThreshold.toFixed(2)}</td>
                <td><Badge state={environment.status}>{environment.status}</Badge></td>
                <td><Badge state={environment.scaleReady ? 'ready' : 'pending'}>{environment.scaleReady ? 'ready' : 'gated'}</Badge></td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div class="m-empty">No environments have been built.</div>}
      </TableBox>

      <div class="m-split">
        <Panel title="Local validation" code={evaluation?.evaluationCode ?? 'not run'}>
          <Field label="Model"><div class="m-input">{evaluation?.model ?? '—'}</div></Field>
          <Field label="Endpoint"><div class="m-input">{evaluation ? `${evaluation.endpointLabel} · ${evaluation.rolloutsPerExample} rollouts/example` : '—'}</div></Field>
          <Field label="Mean reward"><div class="m-input">{pct(evaluation?.meanReward ?? null)}</div></Field>
        </Panel>
        <Panel title="Learnability gate" code="not pass rate">
          <div class="m-status-list">
            <div><span>Within-task spread ≥ 0.05</span><Badge state={learnable ? 'ready' : 'pending'}>{evaluation?.withinTaskStd?.toFixed(3) ?? '—'}</Badge></div>
            <div><span>Saturated fraction ≤ 0.80</span><Badge state={learnable ? 'ready' : 'pending'}>{pct(evaluation?.saturatedFraction ?? null)}</Badge></div>
            <div><span>Cluster handoff</span><Badge state={learnable ? 'ready' : 'pending'}>{learnable ? 'unlocked' : 'gated'}</Badge></div>
          </div>
          <p class="m-note">A high reward with no spread teaches nothing. This seed deliberately remains gated because the validation signal is saturated.</p>
          {evaluation ? <Bar value={evaluation.meanReward} below={!learnable} /> : null}
        </Panel>
      </div>
      <Handoff stage="env-lab" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}
