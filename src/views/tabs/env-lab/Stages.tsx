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
        <span class="m-env-command-copy"><strong>Execution check</strong><small>{rlLive ? `${currentEvalDone} / ${total} current` : rlTest ? `${rlScored} scored${rlErrors ? ` · ${rlErrors} error${rlErrors === 1 ? '' : 's'}` : ''} · ${rlTest.rolloutsPerExample} rollouts` : 'not run'}</small></span>
      </div>

      <div
        class="m-env-command-step"
        data-state={validationState}
        role="listitem"
      >
        <span class="m-env-command-tick" aria-hidden="true">{validationState === 'done' ? '✓' : '3'}</span>
        <span class="m-env-command-copy"><strong>Training signal</strong><small>{validationLive ? `${currentEvalDone} / ${total} current` : validation ? `${validationScored} scored${validationErrors ? ` · ${validationErrors} error${validationErrors === 1 ? '' : 's'}` : ''} · 4 rollouts` : canRunValidation ? 'ready to check' : 'run execution check'}</small></span>
      </div>

      <div class="m-env-command-step" data-state={scaleReadyCount(environments) > 0 ? 'done' : 'todo'} role="listitem">
        <span class="m-env-command-tick" aria-hidden="true">4</span>
        <span class="m-env-command-copy"><strong>Export</strong><small>{scaleReadyCount(environments)} of {total} ready</small></span>
      </div>

      <div class="m-env-command-actions">
        <span class="m-env-command-model">{policyModel || 'model not configured'}</span>
        {(
          <button
            class="secondary"
            type="button"
            hx-post="/ui/env-lab/build"
            hx-include="closest form"
            hx-target="#env-lab-body"
            hx-swap="outerHTML"
            disabled={!canBuild || packageLive}
          >
            {packageLive ? 'Packaging…' : packageComplete ? 'Rebuild packages' : 'Build packages'}
          </button>
        )}
        <button type="submit" name="kind" value="rl_test" hx-vals='{"rollouts_per_example":2}' disabled={!canRunRl || evalLive}>
          {rlLive ? 'Execution check running…' : rlTest ? 'Rerun Execution check' : 'Run Execution check'}
        </button>
        <button type="submit" name="kind" value="validation" hx-vals='{"rollouts_per_example":4}' disabled={!canRunValidation || evalLive}>
          {validationLive ? 'Checking training signal…' : validation ? 'Recheck training signal' : 'Check training signal'}
        </button>
      </div>
    </div>
  );
}

function scaleReadyCount(environments: EnvironmentRow[]) {
  return environments.filter((environment) => environment.scaleReady).length;
}
