/**
 * Environment shapes shared by repos, services, and views.
 *
 * An environment is one topic + one verifier packaged as a Prime Intellect
 * `verifiers` package: taskset splits written from approved forge documents,
 * judge-coverage scoring, and a pass floor. Views render these types only —
 * see AGENTS.md § Domains.
 */
import type { PiTask } from '../../gym/pi.ts';

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
  kind: 'rl_test' | 'validation';
  model: string;
  endpointLabel: string;
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
  },
});
