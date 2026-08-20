/**
 * Creating a benchmark run and driving it through NeMo Gym.
 *
 * The run row and its task selection are written *before* gym starts, so a
 * crash still records intent. Exactly one model per run. Gym spawn lives in
 * `src/gym/`; this file only orchestrates.
 *
 * This is the front half — decide what to run, start it, and follow it. Once
 * the process exits, `ingest.ts` takes over and turns its rollouts into rows.
 */
import { benchmarkRunDir } from '../../config.ts';
import { code } from '../../db/ids.ts';
import * as gymConfig from '../../gym/config.ts';
import * as evalRun from '../../gym/eval.ts';
import * as gymHead from '../../gym/head.ts';
import * as gymProgress from '../../gym/progress.ts';
import * as servers from '../../gym/servers.ts';
import { audit } from '../audit/service.ts';
import * as benchmarks from '../benchmarks/service.ts';
import { isLive } from '../jobs/model.ts';
import * as jobRows from '../jobs/service.ts';
import * as jobs from '../jobs/trace.ts';
import { ingest } from './ingest.ts';
import { ROLLOUT_SHARE, type BenchmarkRunSummary, type BenchmarkTaskCriteria, type RunRequest, type RunSettings } from './model.ts';
import * as repo from './repo.ts';
import { starting, stepOf } from './steps.ts';

export type {
  BenchmarkCriterionResult,
  BenchmarkRunSummary,
  BenchmarkTaskCriteria,
  JsonObject,
  RunRequest,
  RunSettings,
} from './model.ts';

export const byBenchmarkRunId = repo.findByBenchmarkRunId;
export const list = repo.listAll;
export const criteriaByBenchmarkRun = repo.listCriteriaByBenchmarkRun;

/**
 * The same verdicts, grouped by task.
 *
 * A criterion id only means something inside its task, so a flat list across a
 * multi-task run is unreadable — `C-001` appears once per task. The repo
 * already returns rows in task order, so this is one pass with no sort.
 *
 * `errored` is counted separately rather than folded into `failed`: a criterion
 * the judge could not grade is not a criterion the model got wrong, and a tally
 * that merges them reports a capability gap the run never demonstrated.
 */
export async function criteriaByTask(benchmarkRunId: number): Promise<BenchmarkTaskCriteria[]> {
  const groups = new Map<string, BenchmarkTaskCriteria>();
  for (const criterion of await repo.listCriteriaByBenchmarkRun(benchmarkRunId)) {
    let group = groups.get(criterion.taskId);
    if (!group) {
      group = { taskId: criterion.taskId, criteria: [], passed: 0, failed: 0, errored: 0 };
      groups.set(criterion.taskId, group);
    }
    group.criteria.push(criterion);
    if (criterion.result === 'pass') group.passed += 1;
    else if (criterion.result === 'fail') group.failed += 1;
    else group.errored += 1;
  }
  return [...groups.values()];
}

export async function current(): Promise<BenchmarkRunSummary | null> {
  const [benchmarkRun] = await repo.listAll();
  return benchmarkRun ?? null;
}

/**
 * Where the running gym's Harbor agent writes trials.
 *
 * Resolving this costs a head probe and a config read, and the ledger asks on
 * every poll, so the answer is held briefly. It only changes when gym restarts.
 */
let jobsDirCache: { at: number; adapter: string; value: string } | null = null;
const JOBS_DIR_CACHE_MS = 30_000;

async function harborJobsDirFor(adapter: string): Promise<string> {
  const now = Date.now();
  if (jobsDirCache && jobsDirCache.adapter === adapter && now - jobsDirCache.at < JOBS_DIR_CACHE_MS) {
    return jobsDirCache.value;
  }
  const health = await gymHead.health();
  const resources = servers.pickResources(health, adapter);
  const agent = servers.pickAgent(health, resources);
  const live = await gymConfig.loadCached();
  const value = gymConfig.harborJobsDir(live, agent.processName, agent.name);
  jobsDirCache = { at: now, adapter, value };
  return value;
}

/**
 * Re-read Harbor's trial folder and gym's output file, then publish a
 * user-facing step onto the live job.
 *
 * The background follow loop does this too, but a `--watch` reload abandons
 * that loop while gym keeps writing. The ledger poll calls this so the bar
 * and the subtitle still move.
 */
export async function syncProgress(run: BenchmarkRunSummary): Promise<gymProgress.LiveProgress | null> {
  const rows = await jobRows.listByBenchmarkRun(run.benchmarkRunId);
  const job = rows.find((item) => item.kind === 'benchmark_run');
  if (!isLive(job) || !job) return null;
  const repeats = typeof run.settings.repeats === 'number' ? run.settings.repeats : 1;
  const total = Math.max(1, run.taskCount * repeats);
  const maxTurns = typeof run.settings.maxTurns === 'number' ? run.settings.maxTurns : 60;
  try {
    const hint = await criteriaHintOf(run.benchmarkRunId, run.taskCount);
    const startedAt = Date.parse(job.startedAt);
    const live = await gymProgress.snapshot({
      outputPath: `${benchmarkRunDir(run.benchmarkRunCode)}/rollouts.jsonl`,
      harborJobsDir: await harborJobsDirFor(run.adapter),
      total,
      maxTurns,
      criteriaHint: hint,
      since: Number.isFinite(startedAt) ? startedAt : undefined,
    });
    await jobs.setStep(job.jobId, stepOf(live.phase), live.fraction * ROLLOUT_SHARE);
    return live;
  } catch {
    // A missing file is not a failed run.
    return null;
  }
}

async function criteriaHintOf(benchmarkRunId: number, taskCount: number): Promise<number | undefined> {
  if (taskCount !== 1) return undefined;
  const selected = await repo.taskIdsByRun(benchmarkRunId);
  if (selected.taskIds.length !== 1) return undefined;
  const rows = await benchmarks.criteriaFor(selected.benchmarkId, selected.taskIds);
  return rows.length || undefined;
}

export class RunError extends Error {}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function numberOf(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return clamp(fallback, min, max);
  return clamp(n, min, max);
}

export function settingsOf(raw: Partial<RunSettings> = {}): RunSettings {
  const strategy = raw.outputTokenStrategy === 'fixed' ? 'fixed' : 'adaptive';
  return {
    repeats: numberOf(raw.repeats, 1, 1, 20),
    concurrency: numberOf(raw.concurrency, 1, 1, 32),
    temperature: numberOf(raw.temperature, 1, 0, 2),
    topP: numberOf(raw.topP, 0.95, 0.01, 1),
    outputTokenStrategy: strategy,
    maxOutputTokens: numberOf(raw.maxOutputTokens, 24576, 256, 131072),
    maxTurns: numberOf(raw.maxTurns, 60, 1, 200),
    shellTimeout: numberOf(raw.shellTimeout, 300, 5, 600),
    agentModelTimeout: numberOf(raw.agentModelTimeout, 1800, 30, 7200),
    judgeParallelism: numberOf(raw.judgeParallelism, 6, 1, 32),
    judgeTimeout: numberOf(raw.judgeTimeout, 90, 10, 600),
    judgeMaxTokens: numberOf(raw.judgeMaxTokens, 8192, 256, 16384),
    judgeRetries: numberOf(raw.judgeRetries, 1, 0, 5),
  };
}

function requireRequest(input: RunRequest): { model: string; taskIds: string[] } {
  const model = input.model.trim();
  if (!model) throw new RunError('Enter exactly one model id.');
  if (model.includes(',') || model.includes('\n')) {
    throw new RunError('A run contains exactly one model. Remove the extra ids.');
  }
  const taskIds = [...new Set(input.taskIds.map((id) => id.trim()).filter(Boolean))];
  if (taskIds.length === 0) throw new RunError('Select one or more tasks.');
  return { model, taskIds };
}

/**
 * Persist intent, then start gym in the background. Returns as soon as the
 * process is spawned so the HTTP handler is not held for the eval.
 */
export async function start(input: RunRequest): Promise<{ benchmarkRunId: number; benchmarkRunCode: string }> {
  const { model, taskIds } = requireRequest(input);
  const catalog = await benchmarks.get(input.benchmarkId);
  if (!catalog) throw new RunError('Unknown benchmark.');
  const known = await repo.existingTaskIds(input.benchmarkId, taskIds);
  const missing = taskIds.filter((id) => !known.has(id));
  if (missing.length) throw new RunError(`Tasks not in this catalog: ${missing.slice(0, 5).join(', ')}.`);

  const adapter = await benchmarks.bindAdapter(input.benchmarkId);
  const settings = settingsOf(input.settings);
  const benchmarkRunId = await repo.insertRun({
    benchmarkId: input.benchmarkId,
    label: catalog.name,
    model,
    taskCount: taskIds.length,
    settings,
  });
  const benchmarkRunCode = code('benchmark_runs', benchmarkRunId);
  await repo.insertRunTasks(benchmarkRunId, input.benchmarkId, taskIds);
  await audit('benchmark_runs', benchmarkRunId, 'create', { model, adapter, tasks: taskIds.length });

  const trace = await jobs.start('benchmark_run', 'benchmark_runs', benchmarkRunId, {
    step: starting,
    params: { model, adapter, tasks: taskIds.length, repeats: settings.repeats },
  });

  void execute({
    benchmarkRunId,
    benchmarkRunCode,
    benchmarkId: input.benchmarkId,
    adapter,
    model,
    taskIds,
    settings,
    trace,
  }).catch(async (error) => {
    try {
      await trace.fail(error);
    } catch {
      console.error(error);
    }
  });

  return { benchmarkRunId, benchmarkRunCode };
}

/** How often the run asks its own output file how far gym has got. */
const POLL_MS = 1000;

/**
 * Follow gym and Harbor while the eval runs and publish a user-facing step.
 *
 * Nothing here may throw: this races the process it is watching, so a file that
 * is momentarily unreadable or a write that loses to a restart must cost the
 * run nothing. The loop ends when the caller flips `running`.
 */
async function follow(
  opts: gymProgress.LiveOpts,
  trace: jobs.Trace,
  running: { value: boolean },
): Promise<void> {
  let published = '';
  while (running.value) {
    try {
      const live = await gymProgress.snapshot(opts);
      const fraction = live.fraction * ROLLOUT_SHARE;
      const step = stepOf(live.phase);
      const key = `${step}\0${fraction.toFixed(4)}`;
      if (key !== published) {
        published = key;
        await trace.step(step, fraction);
      }
    } catch {
      // A transient read or write is not worth failing a run over.
    }
    await Bun.sleep(POLL_MS);
  }
}

async function execute(work: {
  benchmarkRunId: number;
  benchmarkRunCode: string;
  benchmarkId: number;
  adapter: string;
  model: string;
  taskIds: string[];
  settings: RunSettings;
  trace: jobs.Trace;
}): Promise<void> {
  const { trace, settings } = work;
  // Read before gym starts: a trial folder older than this belongs to an
  // earlier run sharing the same Harbor jobs directory.
  const startedAt = Date.now();
  await trace.log(`adapter               ${work.adapter}`);
  await trace.log(`model                 ${work.model}`);
  await trace.log(`tasks                 ${work.taskIds.length} × ${settings.repeats} repeat(s)`);

  const handle = await evalRun.start(
    {
      benchmarkRunCode: work.benchmarkRunCode,
      adapter: work.adapter,
      model: work.model,
      tasks: work.taskIds.map((taskId) => ({ taskId, maxOutputTokens: settings.maxOutputTokens })),
      settings: {
        repeats: settings.repeats,
        concurrency: settings.concurrency,
        temperature: settings.temperature,
        topP: settings.topP,
        outputTokenStrategy: settings.outputTokenStrategy,
        maxOutputTokens: settings.maxOutputTokens,
        maxTurns: settings.maxTurns,
        shellTimeout: settings.shellTimeout,
        agentModelTimeout: settings.agentModelTimeout,
        judgeParallelism: settings.judgeParallelism,
        judgeTimeout: settings.judgeTimeout,
        judgeMaxTokens: settings.judgeMaxTokens,
        judgeRetries: settings.judgeRetries,
      },
    },
    (line, stream) => trace.log(line, stream),
  );
  await trace.setPgid(handle.spawned.pgid);
  await trace.log(`$ ${handle.command.join(' ')}`);
  await trace.log(`harbor jobs dir       ${handle.harborJobsDir}`);
  // These reach the agent and resources servers only when `gym env start`
  // builds them, so a running gym ignores what this run asked for. Saying so
  // is the difference between a setting that did nothing and one that lied.
  await trace.log(
    `fixed at gym start    ${evalRun.settingsFixedAtStart.join(', ')} — restart gym to change`,
  );

  const total = work.taskIds.length * settings.repeats;
  const criteriaHint = await criteriaHintOf(work.benchmarkRunId, work.taskIds.length);
  const liveOpts: gymProgress.LiveOpts = {
    outputPath: handle.outputPath,
    harborJobsDir: handle.harborJobsDir,
    total,
    maxTurns: settings.maxTurns,
    criteriaHint,
    since: startedAt,
  };
  const opening = await gymProgress.snapshot(liveOpts);
  await trace.step(stepOf(opening.phase), opening.fraction * ROLLOUT_SHARE);

  const running = { value: true };
  const watching = follow(liveOpts, trace, running);

  const exit = await handle.spawned.wait();
  running.value = false;
  await watching;

  await trace.log(`[process exited ${exit}]`, exit === 0 ? 'out' : 'err');
  if (exit !== 0) throw new RunError(`gym eval run exited ${exit}.`);

  await ingest(work, handle.outputPath);
}
