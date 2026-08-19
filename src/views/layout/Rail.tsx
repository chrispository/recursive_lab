/**
 * The 186px left index rail — the app's only navigation.
 *
 * It carries three things, top to bottom: identity (wordmark), the five numbered
 * pipeline stages, and the gate readout. The gate
 * readout is derived from the current progress on every render and never stored.
 */
import { STAGES, stageNumber, type Tab } from './tabs.ts';

/** How far the current progress reaches, for the stage ticks and the foot. */
export type RailState = {
  /** Numeric id used to keep the selected run in stage links. */
  benchmarkRunId: number | null;
  /** Model under test, shown in the rail foot. */
  model: string | null;
  /** Criteria pass rate 0–1, shown in the rail foot. */
  passRate: number | null;
  /** How many of the five stages are satisfied. Drives `done` vs `active`. */
  gates: number;
};

export const EMPTY_RAIL: RailState = { benchmarkRunId: null, model: null, passRate: null, gates: 0 };

/**
 * A stage is `done` once progress reaches past it, `active` for the one
 * currently in play, and `locked` beyond that.
 */
function statusOf(index: number, gates: number) {
  if (index < gates) return 'done';
  if (index === gates) return 'active';
  return 'locked';
}

/**
 * `oob` re-renders the rail as an out-of-band swap. Page navigations swap only
 * `#workspace`, so the rail's active stripe and gate readout ride along in the
 * same response rather than costing a second request.
 */
export function Rail({ tab, state, oob }: { tab: Tab; state: RailState; oob?: boolean }) {
  const pct = state.passRate === null ? null : `${(state.passRate * 100).toFixed(1)}%`;
  const stageHref = (stage: string) => state.benchmarkRunId ? `/${stage}?run=${state.benchmarkRunId}` : `/${stage}`;

  return (
    <aside id="rail" class="m-rail" hx-swap-oob={oob ? 'true' : undefined}>
      <div class="m-railhead">
        <a class="m-wordmark" href={stageHref('benchmarks')} hx-boost="true">
          recursive<span class="m-wordmark-mark">(</span> <span class="m-wordmark-mark">)</span>
        </a>
      </div>

      {STAGES.map((stage, i) => (
        <a
          class={stage.tab === tab ? 'on' : undefined}
          href={stageHref(stage.tab)}
          data-status={statusOf(i, state.gates)}
          hx-boost="true"
          hx-target="#workspace"
          hx-swap="innerHTML"
        >
          <span class="n">{stageNumber(i)}</span>
          {stage.label}
        </a>
      ))}

      <div class="m-railfoot">
        <a
          class={`m-railsettings${tab === 'settings' ? ' on' : ''}`}
          href="/settings"
          hx-boost="true"
          hx-target="#workspace"
          hx-swap="innerHTML"
        >
          Settings
        </a>
        <div class="m-gates">
          Gates <i>{`${state.gates} / ${STAGES.length}`}</i>
          {state.model ? <br /> : ''}
          {state.model ?? ''}
          {pct ? <br /> : ''}
          {pct ? `${pct} pass` : ''}
        </div>
      </div>
    </aside>
  );
}
