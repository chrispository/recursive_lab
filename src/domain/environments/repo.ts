/**
 * SQL for environments. Writes happen here too — the service orchestrates,
 * this file owns every query touching environments/verifiers/evaluations.
 */
import { all, insert, json, one, now, run, type Row } from '../../db/client.ts';
import { code, parse } from '../../db/ids.ts';
import type {
  BuildDocument,
  BuildTopic,
  EnvironmentMeasure,
  EnvironmentRow,
  EvaluationMetrics,
  EvaluationSummary,
} from './model.ts';

type EnvironmentDb = Row & {
  id: number;
  topic_id: number;
  topic_name: string;
  topic_description: string;
  verifier_strategy: string;
  slug: string;
  status: EnvironmentRow['status'];
  base_model: string;
  inference_model: string;
  verifier_name: string;
  pass_threshold: number;
  local_path: string | null;
  scale_ready: number;
  train: number;
  canary: number;
  heldout: number;
};

export async function listByBenchmarkRun(benchmarkRunId: number): Promise<EnvironmentRow[]> {
  const rows = await all<EnvironmentDb>(
    `SELECT e.id, e.topic_id, tp.name AS topic_name, tp.description AS topic_description,
            tp.verifier_strategy, e.slug, e.status, e.base_model, e.inference_model,
            v.name AS verifier_name, v.pass_threshold, e.local_path, e.scale_ready,
            (SELECT count(*) FROM environment_documents ed
              JOIN documents d ON d.id = ed.document_id
              WHERE ed.environment_id = e.id AND ed.role = 'train') AS train,
            (SELECT count(*) FROM environment_documents ed
              JOIN documents d ON d.id = ed.document_id
              WHERE ed.environment_id = e.id AND ed.role = 'canary') AS canary,
            (SELECT count(*) FROM environment_documents ed
              JOIN documents d ON d.id = ed.document_id
              WHERE ed.environment_id = e.id AND ed.role = 'heldout') AS heldout
       FROM environments e
       JOIN topics tp ON tp.id = e.topic_id
       JOIN verifiers v ON v.id = e.verifier_id
      WHERE e.benchmark_run_id = ?
      ORDER BY e.id ASC`,
    [benchmarkRunId],
  );

  const measures = await measuresByBenchmarkRun(benchmarkRunId);
  return rows.map((row) => {
    const train = Number(row.train);
    const canary = Number(row.canary);
    const heldout = Number(row.heldout);
    return {
      environmentId: row.id,
      topicId: row.topic_id,
      topicName: row.topic_name,
      topicCode: code('topics', row.topic_id),
      topicDescription: row.topic_description,
      verifierStrategy: row.verifier_strategy,
      slug: row.slug,
      status: row.status,
      baseModel: row.base_model,
      inferenceModel: row.inference_model,
      verifierName: row.verifier_name,
      passThreshold: Number(row.pass_threshold),
      localPath: row.local_path,
      scaleReady: row.scale_ready === 1,
      taskCounts: { tasks: train + canary + heldout, train, canary, heldout },
      rlTest: measures.rl_test.get(row.id) ?? null,
      validation: measures.validation.get(row.id) ?? null,
    };
  });
}

/** Latest measure per environment, per kind, from the two newest evaluations. */
async function measuresByBenchmarkRun(benchmarkRunId: number) {
  const result: { rl_test: Map<number, EnvironmentMeasure>; validation: Map<number, EnvironmentMeasure> } = {
    rl_test: new Map(),
    validation: new Map(),
  };
  for (const kind of ['rl_test', 'validation'] as const) {
    const evaluation = await one<Row & { metrics_json: string }>(
      `SELECT metrics_json FROM environment_evaluations
       WHERE benchmark_run_id = ? AND kind = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [benchmarkRunId, kind],
    );
    if (!evaluation) continue;
    const metrics = json<EvaluationMetrics>(evaluation.metrics_json, {});
    for (const entry of metrics.environments ?? []) {
      result[kind].set(entry.environment_id, {
        meanReward: entry.mean_reward,
        passRate: entry.pass_rate,
        withinTaskStd: entry.within_task_std,
        saturatedFraction: entry.saturated_fraction,
        tasksScored: entry.tasks_scored,
        rolloutsPerExample: 0,
      });
    }
  }
  return result;
}

export async function latestEvaluation(benchmarkRunId: number): Promise<EvaluationSummary | null> {
  return evaluationOf(benchmarkRunId, undefined);
}

export async function latestEvaluationOfKind(
  benchmarkRunId: number,
  kind: EvaluationSummary['kind'],
): Promise<EvaluationSummary | null> {
  return evaluationOf(benchmarkRunId, kind);
}

async function evaluationOf(
  benchmarkRunId: number,
  kind: EvaluationSummary['kind'] | undefined,
): Promise<EvaluationSummary | null> {
  const row = await one<Row & {
    id: number;
    kind: EvaluationSummary['kind'];
    model: string;
    endpoint_label: string;
    rollouts_per_example: number;
    max_concurrent: number;
    metrics_json: string;
  }>(
    `SELECT id, kind, model, endpoint_label, rollouts_per_example, max_concurrent, metrics_json
       FROM environment_evaluations
      WHERE benchmark_run_id = ? ${kind ? 'AND kind = ?' : ''}
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    kind ? [benchmarkRunId, kind] : [benchmarkRunId],
  );
  if (!row) return null;
  const metrics = json<EvaluationMetrics>(row.metrics_json, {});
  return {
    evaluationId: row.id,
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

// --- writes -----------------------------------------------------------------

export type BuildInput = { topic: BuildTopic; documents: BuildDocument[] };

/** Topics with their approved forge documents, in topic order. */
export async function buildInputs(benchmarkRunId: number): Promise<BuildInput[]> {
  const rows = await all<Row & {
    topic_id: number;
    name: string;
    description: string;
    verifier_strategy: string;
    document_id: number;
    doc_topic_id: number | null;
    role: BuildDocument['role'];
    title: string;
    content: string;
    task_instruction: string;
    reference_answer: string;
    verifier_targets_json: string;
  }>(
    `SELECT tp.id AS topic_id, tp.name, tp.description, tp.verifier_strategy,
            d.id AS document_id, d.topic_id AS doc_topic_id, d.role, d.title,
            d.content, d.task_instruction, d.reference_answer, d.verifier_targets_json
       FROM topics tp
       JOIN failure_maps fm ON fm.id = tp.failure_map_id
       JOIN benchmark_results brs ON brs.id = fm.benchmark_result_id
       JOIN documents d ON d.topic_id = tp.id AND d.review_status = 'approved'
                      AND d.role IN ('train','canary','heldout')
      WHERE brs.benchmark_run_id = ?
      ORDER BY tp.id, d.id`,
    [benchmarkRunId],
  );
  const inputs: BuildInput[] = [];
  for (const row of rows) {
    let input = inputs.find((candidate) => candidate.topic.topicId === row.topic_id);
    if (!input) {
      input = {
        topic: {
          topicId: row.topic_id,
          topicCode: code('topics', row.topic_id),
          name: row.name,
          description: row.description,
          verifierStrategy: row.verifier_strategy,
        },
        documents: [],
      };
      inputs.push(input);
    }
    input.documents.push({
      documentId: row.document_id,
      topicId: row.doc_topic_id ?? row.topic_id,
      role: row.role,
      title: row.title,
      content: row.content,
      taskInstruction: row.task_instruction,
      referenceAnswer: row.reference_answer,
      verifierTargets: json<string[]>(row.verifier_targets_json, []),
    });
  }
  return inputs;
}

/** The run's display code and model, for package paths and lineage. */
export async function runContext(benchmarkRunId: number): Promise<{ benchmarkRunCode: string; model: string } | null> {
  const row = await one<Row & { code: string; model: string }>(
    `SELECT code, model FROM benchmark_runs WHERE id = ?`,
    [benchmarkRunId],
  );
  if (!row) return null;
  return { benchmarkRunCode: row.code, model: row.model };
}

export async function verifierIdByTopic(topicId: number, name: string): Promise<number | null> {
  const row = await one<Row & { id: number }>(
    `SELECT id FROM verifiers WHERE topic_id = ? AND name = ? ORDER BY version DESC LIMIT 1`,
    [topicId, name],
  );
  return row?.id ?? null;
}

export async function insertVerifier(topic: BuildTopic, threshold: number): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO verifiers (topic_id, name, version, kind, status, description, rubric_json, pass_threshold, created_at, updated_at)
     VALUES (?, ?, 1, 'llm', 'ready', ?, ?, ?, ?, ?)`,
    [
      topic.topicId,
      `Judge coverage · ${topic.name}`,
      topic.verifierStrategy,
      JSON.stringify({ strategy: topic.verifierStrategy, targets: 'per-document verifier_targets', mode: 'judge_coverage' }),
      threshold,
      at,
      at,
    ],
  );
}

export async function environmentIdBySlug(slug: string): Promise<number | null> {
  const row = await one<Row & { id: number }>(`SELECT id FROM environments WHERE slug = ?`, [slug]);
  return row?.id ?? null;
}

export async function insertEnvironment(input: {
  benchmarkRunId: number;
  topicId: number;
  verifierId: number;
  name: string;
  slug: string;
  baseModel: string;
}): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO environments
       (benchmark_run_id, topic_id, verifier_id, name, slug, status, base_model, inference_model,
        harness, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'built', ?, ?, 'pi_verifiers', ?, ?)`,
    [input.benchmarkRunId, input.topicId, input.verifierId, input.name, input.slug, input.baseModel, '', at, at],
  );
}

export async function markBuilt(
  environmentId: number,
  patch: { localPath: string; packageHash: string; inferenceModel: string },
): Promise<void> {
  await run(
    `UPDATE environments SET local_path = ?, package_hash = ?, inference_model = ?, updated_at = ? WHERE id = ?`,
    [patch.localPath, patch.packageHash, patch.inferenceModel, now(), environmentId],
  );
}

export async function markFailed(environmentId: number): Promise<void> {
  await run(`UPDATE environments SET status = 'failed', updated_at = ? WHERE id = ?`, [now(), environmentId]);
}

export async function attachDocument(
  environmentId: number,
  documentId: number,
  role: BuildDocument['role'],
): Promise<void> {
  await run(
    `INSERT OR IGNORE INTO environment_documents (environment_id, document_id, role) VALUES (?, ?, ?)`,
    [environmentId, documentId, role],
  );
}

export async function insertEvaluation(input: {
  benchmarkRunId: number;
  kind: EvaluationSummary['kind'];
  model: string;
  endpointLabel: string;
  rolloutsPerExample: number;
  maxConcurrent: number;
  environmentIds: number[];
  metrics: EvaluationMetrics;
  resultPaths: Record<string, string>;
}): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO environment_evaluations
       (benchmark_run_id, kind, model, endpoint_label, rollouts_per_example, max_concurrent,
        environment_ids_json, metrics_json, result_paths_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.benchmarkRunId,
      input.kind,
      input.model,
      input.endpointLabel,
      input.rolloutsPerExample,
      input.maxConcurrent,
      JSON.stringify(input.environmentIds),
      JSON.stringify(input.metrics),
      JSON.stringify(input.resultPaths),
      at,
      at,
    ],
  );
}

export async function markScaleReady(environmentId: number, trainingToml: string): Promise<void> {
  await run(
    `UPDATE environments SET scale_ready = 1, scale_ready_at = ?, training_toml = ?, updated_at = ? WHERE id = ?`,
    [now(), trainingToml, now(), environmentId],
  );
}

export async function updateInferenceModel(environmentId: number, model: string): Promise<void> {
  await run(`UPDATE environments SET inference_model = ?, updated_at = ? WHERE id = ?`, [model, now(), environmentId]);
}

export async function environmentByCode(
  environmentCode: string,
): Promise<{ environmentId: number; benchmarkRunId: number; slug: string; scaleReady: boolean } | null> {
  const parsed = parse(environmentCode);
  if (!parsed || parsed.entity !== 'environments') return null;
  const row = await one<Row & { id: number; benchmark_run_id: number; slug: string; scale_ready: number }>(
    `SELECT id, benchmark_run_id, slug, scale_ready FROM environments WHERE id = ?`,
    [parsed.id],
  );
  if (!row) return null;
  return {
    environmentId: row.id,
    benchmarkRunId: row.benchmark_run_id,
    slug: row.slug,
    scaleReady: row.scale_ready === 1,
  };
}
