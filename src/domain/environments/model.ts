/**
 * Environment shapes shared by repos, services, and views.
 *
 * An environment is one topic + one verifier packaged as a Prime Intellect
 * `verifiers` package: taskset splits written from approved forge documents,
 * judge-coverage scoring, and a pass floor. Views render these types only —
 * see AGENTS.md § Domains.
 */
import type { PiEvalOutcome, PiTask } from '../../gym/pi.ts';

export type EnvironmentRow = {
  environmentId: number;
  environmentCode: string;
  topicId: number;
  topicName: string;
  topicCode: string;
  topicDescription: string;
  verifierStrategy: string;
  slug: string;
  status: 'draft' | 'built' | 'ready' | 'failed';
  baseModel: string;
  inferenceModel: string;
  verifierName: string;
  passThreshold: number;
  localPath: string | null;
  scaleReady: boolean;
  clusterPrepared: boolean;
  /** Documents attached per role — the card's Tasks/Train/Canary/Heldout spec. */
  taskCounts: { tasks: number; train: number; canary: number; heldout: number };
  rlTest: EnvironmentMeasure | null;
  validation: EnvironmentMeasure | null;
};

/** One environment's result in one evaluation. */
export type EnvironmentMeasure = {
  meanReward: number | null;
  /** Fraction of examples whose rollouts all clear the pass threshold. */
  passRate: number;
  /** Mean within-task std — reward spread across an example's rollouts. */
  withinTaskStd: number;
  /** Fraction of examples solved at ~1.0 on every rollout. */
  saturatedFraction: number;
  tasksScored: number;
  rolloutsPerExample: number;
  /** A failed subprocess is distinct from a genuine zero-reward result. */
  error: string | null;
};

export type EvaluationSummary = {
  evaluationId: number;
  evaluationCode: string;
  benchmarkRunId: number;
  jobId: number;
  kind: 'rl_test' | 'validation';
  model: string;
  endpointLabel: string;
  judgeModel: string;
  judgeEndpointLabel: string;
  createdAt: string;
  rolloutsPerExample: number;
  maxConcurrent: number;
  meanReward: number | null;
  aboveThreshold: number;
  tasksScored: number;
  withinTaskStd: number | null;
  saturatedFraction: number | null;
  trainableSignal: number | null;
  evaluatedEnvironments: number;
  erroredEnvironments: number;
};

export type EvaluationTargetInput = {
  targetIndex: number;
  targetText: string;
  score: number | null;
  verdict: 'pass' | 'fail' | 'error';
  judgeModel: string;
  error: string;
  details: Record<string, unknown>;
};

export type EvaluationRolloutInput = {
  documentId: number | null;
  exampleIndex: number;
  rolloutIndex: number;
  trialName: string;
  reward: number | null;
  outcome: 'passed' | 'failed' | 'error' | 'skipped';
  error: string;
  resultPath: string | null;
  agentInputTokens: number;
  agentOutputTokens: number;
  agentTurns: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeWallClockSeconds: number;
  metadata: Record<string, unknown>;
  targetScores: EvaluationTargetInput[];
};

export type EvaluationEnvironmentInput = {
  environmentId: number;
  split: 'train' | 'canary' | 'heldout';
  taskCount: number;
  rolloutsPerExample: number;
  meanReward: number | null;
  passRate: number | null;
  withinTaskStd: number | null;
  saturatedFraction: number | null;
  tasksScored: number;
  error: string;
  resultPath: string | null;
  metrics: Record<string, unknown>;
  rollouts: EvaluationRolloutInput[];
};

export function evaluationEnvironmentOf(input: {
  environmentId: number;
  split: EvaluationEnvironmentInput['split'];
  taskCount: number;
  rolloutsPerExample: number;
  outcome: PiEvalOutcome;
  measure: Pick<EnvironmentMeasure, 'passRate' | 'withinTaskStd' | 'saturatedFraction' | 'tasksScored'>;
  threshold: number;
}): EvaluationEnvironmentInput {
  const rewards = input.outcome.rollouts.flatMap((rollout) =>
    rollout.reward === null ? [] : [rollout.reward],
  );
  const firstError = input.outcome.rollouts.find((rollout) => rollout.error)?.error ?? '';
  return {
    environmentId: input.environmentId,
    split: input.split,
    taskCount: input.taskCount,
    rolloutsPerExample: input.rolloutsPerExample,
    meanReward: rewards.length ? rewards.reduce((sum, reward) => sum + reward, 0) / rewards.length : null,
    passRate: input.measure.tasksScored ? input.measure.passRate : null,
    withinTaskStd: input.measure.tasksScored ? input.measure.withinTaskStd : null,
    saturatedFraction: input.measure.tasksScored ? input.measure.saturatedFraction : null,
    tasksScored: input.measure.tasksScored,
    error: firstError,
    resultPath: input.outcome.resultsPath,
    metrics: {
      passAtK: input.outcome.passAtK,
      seconds: input.outcome.seconds,
      targetScoresPath: input.outcome.targetScoresPath,
    },
    rollouts: input.outcome.rollouts.map((rollout) => ({
      documentId: rollout.documentId,
      exampleIndex: rollout.exampleId,
      rolloutIndex: rollout.rolloutIndex,
      trialName: rollout.trialName,
      reward: rollout.reward,
      outcome: rollout.error
        ? 'error' as const
        : rollout.reward !== null && rollout.reward >= input.threshold
          ? 'passed' as const
          : 'failed' as const,
      error: rollout.error ?? '',
      resultPath: input.outcome.resultsPath,
      agentInputTokens: 0,
      agentOutputTokens: 0,
      agentTurns: 0,
      judgeInputTokens: 0,
      judgeOutputTokens: 0,
      judgeWallClockSeconds: 0,
      metadata: {
        targetScoresPath: input.outcome.targetScoresPath,
        seconds: input.outcome.seconds,
        passAtK: input.outcome.passAtK,
      },
      targetScores: rollout.targetScores,
    })),
  };
}

/** Stored metrics envelope, as written to environment_evaluations.metrics_json. */
export type EvaluationMetrics = {
  mean_reward?: number | null;
  above_threshold?: number;
  tasks_scored?: number;
  within_task_std?: number | null;
  saturated_fraction?: number | null;
  trainable_signal?: number;
  evaluated_environments?: number;
  errored_environments?: number;
  environments?: Array<{
    environment_id: number;
    mean_reward: number;
    pass_rate: number;
    within_task_std: number;
    saturated_fraction: number;
    tasks_scored: number;
    error?: string;
  }>;
};

/** What `build` needs to know about a topic before it can be packaged. */
export type BuildTopic = {
  topicId: number;
  topicCode: string;
  name: string;
  description: string;
  verifierStrategy: string;
};

export type BuildDocument = {
  documentId: number;
  topicId: number;
  role: 'train' | 'canary' | 'heldout';
  title: string;
  content: string;
  taskInstruction: string;
  referenceAnswer: string;
  verifierTargets: string[];
};

/** The taskset row a document becomes. */
export const taskOf = (document: BuildDocument, topicName: string): PiTask => ({
  question: `${document.content}\n\n---\n\n# Task\n\n${document.taskInstruction}`,
  answer: document.referenceAnswer,
  info: {
    verifier_targets: document.verifierTargets,
    title: document.title,
    topic: topicName,
    document_id: document.documentId,
  },
});

/** Pure evaluation calculations shared by local proof persistence and tests. */
export function measureOf(
  rollouts: Array<{ exampleId: number; reward: number }>,
  threshold = 0.3,
): Pick<EnvironmentMeasure, 'passRate' | 'withinTaskStd' | 'saturatedFraction' | 'tasksScored'> {
  const byExample = new Map<number, number[]>();
  for (const rollout of rollouts) {
    const list = byExample.get(rollout.exampleId) ?? [];
    list.push(rollout.reward);
    byExample.set(rollout.exampleId, list);
  }
  if (!byExample.size) return { passRate: 0, withinTaskStd: 0, saturatedFraction: 0, tasksScored: 0 };
  const exampleMeans = [...byExample.values()].map(mean);
  const exampleStds = [...byExample.values()].map(std);
  return {
    passRate: exampleMeans.filter((value) => value >= threshold).length / byExample.size,
    withinTaskStd: mean(exampleStds),
    saturatedFraction: exampleMeans.filter((value) => value >= 0.99).length / byExample.size,
    tasksScored: byExample.size,
  };
}

export const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
};
export const round = (value: number) => Math.round(value * 1000) / 1000;

export const labelOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};
