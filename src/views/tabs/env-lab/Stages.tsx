import type { EnvironmentRow, EvaluationSummary } from '../../../domain/environments/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';

export function EnvLabStages({
  environments,
  rlTest,
  validation,
  buildJob,
  evalJob,
  canBuild,
  canRunRl,
  canRunValidation,
  policyModel,
}: {
  environments: EnvironmentRow[];
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  buildJob: JobRow | null;
  evalJob: JobRow | null;
  canBuild: boolean;
  canRunRl: boolean;
  canRunValidation: boolean;
  policyModel: string;
}) {
  const total = environments.length;
  const built = environments.filter((environment) => environment.status === 'built' || environment.status === 'ready').length;
  const failedPackages = environments.filter((environment) => environment.status === 'failed').length;
  const packageLive = isLive(buildJob);
  const evalLive = isLive(evalJob);
  const evalKind = evalJob?.params.kind;
  const rlLive = evalLive && evalKind === 'rl_test';
  const validationLive = evalLive && evalKind === 'validation';
  const packageComplete = total > 0 && built === total && failedPackages === 0;

  const rlScored = environments.filter((environment) => environment.rlTest !== null && !environment.rlTest.error).length;
  const rlErrors = environments.filter((environment) => environment.rlTest?.error).length;
  const validationScored = environments.filter((environment) => environment.validation !== null && !environment.validation.error).length;
  const validationErrors = environments.filter((environment) => environment.validation?.error).length;
  const cleanRl = Boolean(rlTest && rlTest.erroredEnvironments === 0 && rlTest.tasksScored > 0);
  const currentEvalDone = evalLive && total > 0 ? Math.min(total, Math.round((evalJob?.progress ?? 0) * total)) : 0;
  const packageState = packageLive ? 'active' : packageComplete ? 'done' : failedPackages ? 'error' : 'todo';
  const rlState = rlLive ? 'active' : rlTest?.erroredEnvironments ? 'error' : rlTest ? 'done' : 'todo';
  const validationState = validationLive ? 'active' : validation?.erroredEnvironments ? 'error' : validation ? 'done' : 'todo';

  return (
    <div class="m-env-command-bar m-env-stages" role="list">
      <div
        class="m-env-command-step"
        data-state={packageState}
        role="listitem"
      >
        <span class="m-env-command-tick" aria-hidden="true">{packageState === 'done' ? '✓' : '1'}</span>
        <span class="m-env-command-copy"><strong>Package</strong><small>{packageLive ? buildJob?.step || 'building packages' : packageComplete ? `${built} built` : failedPackages ? `${failedPackages} failed` : 'not built'}</small></span>
      </div>

      <div
        class="m-env-command-step"
        data-state={rlState}
        role="listitem"
      >
        <span class="m-env-command-tick" aria-hidden="true">{rlState === 'done' ? '✓' : '2'}</span>
        <span class="m-env-command-copy"><strong>RL smoke</strong><small>{rlLive ? `${currentEvalDone} / ${total} current` : rlTest ? `${rlScored} scored${rlErrors ? ` · ${rlErrors} error${rlErrors === 1 ? '' : 's'}` : ''} · ${rlTest.rolloutsPerExample} rollouts` : 'not run'}</small></span>
      </div>

      <div
        class="m-env-command-step"
        data-state={validationState}
        role="listitem"
      >
        <span class="m-env-command-tick" aria-hidden="true">{validationState === 'done' ? '✓' : '3'}</span>
        <span class="m-env-command-copy"><strong>Validation</strong><small>{validationLive ? `${currentEvalDone} / ${total} current` : validation ? `${validationScored} scored${validationErrors ? ` · ${validationErrors} error${validationErrors === 1 ? '' : 's'}` : ''} · 4 rollouts` : cleanRl ? 'ready after RL smoke' : 'wait for clean RL'}</small></span>
      </div>

      <div class="m-env-command-step" data-state="todo" role="listitem">
        <span class="m-env-command-tick" aria-hidden="true">4</span>
        <span class="m-env-command-copy"><strong>Scale</strong><small>{scaleReadyCount(environments)} of {total} ready</small></span>
      </div>

      <div class="m-env-command-actions">
        <span class="m-env-command-model">{policyModel || 'model not configured'}</span>
        {!packageComplete ? (
          <button
            class="secondary"
            type="button"
            hx-post="/ui/env-lab/build"
            hx-include="closest form"
            hx-target="#env-lab-body"
            hx-swap="outerHTML"
            disabled={!canBuild || packageLive}
          >
            {packageLive ? 'Packaging…' : 'Build packages'}
          </button>
        ) : null}
        <button type="submit" name="kind" value="rl_test" hx-vals='{"rollouts_per_example":2}' disabled={!canRunRl || evalLive}>
          {rlLive ? 'RL smoke running…' : rlTest ? 'Rerun RL smoke' : 'Run RL smoke'}
        </button>
        <button type="submit" name="kind" value="validation" hx-vals='{"rollouts_per_example":4}' disabled={!canRunValidation || evalLive}>
          {validationLive ? 'Validation running…' : validation ? 'Rerun validation' : 'Run validation'}
        </button>
      </div>
    </div>
  );
}

function scaleReadyCount(environments: EnvironmentRow[]) {
  return environments.filter((environment) => environment.scaleReady).length;
}
