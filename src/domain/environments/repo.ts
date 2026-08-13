import { all, json, one, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { EnvironmentRow, EvaluationSummary } from './model.ts';

type EnvironmentDb = Row & {
  id: number;
  topic_id: number;
  topic_name: string;
  status: EnvironmentRow['status'];
  base_model: string;
  inference_model: string;
  verifier_name: string;
  pass_threshold: number;
  local_path: string | null;
  scale_ready: number;
};

type EvaluationDb = Row & {
  id: number;
  kind: EvaluationSummary['kind'];
  model: string;
  endpoint_label: string;
  rollouts_per_example: number;
  max_concurrent: number;
  metrics_json: string;
};

export async function listByBenchmarkRun(benchmarkRunId: number): Promise<EnvironmentRow[]> {
  const rows = await all<EnvironmentDb>(
    `SELECT e.id, e.topic_id, tp.name AS topic_name, e.status, e.base_model,
            e.inference_model, v.name AS verifier_name, v.pass_threshold,
            e.local_path, e.scale_ready
       FROM environments e
       JOIN topics tp ON tp.id = e.topic_id
       JOIN verifiers v ON v.id = e.verifier_id
      WHERE e.benchmark_run_id = ?
      ORDER BY e.id ASC`,
    [benchmarkRunId],
  );
  return rows.map((row) => ({
    environmentCode: code('environments', row.id),
    topicName: row.topic_name,
    topicCode: code('topics', row.topic_id),
    status: row.status,
    baseModel: row.base_model,
    inferenceModel: row.inference_model,
    verifierName: row.verifier_name,
    passThreshold: row.pass_threshold,
    localPath: row.local_path,
    scaleReady: row.scale_ready === 1,
  }));
}

export async function latestEvaluation(benchmarkRunId: number): Promise<EvaluationSummary | null> {
  const row = await one<EvaluationDb>(
    `SELECT id, kind, model, endpoint_label, rollouts_per_example, max_concurrent, metrics_json
       FROM environment_evaluations
      WHERE benchmark_run_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [benchmarkRunId],
  );
  if (!row) return null;
  const metrics = json<{
    mean_reward?: number;
    above_threshold?: number;
    tasks_scored?: number;
    within_task_std?: number;
    saturated_fraction?: number;
    trainable_signal?: number;
  }>(row.metrics_json, {});
  return {
    evaluationCode: code('environment_evaluations', row.id),
    kind: row.kind,
    model: row.model,
    endpointLabel: row.endpoint_label,
    rolloutsPerExample: row.rollouts_per_example,
    maxConcurrent: row.max_concurrent,
    meanReward: metrics.mean_reward ?? null,
    aboveThreshold: metrics.above_threshold ?? 0,
    tasksScored: metrics.tasks_scored ?? 0,
    withinTaskStd: metrics.within_task_std ?? null,
    saturatedFraction: metrics.saturated_fraction ?? null,
    trainableSignal: metrics.trainable_signal ?? null,
  };
}
