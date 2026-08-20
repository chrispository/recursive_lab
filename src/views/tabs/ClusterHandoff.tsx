import type { EnvironmentRow, EvaluationSummary } from '../../domain/environments/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Id } from '../ui/Id.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';

export function ClusterHandoffPage({
  benchmarkRun,
  progress,
  availableRuns,
  environments,
  validation,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  availableRuns: BenchmarkRunSummary[];
  environments: EnvironmentRow[];
  validation: EvaluationSummary | null;
}) {
  return (
    <>
      <div class="m-title">
        <h2>Cluster handoff</h2>
        <p>Review the local proof evidence, then write the immutable taskset and cluster training configuration for each ready environment.</p>
      </div>
      <RunContext
        benchmarkRun={benchmarkRun}
        availableRuns={availableRuns}
        failureTopics={progress?.topicCount}
      />
      <ClusterHandoffBody
        benchmarkRun={benchmarkRun}
        environments={environments}
        validation={validation}
      />
      <Handoff stage="cluster" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

export function ClusterHandoffBody({
  benchmarkRun,
  environments,
  validation,
  notice,
  oob = false,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  environments: EnvironmentRow[];
  validation: EvaluationSummary | null;
  notice?: string;
  oob?: boolean;
}) {
  const ready = environments.filter((environment) => environment.scaleReady);
  const gated = environments.filter((environment) => !environment.scaleReady);
  const prepared = ready.filter((environment) => environment.clusterPrepared);
  const runId = benchmarkRun?.benchmarkRunId ?? 0;
  const passed = ready.length > 0;
  const complete = ready.length > 0 && prepared.length === ready.length;

  return (
    <div id="cluster-handoff-body" hx-swap-oob={oob ? 'true' : undefined}>
      {notice ? (
        <div id="cluster-handoff-status" class="m-analysis-status">
          <Badge state="failed">unable to prepare handoff</Badge>
          <span>{notice}</span>
        </div>
      ) : null}
      <TableBox>
        <Cap title="Cluster release gate" code={complete ? 'HANDOFF PREPARED' : passed ? 'UNLOCKED BY LOCAL VALIDATION' : 'GATED BY LOCAL VALIDATION'}>
          <Tally items={[
            { value: ready.length, label: 'scale ready', hot: ready.length > 0 },
            { value: prepared.length, label: 'prepared' },
            { value: gated.length, label: 'gated' },
            { value: validation?.evaluationCode ?? '—', label: 'validation' },
          ]} />
        </Cap>
        <div class="m-env-cluster">
          <p class="m-env-cluster-note">
            {complete
              ? 'Every scale-ready environment has an immutable cluster.toml. The packages are ready for cluster training.'
              : passed
              ? 'Preparing an environment writes its cluster.toml next to the immutable package. Gated environments remain excluded until local validation passes.'
              : 'Local validation has not passed yet — the handoff stays gated until the learnability gate opens.'}
          </p>
          {environments.length ? (
            <div class="m-env-ledger">
              {environments.map((environment) => (
                <div class="m-env-ledger-row" data-ready={environment.scaleReady ? '1' : undefined} data-prepared={environment.clusterPrepared ? '1' : undefined}>
                  <div class="m-env-ledger-main">
                    <div class="m-env-ledger-title">{environment.topicName}</div>
                    <div class="m-env-ledger-meta">
                      {environment.validation?.error
                        ? 'validation errored — inspect the Env Lab job log'
                        : environment.validation?.meanReward === null
                        ? 'validation not scored'
                        : environment.validation
                        ? `validation ${environment.validation.meanReward.toFixed(3)} / threshold ${environment.passThreshold.toFixed(2)} · ${environment.taskCounts.tasks} ${environment.taskCounts.tasks === 1 ? 'task' : 'tasks'}`
                        : 'not validated'}
                      {environment.localPath ? <span class="m-env-ledger-path"><Id value={environment.environmentCode} /> · {environment.slug}</span> : null}
                    </div>
                  </div>
                  <form hx-post="/ui/env-lab/prepare" hx-target="#cluster-handoff-body" hx-swap="outerHTML" hx-disabled-elt="find button">
                    <input type="hidden" name="benchmark_run_id" value={String(runId)} />
                    <input type="hidden" name="environment_code" value={environment.environmentCode} />
                    <button class="ghost compact" type="submit" disabled={!environment.scaleReady || environment.clusterPrepared}>
                      {environment.clusterPrepared ? 'Prepared' : 'Prepare cluster'}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          ) : <div class="m-empty">No environments to hand off.</div>}
          <form class="m-env-cluster-actions" hx-post="/ui/env-lab/prepare" hx-target="#cluster-handoff-body" hx-swap="outerHTML" hx-disabled-elt="find button">
            <input type="hidden" name="benchmark_run_id" value={String(runId)} />
            <button type="submit" disabled={!ready.some((environment) => !environment.clusterPrepared)}>
              Prepare {ready.filter((environment) => !environment.clusterPrepared).length || ''} {ready.filter((environment) => !environment.clusterPrepared).length === 1 ? 'environment' : 'environments'} for cluster
            </button>
          </form>
        </div>
      </TableBox>
    </div>
  );
}
