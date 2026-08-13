import type { PublicSettings } from '../../gym/settings.ts';
import type { BenchmarkCatalog, BenchmarkTask } from '../../domain/benchmarks/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Id } from '../ui/Id.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

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
      <input id={id} type="number" min={String(min)} max={String(max)} step={step === undefined ? undefined : String(step)} value={String(value)} />
    </div>
  );
}

function TaskRow({ task }: { task: BenchmarkTask }) {
  return (
    <label class="m-task-row" data-task-row data-task-id={task.taskId.toLowerCase()}>
      <input type="checkbox" value={task.taskId} data-task-checkbox />
      <span>{task.name}</span>
    </label>
  );
}

export function Benchmarks({
  benchmarkRun,
  jobs,
  catalogs,
  settings,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  jobs: JobRow[];
  catalogs: BenchmarkCatalog[];
  settings: PublicSettings;
}) {
  const metrics = benchmarkRun?.metrics ?? {};
  const passRate = numberOf(metrics.pass_rate);
  const benchmarkRunJob = jobs.find((job) => job.kind === 'benchmark_run');
  const catalog = catalogs.find((item) => item.benchmarkCode === benchmarkRun?.benchmarkCode) ?? catalogs[0] ?? null;
  const tasks = catalog?.tasks.filter((task) => task.dataset === 'validation') ?? [];
  const model = benchmarkRun?.model || settings.policy_model_name;

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
        <section class="m-config-panel">
          <div class="m-config-head">
            <h3>Run configuration</h3>
            <div class="m-config-head-right">
              <span class="m-code">NEMO GYM × HARBOR</span>
              <a class="m-settings-link" href="/settings" hx-boost="true" hx-target="#workspace" hx-swap="innerHTML" aria-label="Open settings" title="Open settings">⚙</a>
            </div>
          </div>

          <div class="m-config-body">
            <details class="m-import full">
              <summary>Import from GitHub or Hugging Face</summary>
              <div class="m-import-body">
                <p>The source is downloaded at a pinned revision, inspected as data, and saved with provenance. Known formats are cataloged automatically; execution still requires a compatible adapter.</p>
                <div class="m-import-controls">
                  <input placeholder="https://github.com/org/benchmark or https://huggingface.co/datasets/org/name" aria-label="Benchmark source URL" />
                  <button class="secondary compact" type="button">Inspect source</button>
                  <button class="secondary compact" type="button" disabled>Import benchmark</button>
                </div>
                <div class="m-config-note">Import preview is available when the local adapter is connected.</div>
              </div>
            </details>

            <div class="m-config-field full">
              <label for="benchmark-select">Benchmark <Help text="Choose the benchmark directly. Its source, revision, and adapter remain attached as provenance." /></label>
              <select id="benchmark-select" aria-label="Benchmark">
                {catalogs.map((item) => {
                  const count = item.tasks.filter((task) => task.dataset === 'validation').length;
                  return <option value={String(item.benchmarkId)} selected={item.benchmarkId === catalog?.benchmarkId}>{item.name} · {count.toLocaleString()} tasks</option>;
                })}
              </select>
              <div class="m-config-note">{catalog ? `${catalog.name} · ${catalog.lab} · ${catalog.runnable ? 'Runnable through the configured adapter.' : 'Catalog imported; adapter configuration required.'}` : 'No benchmark catalog is available.'}</div>
            </div>

            <div class="m-config-field full">
              <label for="model-under-test">Model under test <Help text="The policy model NeMo Gym sends through the Harbor agent. Runs contain exactly one model so failures stay attributable." /></label>
              <input id="model-under-test" value={model} placeholder="z-ai/glm-5.2" />
              <div class="m-config-note">{settings.has_policy_key ? 'API key saved' : 'No API key saved'} · {settings.policy_base_url}</div>
            </div>

            <div class="m-config-field full">
              <label for="task-filter">Benchmark tasks <Help text="Choose the immutable validation tasks this run will evaluate. The selected task snapshot is saved with the run." /></label>
              <input id="task-filter" placeholder="Filter tasks by ID" autocomplete="off" />
              <div class="m-task-toolbar">
                <span id="task-count" class="m-code" data-task-total={String(tasks.length)}>0 selected / {tasks.length.toLocaleString()} shown / {tasks.length.toLocaleString()} total</span>
                <span>
                  <button id="check-visible" class="secondary compact" type="button">Check visible</button>
                  <button id="clear-tests" class="ghost compact" type="button">Clear</button>
                </span>
              </div>
              <div id="task-picker" class="m-task-picker" aria-label="Benchmark task selection">
                {tasks.map((task) => <TaskRow task={task} />)}
              </div>
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
                    <div class="m-config-field full"><label for="output-token-strategy">Output budget strategy</label><select id="output-token-strategy"><option>Adaptive — 24k standard / 32k long task</option><option>Fixed — use the standard cap for every task</option></select></div>
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
                    <NumberField id="judge-max-tokens" label="Judge max tokens" value={4096} min={256} max={16384} step={256} help="Maximum judge response tokens." />
                    <NumberField id="judge-retries" label="Judge retries" value={1} min={0} max={5} help="Additional attempts after a failed judge request." />
                  </div>
                </div>
              </div>
            </details>
          </div>

          <div class="m-run-actions">
            <div class="m-run-card m-run-card-manual">
              <div><span class="m-run-kicker">MANUAL RUN</span><strong>Run one benchmark</strong><span>Benchmark → Harbor → LAB verifier</span></div>
              <button type="button" data-benchmark-action="manual">Manually Benchmark</button>
            </div>
            <div class="m-run-card m-run-card-full">
              <div><span class="m-run-kicker">FULL PROCESS</span><label for="recurse-count">RUN <input id="recurse-count" type="number" min="1" max="99" value="1" /> ×</label><span>Benchmark → Tune → Benchmark</span></div>
              <button class="m-recurse-button" type="button" data-benchmark-action="recurse">✦ Recurse</button>
            </div>
          </div>
          <div id="benchmark-config-status" class="m-config-status" role="status" aria-live="polite"></div>
        </section>

        <aside class="m-config-aside">
          <Panel title="System preflight" code="STATUS">
            <div class="m-status-list">
              <div><span>Benchmark catalog</span><Badge state={catalog?.status ?? 'pending'}>{catalog?.status ?? 'missing'}</Badge></div>
              <div><span>Model configured</span><Badge state={model ? 'ready' : 'pending'}>{model ? 'yes' : 'no'}</Badge></div>
              <div><span>API key saved</span><Badge state={settings.has_policy_key ? 'ready' : 'pending'}>{settings.has_policy_key ? 'yes' : 'no'}</Badge></div>
              <div><span>Runnable</span><Badge state={catalog?.runnable ? 'ready' : 'pending'}>{catalog?.runnable ? 'yes' : 'no'}</Badge></div>
            </div>
          </Panel>
        </aside>
      </div>

      <TableBox>
        <Cap title="Benchmark run ledger">
          <Tally
            items={[
              { value: benchmarkRun ? 1 : 0, label: 'runs' },
              { value: benchmarkRun?.taskCount ?? 0, label: 'tasks' },
              { value: numberOf(metrics.criteria_total), label: 'criteria' },
              { value: `${(passRate * 100).toFixed(1)}%`, label: 'pass rate', hot: passRate < 0.8 },
            ]}
          />
        </Cap>
        {benchmarkRun ? (
          <Table>
            <thead><tr><th>Run</th><th>Benchmark</th><th>Model</th><th class="n">Tasks</th><th>Status</th></tr></thead>
            <tbody>
              <tr data-state={benchmarkRunJob?.status ?? 'pending'}>
                <td><span class="nm">{benchmarkRun.label}</span><span class="sub"><Id value={benchmarkRun.benchmarkRunCode} /></span></td>
                <td>{benchmarkRun.benchmarkName}<span class="sub">{benchmarkRun.lab} · {benchmarkRun.adapter}</span></td>
                <td><span class="m-id">{benchmarkRun.model}</span></td>
                <td class="n">{benchmarkRun.taskCount}</td>
                <td><Badge state={benchmarkRunJob?.status ?? 'pending'}>{benchmarkRunJob?.status ?? 'not run'}</Badge></td>
              </tr>
            </tbody>
          </Table>
        ) : <div class="m-empty">No benchmark run has been created.</div>}
      </TableBox>
    </>
  );
}
