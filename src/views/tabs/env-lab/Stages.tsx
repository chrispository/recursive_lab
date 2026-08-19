import type { EnvironmentRow, EvaluationSummary } from '../../../domain/environments/model.ts';
import { isLive, type JobRow } from '../../../domain/jobs/model.ts';

type StageState = 'done' | 'active' | 'error' | 'todo';

export function EnvLabStages({
  environments,
  rlTest,
  validation,
  buildJob,
  evalJob,
  canBuild,
  canRunRl,
  canRunValidation,
}: {
  environments: EnvironmentRow[];
  rlTest: EvaluationSummary | null;
  validation: EvaluationSummary | null;
  buildJob: JobRow | null;
  evalJob: JobRow | null;
  canBuild: boolean;
  canRunRl: boolean;
  canRunValidation: boolean;
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

  const rlObserved = environments.filter((environment) => environment.rlTest !== null).length;
  const rlScored = environments.filter((environment) => environment.rlTest !== null && !environment.rlTest.error).length;
  const rlErrors = environments.filter((environment) => environment.rlTest?.error).length;
  const validationObserved = environments.filter((environment) => environment.validation !== null).length;
  const validationScored = environments.filter((environment) => environment.validation !== null && !environment.validation.error).length;
  const validationErrors = environments.filter((environment) => environment.validation?.error).length;
  const cleanRl = Boolean(rlTest && rlTest.erroredEnvironments === 0 && rlTest.tasksScored > 0);
  const currentEvalDone = evalLive && total > 0 ? Math.min(total, Math.round((evalJob?.progress ?? 0) * total)) : 0;

  return (
    <div class="m-subway m-env-stages" role="list">
      <div
        class="m-subway-stop"
        data-state={packageLive ? 'active' : packageComplete ? 'done' : failedPackages ? 'error' : 'todo'}
        role="listitem"
      >
        <span class="m-subway-rail" aria-hidden="true"><i class="m-subway-dot" /></span>
        <span class="m-subway-name">Package</span>
        <span class="m-subway-state">{packageLive ? buildJob?.step || 'building packages' : packageComplete ? '6 packages ready' : failedPackages ? `${failedPackages} package${failedPackages === 1 ? '' : 's'} failed` : 'not built'}</span>
        <StageProgress
          state={packageLive ? 'active' : packageComplete ? 'done' : failedPackages ? 'error' : 'todo'}
          count={total ? `${built} / ${total} built` : '0 / 0'}
          fraction={packageLive ? buildJob?.progress ?? 0 : total ? built / total : 0}
        />
        <button
          type="button"
          hx-post="/ui/env-lab/build"
          hx-include="closest form"
          hx-target="#env-lab-body"
          hx-swap="outerHTML"
          disabled={!canBuild || packageComplete || packageLive}
        >
          {packageComplete ? '✓ Packages complete' : packageLive ? 'Packaging…' : total ? 'Build missing packages' : 'Build packages'}
        </button>
      </div>

      <div
        class="m-subway-stop"
        data-state={rlLive ? 'active' : rlTest?.erroredEnvironments ? 'error' : rlTest ? 'done' : 'todo'}
        role="listitem"
      >
        <span class="m-subway-rail" aria-hidden="true"><i class="m-subway-dot" /></span>
        <span class="m-subway-name">Local RL test</span>
        <span class="m-subway-state">{rlLive ? evalJob?.step || 'running RL smoke' : rlTest?.erroredEnvironments ? `${rlErrors} error${rlErrors === 1 ? '' : 's'} · no reward` : rlTest ? `${rlScored} environments scored · ${rlTest.rolloutsPerExample} rollouts` : 'not run'}</span>
        <StageProgress
          state={rlLive ? 'active' : rlTest?.erroredEnvironments ? 'error' : rlTest ? 'done' : 'todo'}
          count={rlLive ? `${currentEvalDone} / ${total} current · live` : `${rlScored} / ${total} scored${rlErrors ? ` · ${rlErrors} errors` : ''}`}
          fraction={rlLive ? evalJob?.progress ?? 0 : total ? rlObserved / total : 0}
        />
        <button type="submit" name="kind" value="rl_test" hx-vals='{"rollouts_per_example":2}' disabled={!canRunRl || evalLive}>
          {rlLive ? 'RL test running…' : rlTest?.erroredEnvironments ? 'Rerun RL test' : 'Run RL test'}
        </button>
      </div>

      <div
        class="m-subway-stop"
        data-state={validationLive ? 'active' : validation?.erroredEnvironments ? 'error' : validation ? 'done' : 'todo'}
        role="listitem"
      >
        <span class="m-subway-rail" aria-hidden="true"><i class="m-subway-dot" /></span>
        <span class="m-subway-name">Local validation</span>
        <span class="m-subway-state">{validationLive ? evalJob?.step || 'running validation' : validation?.erroredEnvironments ? `${validationErrors} error${validationErrors === 1 ? '' : 's'}` : validation ? `${validationScored} environments scored · 4 rollouts` : cleanRl ? 'ready after RL smoke' : 'wait for a clean RL test'}</span>
        <StageProgress
          state={validationLive ? 'active' : validation?.erroredEnvironments ? 'error' : validation ? 'done' : 'todo'}
          count={validationLive ? `${currentEvalDone} / ${total} current · live` : `${validationScored} / ${total} scored${validationErrors ? ` · ${validationErrors} errors` : ''}`}
          fraction={validationLive ? evalJob?.progress ?? 0 : total ? validationObserved / total : 0}
        />
        <button type="submit" name="kind" value="validation" hx-vals='{"rollouts_per_example":4}' disabled={!canRunValidation || evalLive}>
          {validationLive ? 'Validation running…' : validation ? 'Rerun validation' : 'Run validation'}
        </button>
      </div>

      <div class="m-subway-stop" data-state="todo" role="listitem">
        <span class="m-subway-rail" aria-hidden="true"><i class="m-subway-dot" /></span>
        <span class="m-subway-name">Scale</span>
        <span class="m-subway-state">Per-environment gate · later</span>
        <span class="m-env-stage-deferred">Not part of this pass</span>
      </div>
    </div>
  );
}

function StageProgress({ state, count, fraction }: { state: StageState; count: string; fraction: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return (
    <span class="m-env-stage-progress">
      <span class="m-env-stage-progress-meta"><b data-state={state}>{state === 'done' ? 'complete' : state === 'active' ? 'live' : state === 'error' ? 'error' : 'locked'}</b><span>{count}</span></span>
      <span class="m-env-stage-track" data-state={state} role="progressbar" aria-label={`${count} · ${state}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={String(percent)}>
        <i style={`width:${percent}%`} />
      </span>
    </span>
  );
}
