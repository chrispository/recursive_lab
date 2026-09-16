/**
 * Env lab orchestration: package the run's topics as PI environments and prove
 * them locally with `prime eval`. Cluster handoff preparation lives on the
 * following page but remains coordinated by this domain service.
 *
 * Stages mirror the page: Build (packages) → RL test (rewards at expected
 * level) → Validation (learnability gate unlocks scale) → Prepare cluster
 * (immutable taskset + prime-rl TOML). No schema beyond the existing tables.
 */
import { resolve } from 'node:path';
import { benchmarkRunDir } from '../../config.ts';
import * as audit from '../audit/service.ts';
import * as jobRows from '../jobs/service.ts';
import { isLive } from '../jobs/model.ts';
import * as jobTrace from '../jobs/trace.ts';
import * as settings from '../../gym/settings.ts';
import {
  piInstalled,
  runEval,
  writePackage,
} from '../../gym/pi.ts';
import * as repo from './repo.ts';
import { hashFiles, verifiedPackage } from '../../gym/pi-artifact.ts';
import { prepareTrainingExport, verifyTrainingExport } from '../../gym/pi-training.ts';
import { packageSpec, trainingReady, MIN_REWARD_SPREAD, TRAINING_ROLLOUTS } from './model.ts';
import { evaluationEnvironmentOf, labelOf, measureOf, mean, round, type BuildTopic, type EnvironmentRow, type EvaluationMetrics, type EvaluationEnvironmentInput } from './model.ts';

export type { EnvironmentRow, EvaluationSummary } from './model.ts';
export const listByBenchmarkRun = repo.listByBenchmarkRun;
export const latestEvaluation = repo.latestEvaluation;
export const latestEvaluationOfKind = repo.latestEvaluationOfKind;

export class EnvironmentError extends Error {}

const DEFAULT_THRESHOLD = 0.3;
/** The learnability gate: spread must exist and saturation must not swallow it. */
const MIN_WITHIN_TASK_STD = MIN_REWARD_SPREAD;
/** The cluster always trains on 4 rollouts per example; local may differ. */
export const CLUSTER_ROLLOUTS = TRAINING_ROLLOUTS;
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
    .find((job) => (job.kind === 'env_build' || job.kind === 'env_eval') && isLive(job));
  if (existingJob) throw new EnvironmentError('An environment build is already running for this benchmark run.');

  await repo.clearReadiness(benchmarkRunId);
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
    const environmentDir = resolve(dir, slug, 'revisions', trace.jobCode);
    const verifierId = await ensureVerifier(entry.topic);
    const environmentId = await repo.environmentIdBySlug(slug) ?? await repo.insertEnvironment({
      benchmarkRunId: input.benchmarkRunId,
      topicId: entry.topic.topicId,
      verifierId,
      name: entry.topic.name,
      slug,
      baseModel: input.model,
    });
    const files = await writePackage(environmentDir, spec);
    const packageHash = await hashFiles(files);
    await repo.markBuilt(environmentId, {
      localPath: environmentDir,
      packageHash,
      inferenceModel: '',
    }, entry.documents);
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
  if (built.some((env) => env.packageVersion !== 2)) throw new EnvironmentError('Rebuild packages to update the grader before running new checks. Old files and results are preserved.');

  const liveJob = (await jobRows.listByBenchmarkRun(input.benchmarkRunId))
    .find((job) => (job.kind === 'env_eval' || job.kind === 'env_build') && isLive(job));
  if (liveJob) throw new EnvironmentError('A local proof run is already in progress for this benchmark run.');

  const policy = await settings.policyProvider(input.model ?? '');
  if (!policy.apiKey) throw new EnvironmentError('Configure a policy API key in Settings first.');
  if (!policy.model) throw new EnvironmentError('Configure a policy model in Settings first.');
  const judge = await settings.judgeProvider();
  if (!judge.apiKey || !judge.model) throw new EnvironmentError('Configure a judge API key and model in Settings first.');

  if (input.kind === 'validation') {
    const smoke = await repo.latestEvaluationOfKind(input.benchmarkRunId, 'rl_test');
    if (!smoke || smoke.erroredEnvironments || smoke.model !== policy.model || smoke.endpointLabel !== labelOf(policy.baseUrl)
      || smoke.judgeModel !== judge.model || smoke.judgeEndpointLabel !== labelOf(judge.baseUrl)
      || built.some((env) => !env.rlTest || env.rlTest.error || env.rlTest.tasksScored !== env.taskCounts.tasks
        || env.rlTest.evidence?.packageHash !== env.packageHash)) {
      throw new EnvironmentError('Run the execution check with the current policy and judge before checking training signal.');
    }
  }
  for (const environment of built) await verifiedPackage(environment.localPath!, environment.slug, environment.packageHash);
  await repo.clearReadiness(input.benchmarkRunId);

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
  const evaluationEnvironments: EvaluationEnvironmentInput[] = [];

  for (const [index, environment] of input.environments.entries()) {
    if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
    await trace.step(`${index} of ${input.environments.length} environments complete`, index / input.environments.length);
    const splits = (['train', 'canary', 'heldout'] as const).filter((split) => environment.taskCounts[split] > 0);
    const rollouts: Array<{ exampleId: number; reward: number }> = [];
    let exampleOffset = 0;
    let currentSplit: 'train' | 'canary' | 'heldout' | null = null;
    try {
      if (!splits.length) throw new Error('No taskset examples are available to score.');
      for (const split of splits) {
        currentSplit = split;
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
        resultPaths[`${environment.slug}:${split}`] = outcome.resultsPath;
        const splitRewards = outcome.rollouts.flatMap((rollout) =>
          rollout.reward === null ? [] : [{ exampleId: rollout.exampleId, reward: rollout.reward }],
        );
        const counts = new Map<number, number>();
        for (const rollout of outcome.rollouts) counts.set(rollout.exampleId, (counts.get(rollout.exampleId) ?? 0) + 1);
        if (splitRewards.length !== environment.taskCounts[split] * input.rollouts
          || counts.size !== environment.taskCounts[split] || [...counts.values()].some((count) => count !== input.rollouts)) {
          throw new Error(`${split}: incomplete rollout coverage; rerun the check.`);
        }
        const splitMeasure = measureOf(splitRewards);
        evaluationEnvironments.push(evaluationEnvironmentOf({
          environmentId: environment.environmentId,
          split,
          taskCount: environment.taskCounts[split],
          rolloutsPerExample: input.rollouts,
          outcome,
          measure: splitMeasure,
          threshold: DEFAULT_THRESHOLD,
        }));
        const rolloutError = outcome.rollouts.find((rollout) => rollout.error);
        if (rolloutError?.error) throw new Error(`${split} rollout ${rolloutError.exampleId} failed: ${rolloutError.error}`);
        rollouts.push(...splitRewards.map((rollout) => ({
          exampleId: exampleOffset + rollout.exampleId,
          reward: rollout.reward,
        })));
        exampleOffset += environment.taskCounts[split];
      }
      await verifiedPackage(environment.localPath!, environment.slug, environment.packageHash);
      const measure = measureOf(rollouts);
      const avgReward = mean(rollouts.map((rollout) => rollout.reward));
      entries.push({
        environment_id: environment.environmentId,
        package_hash: environment.packageHash,
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
      const failedSplit = currentSplit ?? splits[0] ?? 'train';
      if (!evaluationEnvironments.some((entry) => entry.environmentId === environment.environmentId && entry.split === failedSplit)) {
        evaluationEnvironments.push({
          environmentId: environment.environmentId,
          split: failedSplit,
          taskCount: environment.taskCounts[failedSplit],
          rolloutsPerExample: input.rollouts,
          meanReward: null,
          passRate: null,
          withinTaskStd: null,
          saturatedFraction: null,
          tasksScored: 0,
          error: message,
          resultPath: null,
          metrics: {},
          rollouts: [],
        });
      }
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
  if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
  const evaluationId = await repo.insertEvaluation({
    benchmarkRunId: input.benchmarkRunId,
    jobId: trace.jobId,
    kind: input.kind,
    model: input.policy.model,
    endpointLabel: labelOf(input.policy.baseUrl),
    judgeModel: input.judge.model,
    judgeEndpointLabel: labelOf(input.judge.baseUrl),
    rolloutsPerExample: input.rollouts,
    maxConcurrent: input.maxConcurrent,
    environmentIds: entries.map((entry) => entry.environment_id),
    metrics,
    resultPaths,
    environments: evaluationEnvironments,
  });
  await audit.audit('environment_evaluations', evaluationId, `eval:${input.kind}`, {
    evaluationId,
    benchmarkRunId: input.benchmarkRunId,
    jobId: trace.jobId,
    kind: input.kind,
    meanReward: metrics.mean_reward,
    environments: entries.length,
  });

  if (input.kind === 'validation') {
    await trace.step('applying the learnability gate', 0.95);
    let unlocked = 0;
    for (const entry of ok) {
      if ((await jobRows.get(trace.jobId))?.status === 'cancelled') return;
      const environment = input.environments.find((candidate) => candidate.environmentId === entry.environment_id);
      if (!environment || !trainingReady({ meanReward: entry.mean_reward, passRate: entry.pass_rate,
        withinTaskStd: entry.within_task_std, saturatedFraction: entry.saturated_fraction,
        tasksScored: entry.tasks_scored, rolloutsPerExample: input.rollouts, error: null,
        evidence: { evaluationId, packageHash: entry.package_hash ?? '', model: input.policy.model,
          endpointLabel: labelOf(input.policy.baseUrl), judgeModel: input.judge.model, judgeEndpointLabel: labelOf(input.judge.baseUrl) },
      }, environment.passThreshold, environment.taskCounts.tasks, environment.packageHash)) continue;
      unlocked += await repo.markScaleReady(entry.environment_id, '', evaluationId, environment.packageHash);
    }
    await trace.log(`learnability gate      ${unlocked} environment${unlocked === 1 ? '' : 's'} unlocked`);
  }
  const errorSuffix = metrics.errored_environments
    ? ` with ${metrics.errored_environments} environment${metrics.errored_environments === 1 ? '' : 's'} errored`
    : '';
  await trace.succeed(
    {
      environments: entries.length,
      evaluationId,
      evaluatedEnvironments: metrics.evaluated_environments,
      erroredEnvironments: metrics.errored_environments,
      meanReward: metrics.mean_reward,
    },
    `Local proof complete${errorSuffix}`,
  );
}

// --- cluster handoff ---------------------------------------------------------

/** Export only verified package bytes and the validation that approved them. */
export async function prepareCluster(benchmarkRunId: number, environmentCode?: string, trainingModel = '', checkpointConfirmed = false): Promise<{ prepared: number }> {
  if (!Number.isInteger(benchmarkRunId) || benchmarkRunId < 1) throw new EnvironmentError('Select a benchmark run.');
  if (!trainingModel.trim() || !checkpointConfirmed) throw new EnvironmentError('Enter the trainable checkpoint and confirm it is the policy you validated.');
  const live = (await jobRows.listByBenchmarkRun(benchmarkRunId)).some((job) => isLive(job) && ['env_eval', 'env_build'].includes(job.kind));
  if (live) throw new EnvironmentError('Wait for the current environment check to finish before exporting.');
  const targets = (await repo.listByBenchmarkRun(benchmarkRunId)).filter((env) => env.scaleReady && env.localPath && (!environmentCode || env.environmentCode === environmentCode));
  if (!targets.length) throw new EnvironmentError('No environments have a current passing validation. Check training signal first.');
  let prepared = 0;
  for (const environment of targets) {
    const toml = await prepareTrainingExport(environment, trainingModel.trim());
    if (!await repo.markScaleReady(environment.environmentId, toml, environment.validation!.evidence!.evaluationId, environment.packageHash)) {
      throw new EnvironmentError('Readiness changed during export. Finish the current check before preparing again.');
    }
    prepared++;
  }
  await audit.audit('environments', benchmarkRunId, 'prepare_cluster', { benchmarkRunId, prepared, trainingModel });
  return { prepared };
}

export async function trainingDownload(environmentCode: string) {
  const identity = await repo.environmentByCode(environmentCode);
  if (!identity) throw new EnvironmentError('Environment not found.');
  const environment = (await repo.listByBenchmarkRun(identity.benchmarkRunId)).find((env) => env.environmentCode === environmentCode);
  if (!environment?.clusterPrepared) throw new EnvironmentError('Prepare a training package from a current passing validation first.');
  await verifiedPackage(environment.localPath!, environment.slug, environment.packageHash);
  return verifyTrainingExport(environment);
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = Number.isFinite(value) ? Math.trunc(value!) : fallback;
  return Math.min(max, Math.max(min, candidate));
}
