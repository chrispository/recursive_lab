import type { PublicSettings } from '../../gym/settings.ts';
import type { BenchmarkCatalog } from '../../domain/benchmarks/model.ts';
import { isLive, type JobRow } from '../../domain/jobs/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import {
  CatalogNote,
  CatalogSelect,
  ImportForm,
  TaskCount,
  TaskPicker,
} from './benchmarks/ImportForm.tsx';
import { RunLedger } from './benchmarks/RunLedger.tsx';

function Help({ text }: { text: string }) {
  return <span class="m-help" title={text} aria-label={text}>?</span>;
}

function NumberField({ id, label, value, min, max, step, help }: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  help: string;
}) {
  return (
    <div class="m-config-field">
      <label for={id}>{label} <Help text={help} /></label>
      <input id={id} name={id} type="number" min={String(min)} max={String(max)} step={step === undefined ? undefined : String(step)} value={String(value)} />
    </div>
  );
}

export function Benchmarks({
  benchmarkRun,
  runs,
  jobs,
  catalogs,
  catalog,
  settings,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  /** Every run — the ledger is a per-run history. */
  runs: BenchmarkRunSummary[];
  jobs: JobRow[];
  /** Headers only — these fill the dropdown and carry no task rows. */
  catalogs: BenchmarkCatalog[];
  /** The selected catalog, and the only one whose tasks are loaded. */
  catalog: BenchmarkCatalog | null;
  settings: PublicSettings;
}) {
  const model = benchmarkRun?.model || settings.policy_model_name;
  const runJob = jobs.find((item) => item.kind === 'benchmark_run') ?? null;
  const live = isLive(runJob);

  return (
    <>
      <div class="m-title">
        <h2>Run the model through NeMo Gym + Harbor</h2>
        <p>
          NeMo Gym orchestrates the rollout; Harbor executes the task, records the trajectory, and
          scores every criterion. Failed criteria become the input to the failure map.
        </p>
      </div>

      <div class="m-config-layout">
        <div class="m-config-stack">
        <details id="benchmarks-config" class="m-config-panel" open={live ? undefined : true}>
          <summary class="m-config-head">
            <h3>Run configuration</h3>
            <div class="m-config-head-right">
              <span class="m-code">NEMO GYM × HARBOR</span>
              <a class="m-settings-link" href="/settings" hx-boost="true" hx-target="#workspace" hx-swap="innerHTML" aria-label="Open settings" title="Open settings">⚙</a>
            </div>
          </summary>

          <div class="m-config-body">
            <ImportForm />

            <div id="benchmarks-run-fields" class="m-config-fields">
            <div class="m-config-field full">
              <label for="benchmark-select">Benchmark <Help text="Choose the benchmark directly. Its source, revision, and adapter remain attached as provenance." /></label>
              <CatalogSelect catalogs={catalogs} selectedId={catalog?.benchmarkId ?? null} />
              <CatalogNote catalog={catalog} />
            </div>

            <div class="m-config-field full">
              <label for="model-under-test">Model under test <Help text="The policy model NeMo Gym sends through the Harbor agent. Runs contain exactly one model so failures stay attributable." /></label>
              <input id="model-under-test" name="model" value={model} placeholder="z-ai/glm-5.2" />
              <div class="m-config-note">
                {settings.has_policy_key ? 'API key saved' : 'No API key saved'} · {settings.policy_base_url}
              </div>
            </div>

            <div class="m-config-field full">
              <label for="task-filter">Benchmark tasks <Help text="Choose the immutable validation tasks this run will evaluate. The selected task snapshot is saved with the run." /></label>
              <input id="task-filter" placeholder="Filter tasks by id or name" autocomplete="off" />
              <div class="m-task-toolbar">
                <TaskCount catalog={catalog} />
                <span>
                  <button id="check-visible" class="secondary compact" type="button">Check visible</button>
                  <button id="clear-tests" class="ghost compact" type="button">Clear</button>
                </span>
              </div>
              <TaskPicker catalog={catalog} />
            </div>

            <NumberField id="repeats" label="Repeats per test" value={1} min={1} max={20} help="Run each selected task this many times. More repeats make criterion failure rates more stable, but increase cost linearly." />
            <NumberField id="concurrency" label="Rollout concurrency" value={1} min={1} max={32} help="Maximum number of Harbor rollouts running at once." />

            <details class="m-advanced full">
              <summary><span class="m-advanced-mark" aria-hidden="true">+</span> Advanced run settings</summary>
              <div class="m-advanced-body">
                <p class="m-config-note">These settings are saved with the run and affect output variability, agent budget, judge cost, and timeout behavior.</p>
                <div class="m-advanced-group">
                  <div class="m-advanced-group-head"><h4>Model sampling</h4><span>NeMo Gym → Harbor</span></div>
                  <div class="m-config-grid">
                    <NumberField id="temperature" label="Temperature" value={1} min={0} max={2} step={0.05} help="Sampling randomness for the model under test." />
                    <NumberField id="top-p" label="Top-p" value={0.95} min={0.01} max={1} step={0.01} help="Nucleus sampling cutoff." />
                    <div class="m-config-field full"><label for="output-token-strategy">Output budget strategy</label><select id="output-token-strategy" name="output-token-strategy"><option value="adaptive">Adaptive — 24k standard / 32k long task</option><option value="fixed">Fixed — use the standard cap for every task</option></select></div>
                    <NumberField id="max-output-tokens" label="Standard task cap" value={24576} min={256} max={131072} step={256} help="Maximum response tokens for standard tasks." />
                    <NumberField id="long-task-max-output-tokens" label="Long-task cap" value={32768} min={256} max={131072} step={256} help="Maximum response tokens for long tasks." />
                    <NumberField id="long-task-threshold-tokens" label="Long-task source threshold" value={96000} min={16000} max={262144} step={1024} help="Source-document token threshold for adaptive detection." />
                  </div>
                </div>
                <div class="m-advanced-group">
                  <div class="m-advanced-group-head"><h4>Harbor agent budget</h4><span>TRAJECTORY / TOOLS</span></div>
                  <div class="m-config-grid">
                    <NumberField id="max-turns" label="Max agent turns" value={60} min={1} max={200} help="Maximum model-tool loop turns for one Harbor task." />
                    <NumberField id="shell-timeout" label="Shell timeout (seconds)" value={60} min={5} max={600} help="Maximum time for one shell or tool command." />
                    <NumberField id="agent-model-timeout" label="Model request timeout (seconds)" value={1800} min={30} max={7200} help="Maximum time allowed for one model request." />
                  </div>
                </div>
                <div class="m-advanced-group">
                  <div class="m-advanced-group-head"><h4>Harbor verifier judge</h4><span>CRITERION SCORING</span></div>
                  <div class="m-config-grid">
                    <NumberField id="judge-parallelism" label="Judge parallelism" value={6} min={1} max={32} help="Maximum concurrent criterion-judge requests." />
                    <NumberField id="judge-timeout" label="Judge timeout (seconds)" value={90} min={10} max={600} help="Maximum time for one criterion-judge request." />
                    <NumberField id="judge-max-tokens" label="Judge max tokens" value={8192} min={256} max={16384} step={256} help="Maximum judge response tokens. A verdict is about 100 tokens; the headroom is for judge models that reason before answering, which spend from the same budget." />
                    <NumberField id="judge-retries" label="Judge retries" value={1} min={0} max={5} help="Additional attempts after a failed judge request." />
                  </div>
                </div>
              </div>
            </details>
            </div>
          </div>

          <div class="m-run-actions">
            <div class="m-run-card m-run-card-manual">
              <div><span class="m-run-kicker">MANUAL RUN</span><strong>Run one benchmark</strong><span>Benchmark → Harbor → LAB verifier</span></div>
              <button
                type="button"
                hx-post="/ui/benchmarks/run"
                hx-include="#benchmarks-run-fields"
                hx-target="#benchmark-config-status"
                hx-swap="innerHTML"
                hx-disabled-elt="this"
              >Manually Benchmark</button>
            </div>
            <div class="m-run-card m-run-card-full">
              <div><span class="m-run-kicker">FULL PROCESS</span><label for="recurse-count">RUN <input id="recurse-count" type="number" min="1" max="99" value="1" /> ×</label><span>Benchmark → Tune → Benchmark</span></div>
              <button class="m-recurse-button" type="button" data-benchmark-action="recurse">✦ Recurse</button>
            </div>
          </div>
          <div id="benchmark-config-status" class="m-config-status" role="status" aria-live="polite"></div>
        </details>

        <RunLedger benchmarkRun={benchmarkRun} runs={runs} jobs={jobs} />
        </div>
      </div>
    </>
  );
}
