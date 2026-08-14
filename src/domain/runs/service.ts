/**
 * Creating a benchmark run and driving it through NeMo Gym.
 *
 * The run row and its task selection are written *before* gym starts, so a
 * crash still records intent. Exactly one model per run. Gym spawn lives in
 * `src/gym/`; this file only orchestrates.
 */
import { code } from '../../db/ids.ts';
import * as evalRun from '../../gym/eval.ts';
import * as gymResults from '../../gym/results.ts';
import { audit } from '../audit/service.ts';
import * as benchmarks from '../benchmarks/service.ts';
import * as jobs from '../jobs/trace.ts';
import type { BenchmarkTaskCriteria, RunRequest, RunSettings } from './model.ts';
import * as repo from './repo.ts';

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
 */
export async function criteriaByTask(benchmarkRunId: number): Promise<BenchmarkTaskCriteria[]> {
  const groups = new Map<string, BenchmarkTaskCriteria>();
  for (const criterion of await repo.listCriteriaByBenchmarkRun(benchmarkRunId)) {
    let group = groups.get(criterion.taskId);
    if (!group) {
      group = { taskId: criterion.taskId, criteria: [], passed: 0, failed: 0 };
      groups.set(criterion.taskId, group);
    }
    group.criteria.push(criterion);
    if (criterion.result === 'pass') group.passed += 1;
    else group.failed += 1;
  }
  return [...groups.values()];
}

export async function current() {
  const [benchmarkRun] = await repo.listAll();
  return benchmarkRun ?? null;
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
    shellTimeout: numberOf(raw.shellTimeout, 60, 5, 600),
    agentModelTimeout: numberOf(raw.agentModelTimeout, 1800, 30, 7200),
    judgeParallelism: numberOf(raw.judgeParallelism, 6, 1, 32),
    judgeTimeout: numberOf(raw.judgeTimeout, 90, 10, 600),
    judgeMaxTokens: numberOf(raw.judgeMaxTokens, 4096, 256, 16384),
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
    step: 'starting gym eval',
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
  await trace.step('collecting rollouts', 0.1);

  const exit = await handle.spawned.wait();
  await trace.log(`[process exited ${exit}]`, exit === 0 ? 'out' : 'err');
  if (exit !== 0) throw new RunError(`gym eval run exited ${exit}.`);

  await ingest(work, handle.outputPath);
}

async function ingest(
  work: { benchmarkRunId: number; benchmarkId: number; taskIds: string[]; trace: jobs.Trace },
  outputPath: string,
): Promise<void> {
  await work.trace.step('reading rollouts', 0.8);
  const rollouts = await gymResults.read(outputPath);
  await work.trace.log(`rollouts              ${rollouts.length}`);

  const catalog = await benchmarks.criteriaFor(work.benchmarkId, work.taskIds);
  const byTask = new Map<string, Map<string, (typeof catalog)[number]>>();
  for (const row of catalog) {
    let inner = byTask.get(row.taskId);
    if (!inner) {
      inner = new Map();
      byTask.set(row.taskId, inner);
    }
    inner.set(row.criterionId, row);
  }

  const seen = new Set<string>();
  const counts = { passed: 0, failed: 0, error: 0, skipped: 0, criteria: 0, criteriaPassed: 0, criteriaFailed: 0 };

  const expected = work.taskIds.length;
  const resultId = await repo.insertResult({
    benchmarkRunId: work.benchmarkRunId,
    benchmarkId: work.benchmarkId,
    result: 'error',
    tasksTotal: expected,
    tasksPassed: 0,
    tasksFailed: 0,
    tasksError: 0,
    tasksSkipped: 0,
    criteriaTotal: 0,
    criteriaPassed: 0,
    criteriaFailed: 0,
    passRate: null,
    reward: null,
    resultPath: outputPath,
    metrics: {},
  });

  for (const rollout of rollouts) {
    const key = `${rollout.taskId}\0${rollout.trialName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[rollout.result] += 1;

    const taskResultId = await repo.insertTaskResult({
      benchmarkResultId: resultId,
      benchmarkId: work.benchmarkId,
      taskId: rollout.taskId,
      trialName: rollout.trialName,
      result: rollout.result,
      reward: rollout.reward,
      criteriaTotal: rollout.criteria.length,
      criteriaPassed: rollout.criteria.filter((item) => item.result === 'pass').length,
      criteriaFailed: rollout.criteria.filter((item) => item.result === 'fail').length,
      resultPath: rollout.trialDir,
      metrics: { error: rollout.error },
    });

    const catalogForTask = byTask.get(rollout.taskId);
    for (const criterion of rollout.criteria) {
      const ref = catalogForTask?.get(criterion.criterionId);
      if (!ref) {
        await work.trace.log(`unmatched criterion   ${rollout.taskId} ${criterion.criterionId}`, 'err');
        continue;
      }
      counts.criteria += 1;
      if (criterion.result === 'pass') counts.criteriaPassed += 1;
      if (criterion.result === 'fail') counts.criteriaFailed += 1;
      await repo.insertCriterionResult({
        taskResultId,
        catalogCriterionId: ref.id,
        taskId: rollout.taskId,
        trialName: rollout.trialName,
        criterionId: criterion.criterionId,
        title: criterion.title || ref.title,
        result: criterion.result,
        reasoning: criterion.reasoning,
        matchCriteria: ref.matchCriteria,
        judgeModel: '',
        judgeError: criterion.judgeError,
        errorType: criterion.errorType,
      });
    }
  }

  for (const taskId of work.taskIds) {
    const has = [...seen].some((key) => key.startsWith(`${taskId}\0`));
    if (has) continue;
    counts.skipped += 1;
    await repo.insertTaskResult({
      benchmarkResultId: resultId,
      benchmarkId: work.benchmarkId,
      taskId,
      trialName: 'trial-1',
      result: 'skipped',
      reward: null,
      criteriaTotal: 0,
      criteriaPassed: 0,
      criteriaFailed: 0,
      resultPath: null,
      metrics: {},
    });
  }

  const passRate = counts.criteria > 0 ? counts.criteriaPassed / counts.criteria : null;
  let result: 'passed' | 'failed' | 'error' | 'skipped' = 'failed';
  if (counts.error) result = 'error';
  else if (counts.passed === expected && counts.failed === 0) result = 'passed';
  else if (counts.skipped === expected) result = 'skipped';

  // insertResult already wrote a placeholder; overwrite via a second insert is
  // blocked by UNIQUE(benchmark_run_id). Update in place through a tiny SQL
  // here would be a repo leak — re-insert is wrong, so the first insert used
  // dummy totals. We delete-and-replace? UNIQUE. Need updateResult in repo.
  await repo.updateResult(resultId, {
    result,
    tasksTotal: expected,
    tasksPassed: counts.passed,
    tasksFailed: counts.failed,
    tasksError: counts.error,
    tasksSkipped: counts.skipped,
    criteriaTotal: counts.criteria,
    criteriaPassed: counts.criteriaPassed,
    criteriaFailed: counts.criteriaFailed,
    passRate,
    reward: passRate,
    metrics: { pass_rate: passRate, criteria_total: counts.criteria },
  });

  await work.trace.log(
    `benchmark_results     ${result}  tasks ${counts.passed}/${expected} passed  criteria ${counts.criteriaPassed}/${counts.criteria}`,
  );
  await work.trace.succeed({
    benchmarkRunId: work.benchmarkRunId,
    result,
    tasks: expected,
    criteria: counts.criteria,
  });
}
