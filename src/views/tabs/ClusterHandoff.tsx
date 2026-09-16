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

type Props = {
  benchmarkRun: BenchmarkRunSummary | null;
  environments: EnvironmentRow[];
  validation: EvaluationSummary | null;
};

export function ClusterHandoffPage({ benchmarkRun, progress, availableRuns, environments, validation }: Props & {
  progress: BenchmarkRunProgress | null;
  availableRuns: BenchmarkRunSummary[];
}) {
  return (
    <>
      <div class="m-title">
        <h2>Prepare training package</h2>
        <p>Download the validated tasks, grader, training configuration and launch instructions.
          Preparing a package does not upload data or start a cluster job.</p>
      </div>
      <RunContext benchmarkRun={benchmarkRun} availableRuns={availableRuns} failureTopics={progress?.topicCount} />
      <ClusterHandoffBody benchmarkRun={benchmarkRun} environments={environments} validation={validation} />
      <Handoff stage="cluster" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

export function ClusterHandoffBody({ benchmarkRun, environments, validation, notice, oob = false }: Props & {
  notice?: string;
  oob?: boolean;
}) {
  const ready = environments.filter((env) => env.scaleReady);
  const prepared = ready.filter((env) => env.clusterPrepared);
  const runId = benchmarkRun?.benchmarkRunId ?? 0;
  const remaining = ready.filter((env) => !env.clusterPrepared);

  return (
    <div id="cluster-handoff-body" hx-swap-oob={oob ? 'true' : undefined}>
      {notice ? <div id="cluster-handoff-status" class="m-analysis-status" role="alert">
        <Badge state="failed">Unable to prepare package</Badge><span>{notice}</span>
      </div> : null}
      <TableBox>
        <Cap title="Training export" code="LOCAL DOWNLOAD">
          <Tally items={[
            { value: ready.length, label: 'ready to export', hot: ready.length > 0 },
            { value: prepared.length, label: 'prepared' },
            { value: environments.length - ready.length, label: 'need validation' },
            { value: validation?.evaluationCode ?? '—', label: 'validation' },
          ]} />
        </Cap>
        <div class="m-env-cluster">
          <p class="m-env-cluster-note">
            {remaining.length ? 'Choose the trainable checkpoint that corresponds to your validated policy.'
              : prepared.length ? 'Your packages are ready to download. Follow TRAINING.md on your GPU host and run the included preflight before launching training.'
              : 'Run a complete training-signal check in Env Lab to unlock an export.'}
          </p>
          <form hx-post="/ui/env-lab/prepare" hx-target="#cluster-handoff-body" hx-swap="outerHTML" hx-disabled-elt="find button">
            <input type="hidden" name="benchmark_run_id" value={String(runId)} />
            {remaining.length ? (
              <div class="m-env-run-settings">
                <label class="m-env-field">
                  <span>Trainable checkpoint</span>
                  <input name="training_model" type="text" required placeholder="organization/model or cluster path" />
                  <small>Validated policy: {validation?.model ?? '—'}. Use its actual model weights, not an API alias.</small>
                </label>
                <label class="m-env-field">
                  <span><input name="checkpoint_confirmed" type="checkbox" required /> This checkpoint is the policy I validated.</span>
                  <small>A different model needs its own local checks.</small>
                </label>
              </div>
            ) : null}
            <div class="m-env-ledger">
              {environments.map((env) => (
                <div class="m-env-ledger-row" data-ready={env.scaleReady ? '1' : undefined} data-prepared={env.clusterPrepared ? '1' : undefined}>
                  <div class="m-env-ledger-main">
                    <div class="m-env-ledger-title">{env.topicName}</div>
                    <div class="m-env-ledger-meta">
                      <Id value={env.environmentCode} /> · {env.taskCounts.train} training tasks ·{' '}
                      {env.scaleReady ? 'current validation passed' : 'fresh passing validation required'}
                    </div>
                    {env.validation?.evidence && env.scaleReady ? <div class="m-env-ledger-meta">
                      Policy {env.validation.evidence.model} · judge {env.validation.evidence.judgeModel}
                    </div> : null}
                  </div>
                  {env.clusterPrepared
                    ? <a class="ghost compact" href={`/api/v1/environments/${env.environmentCode}/training-package`} download="training-package.tar.gz">Download package</a>
                    : <button class="ghost compact" name="environment_code" value={env.environmentCode} type="submit" disabled={!env.scaleReady}>Prepare package</button>}
                </div>
              ))}
              {!environments.length ? <div class="m-empty">No environment packages yet.</div> : null}
            </div>
            {remaining.length > 1 ? <div class="m-env-cluster-actions">
              <button type="submit">Prepare all {remaining.length} packages</button>
            </div> : null}
          </form>
          <details class="m-evidence">
            <summary>What happens on the cluster?</summary>
            <div class="m-evidence-body">
              <p>Install the package in the pinned Prime RL environment and configure the judge credentials on the workers.
                The preflight checks the package and config without calling a model.</p>
              <p>The starter recipe uses four attempts per task, 20 training steps, one trainer GPU and one inference GPU.
                Check checkpoint memory requirements before launching. Only training tasks feed weight updates;
                canary and heldout files are included for separate evaluation.</p>
            </div>
          </details>
        </div>
      </TableBox>
    </div>
  );
}
