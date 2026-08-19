/**
 * Env lab orchestration: package the run's topics as PI environments, prove
 * them locally with `prime eval`, and write the cluster handoff.
 *
 * Stages mirror the page: Build (packages) → RL test (rewards at expected
 * level) → Validation (learnability gate unlocks scale) → Prepare cluster
 * (immutable taskset + prime-rl TOML). No schema beyond the existing tables.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { benchmarkRunDir } from '../../config.ts';
import * as audit from '../audit/service.ts';
import * as jobRows from '../jobs/service.ts';
import { isLive } from '../jobs/model.ts';
import * as jobTrace from '../jobs/trace.ts';
import * as settings from '../../gym/settings.ts';
import {
  clusterToml,
  piInstalled,
  runEval,
  writePackage,
  type PiPackageSpec,
} from '../../gym/pi.ts';
import * as repo from './repo.ts';
import { taskOf, type BuildTopic, type EnvironmentRow, type EvaluationMetrics } from './model.ts';

export type { EnvironmentRow, EvaluationSummary } from './model.ts';
export const listByBenchmarkRun = repo.listByBenchmarkRun;
export const latestEvaluation = repo.latestEvaluation;
export const latestEvaluationOfKind = repo.latestEvaluationOfKind;

export class EnvironmentError extends Error {}

const DEFAULT_THRESHOLD = 0.3;
/** The learnability gate: spread must exist and saturation must not swallow it. */
const MIN_WITHIN_TASK_STD = 0.05;
const MAX_SATURATED_FRACTION = 0.8;
/** The cluster always trains on 4 rollouts per example; local may differ. */
export const CLUSTER_ROLLOUTS = 4;
const DEFAULT_RL_TEST_ROLLOUTS = 2;
const EVAL_TIMEOUT_MS = 30 * 60_000;

const slugify = (name: string) =>
  name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-')
    .slice(0, 48);

const packagesDir = (runCode: string) => resolve(benchmarkRunDir(runCode), 'pi-environments');

/** Packages one environment per topic that has approved forge documents. */
export async function build(benchmarkRunId: number): Promise<{ built: number; jobId: number; jobCode: string }> {
  if (!Number.isInteger(benchmarkRunId) || benchmarkRunId < 1) throw new EnvironmentError('Select a benchmark run.');
  if (!piInstalled()) throw new EnvironmentError('Install the prime CLI before building packages.');

  const context = await repo.runContext(benchmarkRunId);
  if (!context) throw new EnvironmentError('Benchmark run not found.');
  const inputs = await repo.buildInputs(benchmarkRunId);
  if (!inputs.length) throw new EnvironmentError('No approved data-forged documents for this run yet.');

  const existingJob = (await jobRows.listByBenchmarkRun(benchmarkRunId))
    .find((job) => job.kind === 'env_build' && isLive(job));
  if (existingJob) throw new EnvironmentError('An environment build is already running for this benchmark run.');

  const trace = await jobTrace.start('env_build', 'benchmark_runs', benchmarkRunId, {
    step: 'packaging environments',
    params: { benchmarkRunId, topics: inputs.length },
  });
  void executeBuild({ benchmarkRunId, runCode: context.benchmarkRunCode, model: context.model, inputs, trace })
    .catch(async (error) => {
      try {
        await trace.fail(error);
      } catch (closeError) {
        console.error(closeError);
      }
    });
  return { built: inputs.length, jobId: trace.jobId, jobCode: trace.jobCode };
}

async function executeBuild(input: {
  benchmarkRunId: number;
  runCode: string;
  model: string;
  inputs: repo.BuildInput[];
  trace: jobTrace.Trace;
}): Promise<void> {
  const { trace } = input;
  const dir = packagesDir(input.runCode);
  let built = 0;
  for (const entry of input.inputs) {
    if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
    const slug = `${slugify(entry.topic.name) || 'topic'}-${entry.topic.topicCode.toLowerCase().replace('tp-', 'tp')}`;
    await trace.step(`packaging ${entry.topic.topicCode}`, built / input.inputs.length);
    const spec = packageSpec(slug, entry.topic, entry.documents);
    const environmentDir = resolve(dir, slug);
    if (await repo.environmentIdBySlug(slug)) {
      await trace.log(`${slug} already built — skipping`);
      built += 1;
      continue;
    }
    const verifierId = await ensureVerifier(entry.topic);
    const environmentId = await repo.insertEnvironment({
      benchmarkRunId: input.benchmarkRunId,
      topicId: entry.topic.topicId,
      verifierId,
      name: entry.topic.name,
      slug,
      baseModel: input.model,
    });
    const files = await writePackage(environmentDir, spec);
    const packageHash = await hashFiles(files);
    for (const document of entry.documents) {
      await repo.attachDocument(environmentId, document.documentId, document.role);
    }
    await repo.markBuilt(environmentId, {
      localPath: environmentDir,
      packageHash,
      inferenceModel: '',
    });
    await trace.log(
      `${slug}  tasks ${entry.documents.length}  (train ${spec.splits.train.length}, canary ${spec.splits.canary.length}, heldout ${spec.splits.heldout.length})`,
    );
    built += 1;
  }
  if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
  await audit.audit('environments', input.benchmarkRunId, 'build', {
    benchmarkRunId: input.benchmarkRunId,
    built,
    runCode: input.runCode,
  });
  await trace.succeed({ built }, 'Packages built');
}

async function ensureVerifier(topic: BuildTopic): Promise<number> {
  const name = `Judge coverage · ${topic.name}`;
  const existing = await repo.verifierIdByTopic(topic.topicId, name);
  if (existing) return existing;
  return repo.insertVerifier(topic, DEFAULT_THRESHOLD);
}

function packageSpec(slug: string, topic: BuildTopic, documents: repo.BuildInput['documents']): PiPackageSpec {
  return {
    slug,
    title: topic.name,
    topicDescription: topic.description,
    verifierStrategy: topic.verifierStrategy,
    passThreshold: DEFAULT_THRESHOLD,
    splits: {
      train: documents.filter((d) => d.role === 'train').map((d) => taskOf(d, topic.name)),
      canary: documents.filter((d) => d.role === 'canary').map((d) => taskOf(d, topic.name)),
      heldout: documents.filter((d) => d.role === 'heldout').map((d) => taskOf(d, topic.name)),
    },
  };
}

async function hashFiles(paths: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of paths.sort()) {
    hash.update(path);
    hash.update(await readFile(path, 'utf8'));
  }
  return hash.digest('hex').slice(0, 16);
}

// --- local proof -------------------------------------------------------------

export type EvalStart = {
  benchmarkRunId: number;
  kind: 'rl_test' | 'validation';
  model?: string;
  rolloutsPerExample?: number;
  maxConcurrent?: number;
};

export async function startEval(input: EvalStart): Promise<{ jobId: number; jobCode: string }> {
  if (input.kind !== 'rl_test' && input.kind !== 'validation') throw new EnvironmentError('Choose rl test or validation.');
  if (!piInstalled()) throw new EnvironmentError('Install the prime CLI before running local proof.');

  const context = await repo.runContext(input.benchmarkRunId);
  if (!context) throw new EnvironmentError('Benchmark run not found.');
  const environments = await repo.listByBenchmarkRun(input.benchmarkRunId);
  const built = environments.filter((environment) => environment.status === 'built' || environment.status === 'ready');
  if (!built.length) throw new EnvironmentError('Build the environment packages first.');

  const liveJob = (await jobRows.listByBenchmarkRun(input.benchmarkRunId))
    .find((job) => job.kind === 'env_eval' && isLive(job));
  if (liveJob) throw new EnvironmentError('A local proof run is already in progress for this benchmark run.');

  const policy = await settings.policyProvider(input.model ?? '');
  if (!policy.apiKey) throw new EnvironmentError('Configure a policy API key in Settings first.');
  if (!policy.model) throw new EnvironmentError('Configure a policy model in Settings first.');
  const judge = await settings.judgeProvider();
  if (!judge.apiKey || !judge.model) throw new EnvironmentError('Configure a judge API key and model in Settings first.');

  const rollouts = input.kind === 'validation'
    ? CLUSTER_ROLLOUTS
    : bounded(input.rolloutsPerExample, DEFAULT_RL_TEST_ROLLOUTS, 1, 20);
  const maxConcurrent = bounded(input.maxConcurrent, 1, 1, 8);

  const trace = await jobTrace.start('env_eval', 'benchmark_runs', input.benchmarkRunId, {
    step: `local ${input.kind.replace('_', ' ')} starting`,
    params: {
      benchmarkRunId: input.benchmarkRunId,
      kind: input.kind,
      model: policy.model,
      rollouts,
      maxConcurrent,
      environments: built.length,
    },
  });
  await trace.log(`environments            ${built.length}`);
  await trace.log(`policy model            ${policy.model}`);
  await trace.log(`judge model             ${judge.model}`);
  await trace.log(`rollouts per example    ${rollouts}`);

  void executeEval({
    benchmarkRunId: input.benchmarkRunId,
    runCode: context.benchmarkRunCode,
    kind: input.kind,
    environments: built,
    policy,
    judge,
    rollouts,
    maxConcurrent,
    trace,
  }).catch(async (error) => {
    try {
      await trace.fail(error);
    } catch (closeError) {
      console.error(closeError);
    }
  });
  return { jobId: trace.jobId, jobCode: trace.jobCode };
}

async function executeEval(input: {
  benchmarkRunId: number;
  runCode: string;
  kind: 'rl_test' | 'validation';
  environments: EnvironmentRow[];
  policy: settings.ProviderConfig;
  judge: settings.ProviderConfig;
  rollouts: number;
  maxConcurrent: number;
  trace: jobTrace.Trace;
}): Promise<void> {
  const { trace } = input;
  const outputDir = resolve(benchmarkRunDir(input.runCode), 'pi-evals', `${input.kind}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const entries: NonNullable<EvaluationMetrics['environments']> = [];
  const resultPaths: Record<string, string> = {};

  for (const [index, environment] of input.environments.entries()) {
    if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
    await trace.step(`${index} of ${input.environments.length} environments complete`, index / input.environments.length);
    const splits = (['train', 'canary', 'heldout'] as const).filter((split) => environment.taskCounts[split] > 0);
    const rollouts: Array<{ exampleId: number; reward: number }> = [];
    try {
      if (!splits.length) throw new Error('No taskset examples are available to score.');
      for (const split of splits) {
        if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
        const outcome = await runEval(
          {
            envId: environment.slug,
            envDir: environment.localPath ?? '',
            model: input.policy.model,
            baseUrl: input.policy.baseUrl,
            apiKeyVar: 'LAB_POLICY_API_KEY',
            apiKey: input.policy.apiKey,
            judge: { baseUrl: input.judge.baseUrl, apiKey: input.judge.apiKey, model: input.judge.model },
            numExamples: environment.taskCounts[split],
            rolloutsPerExample: input.rollouts,
            maxConcurrent: input.maxConcurrent,
            outputDir,
            timeoutMs: EVAL_TIMEOUT_MS,
            split,
          },
          {
            onLine: (line, stream) => trace.log(`[${split}] ${line}`, stream),
            onSpawn: (pgid) => trace.setPgid(pgid),
          },
        );
        const rolloutError = outcome.rollouts.find((rollout) => rollout.error);
        if (rolloutError?.error) throw new Error(`${split} rollout ${rolloutError.exampleId} failed: ${rolloutError.error}`);
        rollouts.push(...outcome.rollouts.map((rollout) => ({
          exampleId: rollouts.length + rollout.exampleId,
          reward: rollout.reward,
        })));
        resultPaths[`${environment.slug}:${split}`] = outcome.resultsPath;
      }
      const measure = measureOf(rollouts);
      const avgReward = mean(rollouts.map((rollout) => rollout.reward));
      entries.push({
        environment_id: environment.environmentId,
        mean_reward: round(avgReward),
        pass_rate: round(measure.passRate),
        within_task_std: round(measure.withinTaskStd),
        saturated_fraction: round(measure.saturatedFraction),
        tasks_scored: measure.tasksScored,
      });
      await trace.log(
        `${environment.slug}  reward ${avgReward.toFixed(3)}  spread ${measure.withinTaskStd.toFixed(3)}  ${measure.passRate >= 1 ? 'above threshold' : 'below threshold'}`,
      );
      await trace.step(`${index + 1} of ${input.environments.length} environments complete`, (index + 1) / input.environments.length);
      await repo.updateInferenceModel(environment.environmentId, input.policy.model);
    } catch (error) {
      if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
      const message = error instanceof Error ? error.message : String(error);
      await trace.log(`${environment.slug}  failed: ${message}`, 'err');
      entries.push({
        environment_id: environment.environmentId,
        mean_reward: 0,
        pass_rate: 0,
        within_task_std: 0,
        saturated_fraction: 0,
        tasks_scored: 0,
        error: message,
      });
      await trace.step(`${index + 1} of ${input.environments.length} environments complete`, (index + 1) / input.environments.length);
    }
    await trace.setResult({ kind: input.kind, environments: entries });
  }

  const ok = entries.filter((entry) => !entry.error);
  const metrics = {
    mean_reward: ok.length ? round(ok.reduce((sum, entry) => sum + entry.mean_reward, 0) / ok.length) : null,
    above_threshold: ok.filter((entry) => entry.mean_reward >= DEFAULT_THRESHOLD).length,
    tasks_scored: ok.reduce((sum, entry) => sum + entry.tasks_scored, 0),
    within_task_std: ok.length ? round(ok.reduce((sum, entry) => sum + entry.within_task_std, 0) / ok.length) : null,
    saturated_fraction: ok.length ? round(ok.reduce((sum, entry) => sum + entry.saturated_fraction, 0) / ok.length) : null,
    trainable_signal: ok.filter((entry) => entry.within_task_std >= MIN_WITHIN_TASK_STD).length,
    evaluated_environments: ok.length,
    errored_environments: entries.length - ok.length,
    environments: entries,
  };
  await repo.insertEvaluation({
    benchmarkRunId: input.benchmarkRunId,
    kind: input.kind,
    model: input.policy.model,
    endpointLabel: labelOf(input.policy.baseUrl),
    rolloutsPerExample: input.rollouts,
    maxConcurrent: input.maxConcurrent,
    environmentIds: entries.map((entry) => entry.environment_id),
    metrics,
    resultPaths,
  });
  await audit.audit('environment_evaluations', input.benchmarkRunId, `eval:${input.kind}`, {
    benchmarkRunId: input.benchmarkRunId,
    kind: input.kind,
    meanReward: metrics.mean_reward,
    environments: entries.length,
  });

  if (input.kind === 'validation') {
    await trace.step('applying the learnability gate', 0.95);
    let unlocked = 0;
    for (const entry of ok) {
      const learnable =
        entry.mean_reward >= DEFAULT_THRESHOLD &&
        entry.within_task_std >= MIN_WITHIN_TASK_STD &&
        entry.saturated_fraction <= MAX_SATURATED_FRACTION;
      if (!learnable) continue;
      const environment = input.environments.find((candidate) => candidate.environmentId === entry.environment_id);
      if (!environment || environment.scaleReady) continue;
      await repo.markScaleReady(entry.environment_id, '');
      unlocked += 1;
    }
    await trace.log(`learnability gate      ${unlocked} environment${unlocked === 1 ? '' : 's'} unlocked`);
  }
  const errorSuffix = metrics.errored_environments
    ? ` with ${metrics.errored_environments} environment${metrics.errored_environments === 1 ? '' : 's'} errored`
    : '';
  await trace.succeed(
    {
      environments: entries.length,
      evaluatedEnvironments: metrics.evaluated_environments,
      erroredEnvironments: metrics.errored_environments,
      meanReward: metrics.mean_reward,
    },
    `Local proof complete${errorSuffix}`,
  );
}

/** Aggregates rollouts into the learnability measures. Pure — unit-tested. */
export function measureOf(rollouts: Array<{ exampleId: number; reward: number }>): {
  passRate: number;
  withinTaskStd: number;
  saturatedFraction: number;
  tasksScored: number;
} {
  const byExample = new Map<number, number[]>();
  for (const rollout of rollouts) {
    const list = byExample.get(rollout.exampleId) ?? [];
    list.push(rollout.reward);
    byExample.set(rollout.exampleId, list);
  }
  if (!byExample.size) {
    return { passRate: 0, withinTaskStd: 0, saturatedFraction: 0, tasksScored: 0 };
  }
  const exampleMeans = [...byExample.values()].map((rewards) => mean(rewards));
  const exampleStds = [...byExample.values()].map((rewards) => std(rewards));
  return {
    passRate: exampleMeans.filter((value) => value >= DEFAULT_THRESHOLD).length / byExample.size,
    withinTaskStd: mean(exampleStds),
    saturatedFraction: exampleMeans.filter((value) => value >= 0.99).length / byExample.size,
    tasksScored: byExample.size,
  };
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
};
const round = (value: number) => Math.round(value * 1000) / 1000;

const labelOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

// --- cluster handoff ---------------------------------------------------------

/** Writes cluster.toml next to each scale-ready package and persists it. */
export async function prepareCluster(
  benchmarkRunId: number,
  environmentCode?: string,
): Promise<{ prepared: number }> {
  if (!Number.isInteger(benchmarkRunId) || benchmarkRunId < 1) throw new EnvironmentError('Select a benchmark run.');
  const context = await repo.runContext(benchmarkRunId);
  if (!context) throw new EnvironmentError('Benchmark run not found.');
  const environments = await repo.listByBenchmarkRun(benchmarkRunId);

  let targets = environments.filter((environment) => environment.scaleReady && environment.localPath);
  if (environmentCode) {
    const parsed = await repo.environmentByCode(environmentCode);
    if (!parsed) throw new EnvironmentError('Select a valid environment.');
    targets = targets.filter((environment) => environment.environmentId === parsed.environmentId);
  }
  if (!targets.length) {
    throw new EnvironmentError('No scale-ready environments — pass local validation first.');
  }

  const judge = await settings.judgeProvider();
  let prepared = 0;
  for (const environment of targets) {
    const spec = await specFromEnvironment(environment, benchmarkRunId);
    const toml = clusterToml(spec, environment.inferenceModel || judge.model, judge.model, CLUSTER_ROLLOUTS);
    await writeFile(resolve(environment.localPath!, 'cluster.toml'), toml, 'utf8');
    await repo.markScaleReady(environment.environmentId, toml);
    prepared += 1;
  }
  await audit.audit('environments', benchmarkRunId, 'prepare_cluster', {
    benchmarkRunId,
    prepared,
    environmentCode: environmentCode ?? null,
  });
  return { prepared };
}

/** Rebuilds the package spec from stored state — the files are the artifact. */
async function specFromEnvironment(
  environment: EnvironmentRow,
  benchmarkRunId: number,
): Promise<PiPackageSpec> {
  const inputs = await repo.buildInputs(benchmarkRunId);
  const entry = inputs.find((candidate) => candidate.topic.topicId === environment.topicId);
  return packageSpec(
    environment.slug,
    entry?.topic ?? {
      topicId: environment.topicId,
      topicCode: environment.topicCode,
      name: environment.topicName,
      description: environment.topicDescription,
      verifierStrategy: environment.verifierStrategy,
    },
    entry?.documents ?? [],
  );
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = Number.isFinite(value) ? Math.trunc(value!) : fallback;
  return Math.min(max, Math.max(min, candidate));
}
