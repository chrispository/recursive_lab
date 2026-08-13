#!/usr/bin/env bun
/** Import one legacy recursive( ) run into the integer-key lab schema. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { resolve } from 'node:path';
import { config } from '../src/config.ts';
import { db, insert, now, value } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { code } from '../src/db/ids.ts';

const TASK_ID = 'trusts-estates-private-client__extract-distribution-requirements-from-trust-agreement';
const LEGACY_DB = resolve(config.gym.root, 'results/lab_dashboard/lab_dashboard.sqlite3');
const LEGACY_RUN_ID = 'BR-20260811-214922-3B1546';
type Row = Record<string, unknown>;
const legacy = new Database(LEGACY_DB, { readonly: true });
const rows = (sql: string, ...args: SQLQueryBindings[]) => legacy.query(sql).all(...args) as Row[];
const one = (sql: string, ...args: SQLQueryBindings[]) => legacy.query(sql).get(...args) as Row | null;
const text = (row: Row, key: string, fallback = '') => String(row[key] ?? fallback);
const nullableText = (row: Row, key: string) => (row[key] == null ? null : String(row[key]));
const integer = (row: Row, key: string, fallback = 0) => Number(row[key] ?? fallback);
const jsonText = (row: Row, key: string, fallback = '{}') => {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { JSON.parse(value); return value; } catch { return fallback; }
};
const parsedJson = (row: Row, key: string): Record<string, unknown> => {
  try { return JSON.parse(jsonText(row, key)) as Record<string, unknown>; } catch { return {}; }
};
const status = (value: string): 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' =>
  value === 'completed' ? 'succeeded' : value === 'cancelled' ? 'cancelled' : value === 'running' ? 'running' : value === 'queued' ? 'queued' : 'failed';
const audit = async (type: string, id: number, legacyId: string) => insert(
  `INSERT INTO audit_events (entity_type, entity_id, action, details_json, created_at)
   VALUES (?, ?, 'legacy_import', ?, ?)`,
  [type, id, JSON.stringify({ legacy_id: legacyId, legacy_run_id: LEGACY_RUN_ID, source: LEGACY_DB }), now()],
);
const job = async (kind: string, type: string, id: number, old: Row, step: string) => insert(
  `INSERT INTO jobs (kind, subject_type, subject_id, status, step, progress, exit_code,
                     created_at, started_at, finished_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [kind, type, id, status(text(old, 'status')), step, status(text(old, 'status')) === 'succeeded' || status(text(old, 'status')) === 'failed' ? 1 : 0,
    old.exit_code == null ? null : integer(old, 'exit_code'), text(old, 'created_at', now()), nullableText(old, 'started_at'), nullableText(old, 'finished_at')],
);

await migrate();
if (!legacy) throw new Error(`Legacy database is unavailable: ${LEGACY_DB}`);
const already = await value<number>(
  `SELECT count(*) FROM audit_events WHERE action = 'legacy_import'
    AND json_extract(details_json, '$.legacy_run_id') = ?`,
  [LEGACY_RUN_ID],
);
if (already) {
  console.log(`✓ legacy run ${LEGACY_RUN_ID} is already imported`);
  legacy.close();
  process.exit(0);
}
if ((await value<number>('SELECT count(*) FROM benchmark_runs')) ?? 0) {
  legacy.close();
  throw new Error('target database is not empty — run `bun run db:reset` before importing legacy data');
}

const oldRun = one('SELECT * FROM runs WHERE id = ?', LEGACY_RUN_ID);
const oldModel = one('SELECT * FROM models WHERE run_id = ?', LEGACY_RUN_ID);
const oldTask = one(
  `SELECT b.*, bt.dataset, bt.task_id, bt.name AS task_name, bt.source_path, bt.metadata_json AS task_metadata_json
     FROM benchmarks b JOIN benchmark_tasks bt ON bt.benchmark_id = b.id
    WHERE bt.task_id = ?`, TASK_ID,
);
if (!oldRun || !oldModel || !oldTask) {
  legacy.close();
  throw new Error(`could not find the requested legacy run/task in ${LEGACY_DB}`);
}
const oldAnalysis = one('SELECT * FROM analysis_jobs WHERE run_id = ?', LEGACY_RUN_ID);
const oldTaxonomy = one('SELECT * FROM topic_taxonomies WHERE run_id = ?', LEGACY_RUN_ID);
const oldBatch = oldAnalysis ? one('SELECT * FROM generation_batches WHERE analysis_job_id = ?', text(oldAnalysis, 'id')) : null;
if (!oldAnalysis || !oldTaxonomy || !oldBatch) {
  legacy.close();
  throw new Error('legacy run is missing its analysis, taxonomy, or forge lineage');
}
const oldFailures = rows('SELECT * FROM failure_modes WHERE run_id = ? ORDER BY created_at, id', LEGACY_RUN_ID);

const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const evaluationMetrics = (raw: Record<string, unknown>): Record<string, unknown> => {
  const environmentValue = raw.environments;
  const details = environmentValue && typeof environmentValue === 'object'
    ? Object.values(environmentValue as Record<string, unknown>).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  if (!details.length) return raw;

  const rewards = details.map((detail) => numberValue(detail.avg_reward)).filter((value): value is number => value !== null);
  const passed = details.map((detail) => detail.passed === true).filter(Boolean).length;
  const tasksScored = details.reduce((sum, detail) => sum + (numberValue(detail.total_tasks) ?? 0), 0);
  const signals = details.map((detail) => detail.signal).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object');
  const withinTaskStd = signals.map((signal) => numberValue(signal.within_task_std)).filter((value): value is number => value !== null);
  const signalTasks = signals.reduce((sum, signal) => sum + (numberValue(signal.tasks) ?? 0), 0);
  const saturatedTasks = signals.reduce((sum, signal) => sum + (numberValue(signal.tasks) ?? 0) * (numberValue(signal.saturated_fraction) ?? 0), 0);
  return {
    ...raw,
    mean_reward: numberValue(raw.mean_reward) ?? (rewards.length ? rewards.reduce((sum, value) => sum + value, 0) / rewards.length : null),
    above_threshold: numberValue(raw.above_threshold) ?? passed,
    tasks_scored: numberValue(raw.tasks_scored) ?? tasksScored,
    within_task_std: numberValue(raw.within_task_std) ?? (withinTaskStd.length ? Math.max(...withinTaskStd) : null),
    saturated_fraction: numberValue(raw.saturated_fraction) ?? (signalTasks ? saturatedTasks / signalTasks : null),
    trainable_signal: numberValue(raw.trainable_signal) ?? signals.filter((signal) => signal.learnable === true).length,
  };
};

await db.execute('BEGIN');
try {
  const benchmarkId = await insert(
    `INSERT INTO benchmarks (name, lab, source_url, source_kind, source_identifier, revision,
                             detected_format, adapter, status, runnable, snapshot_path, input_path,
                             description, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [text(oldTask, 'name'), text(oldTask, 'lab'), text(oldTask, 'source_url'), text(oldTask, 'source_kind'),
      text(oldTask, 'id'), text(oldTask, 'revision'), text(oldTask, 'detected_format'), text(oldTask, 'adapter'),
      text(oldTask, 'status', 'ready'), integer(oldTask, 'runnable'), nullableText(oldTask, 'snapshot_path'),
      nullableText(oldTask, 'input_path'), text(oldTask, 'description'), jsonText(oldTask, 'metadata_json'),
      text(oldRun, 'started_at'), text(oldRun, 'finished_at', text(oldRun, 'started_at'))],
  );
  await insert(
    `INSERT INTO benchmark_tasks (benchmark_id, dataset, task_id, name, source_path, position, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [benchmarkId, text(oldTask, 'dataset', 'validation'), TASK_ID, text(oldTask, 'task_name'),
      text(oldTask, 'source_path'), integer(oldTask, 'position'), jsonText(oldTask, 'task_metadata_json')],
  );
  for (const source of rows('SELECT * FROM benchmark_sources WHERE task_id = ?', TASK_ID)) {
    await insert(
      `INSERT INTO benchmark_sources (task_id, relative_path, content_sha256, normalized_sha256,
                                      word_count, shingles_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [TASK_ID, text(source, 'relative_path'), text(source, 'content_sha256'), text(source, 'normalized_sha256'),
        integer(source, 'word_count'), jsonText(source, 'shingles_json'), text(source, 'indexed_at')],
    );
  }

  const oldTemplates = rows('SELECT * FROM prompt_templates ORDER BY prompt_key');
  const promptTemplates = new Map<string, number>();
  const promptRevisions = new Map<string, number>();
  for (const template of oldTemplates) {
    const id = await insert(
      `INSERT INTO prompt_templates (prompt_key, name, purpose, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [text(template, 'prompt_key'), text(template, 'name'), text(template, 'purpose'), text(template, 'description'),
        text(template, 'created_at'), text(template, 'updated_at')],
    );
    promptTemplates.set(text(template, 'id'), id);
  }
  for (const revision of rows('SELECT * FROM prompt_revisions ORDER BY template_id, revision_number')) {
    const templateId = promptTemplates.get(text(revision, 'template_id'));
    if (!templateId) continue;
    const template = oldTemplates.find((item) => text(item, 'id') === text(revision, 'template_id'));
    const id = await insert(
      `INSERT INTO prompt_revisions (template_id, revision_number, body, model_hint, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [templateId, integer(revision, 'revision_number'), text(revision, 'body'), text(revision, 'model_hint'),
        template && text(template, 'active_revision_id') === text(revision, 'id') ? 1 : 0, text(revision, 'created_at')],
    );
    promptRevisions.set(text(revision, 'id'), id);
  }

  const oldMetrics = parsedJson(oldModel, 'metrics_json');
  const oldPassRate = oldMetrics.pass_rate;
  const diagnosticPassRate = numberValue(oldMetrics.diagnostic_pass_rate);
  const failedCriteria = oldFailures.length;
  const criteriaTotal = diagnosticPassRate !== null && diagnosticPassRate < 1
    ? Math.round(failedCriteria / (1 - diagnosticPassRate))
    : null;
  const metrics = {
    ...oldMetrics,
    criteria_total: criteriaTotal,
    criteria_passed: criteriaTotal === null ? null : criteriaTotal - failedCriteria,
    criteria_failed: failedCriteria,
    full_task_pass_rate: oldPassRate ?? null,
    pass_rate: oldMetrics.diagnostic_pass_rate ?? oldPassRate ?? null,
  };
  const oldSettings = parsedJson(oldRun, 'settings_json');
  const settings = Object.fromEntries(Object.entries(oldSettings).filter(([key]) => !key.includes('api_key')));
  const taskCount = Array.isArray(oldSettings.task_ids) ? oldSettings.task_ids.length : 1;
  const runId = await insert(
    `INSERT INTO benchmark_runs (benchmark_id, label, model, task_count, settings_json, metrics_json,
                                 output_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [benchmarkId, text(oldRun, 'label'), text(oldModel, 'name'), taskCount, JSON.stringify(settings),
      JSON.stringify(metrics), text(oldModel, 'output'), text(oldRun, 'started_at'), text(oldRun, 'finished_at', text(oldRun, 'started_at'))],
  );
  await audit('benchmark_runs', runId, LEGACY_RUN_ID);
  await job('benchmark_run', 'benchmark_runs', runId, oldRun, 'legacy benchmark run');

  const analysisRevisionId = promptRevisions.get(text(oldAnalysis, 'prompt_revision_id'));
  if (!analysisRevisionId) throw new Error('analysis prompt revision did not migrate');
  const failureMapId = await insert(
    `INSERT INTO failure_maps (run_id, prompt_revision_id, provider_model, usage_json, raw_output_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [runId, analysisRevisionId, text(oldAnalysis, 'provider_model'), jsonText(oldAnalysis, 'usage_json'),
      jsonText(oldAnalysis, 'raw_output_json'), text(oldAnalysis, 'created_at'), text(oldAnalysis, 'finished_at', text(oldAnalysis, 'created_at'))],
  );
  await audit('failure_maps', failureMapId, text(oldAnalysis, 'id'));
  await job('failure_map', 'failure_maps', failureMapId, oldAnalysis, 'legacy failure analysis');

  const taxonomyId = await insert(
    `INSERT INTO taxonomies (failure_map_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [failureMapId, text(oldTaxonomy, 'name'), text(oldTaxonomy, 'status', 'draft'), text(oldTaxonomy, 'created_at'), text(oldTaxonomy, 'updated_at')],
  );
  await audit('taxonomies', taxonomyId, text(oldTaxonomy, 'id'));

  const topicIds = new Map<string, number>();
  for (const topic of rows(
    `SELECT DISTINCT tp.* FROM topics tp JOIN taxonomy_topics tt ON tt.topic_id = tp.id
      WHERE tt.taxonomy_id = ? ORDER BY tp.name`, text(oldTaxonomy, 'id'),
  )) {
    const topicId = await insert(
      `INSERT INTO topics (name, slug, description, verifier_strategy, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [text(topic, 'name'), text(topic, 'slug'), text(topic, 'description'), text(topic, 'verifier_strategy'),
        text(topic, 'status', 'active'), text(topic, 'created_at'), text(topic, 'updated_at')],
    );
    topicIds.set(text(topic, 'id'), topicId);
    await db.execute({ sql: 'INSERT INTO taxonomy_topics (taxonomy_id, topic_id, created_at) VALUES (?, ?, ?)', args: [taxonomyId, topicId, text(oldTaxonomy, 'created_at')] });
    await audit('topics', topicId, text(topic, 'id'));
  }

  const failureIds = new Map<string, number>();
  for (const failure of oldFailures) {
    const topicId = topicIds.get(text(failure, 'topic_id')) ?? null;
    const failureId = await insert(
      `INSERT INTO failure_items (failure_map_id, topic_id, task_id, trial_name, criterion_id,
                                  criterion_title, reasoning, capability, severity, status, occurrences,
                                  source_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [failureMapId, topicId, text(failure, 'task_id'), text(failure, 'trial_name'), text(failure, 'criterion_id'),
        text(failure, 'criterion_title'), text(failure, 'reasoning'), text(failure, 'capability'), text(failure, 'severity', 'medium'),
        text(failure, 'status', 'open'), integer(failure, 'occurrences', 1), jsonText(failure, 'source_json'),
        text(failure, 'created_at'), text(failure, 'updated_at')],
    );
    failureIds.set(text(failure, 'id'), failureId);
    await audit('failure_items', failureId, text(failure, 'id'));
  }

  const generationRevisionId = promptRevisions.get(text(oldBatch, 'prompt_revision_id'));
  if (!generationRevisionId) throw new Error('generation prompt revision did not migrate');
  const forgeId = await insert(
    `INSERT INTO forge_runs (failure_map_id, taxonomy_id, prompt_revision_id, backend, provider_model,
                             docs_per_topic, novelty_threshold, auto_approve, requested_documents,
                             usage_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [failureMapId, taxonomyId, generationRevisionId, text(oldBatch, 'generator_backend', 'frontier'), text(oldBatch, 'provider_model'),
      integer(oldBatch, 'docs_per_topic', integer(oldBatch, 'docs_per_failure', 1)), Number(oldBatch.novelty_threshold), integer(oldBatch, 'auto_approve'),
      integer(oldBatch, 'requested_documents'), jsonText(oldBatch, 'usage_json'), text(oldBatch, 'created_at'), text(oldBatch, 'finished_at', text(oldBatch, 'created_at'))],
  );
  await audit('forge_runs', forgeId, text(oldBatch, 'id'));
  await job('forge_run', 'forge_runs', forgeId, oldBatch, 'legacy document forge');
  for (const item of rows('SELECT * FROM generation_batch_failures WHERE batch_id = ?', text(oldBatch, 'id'))) {
    const failureId = failureIds.get(text(item, 'failure_id'));
    if (failureId) await db.execute({ sql: 'INSERT INTO forge_run_items (forge_run_id, failure_item_id) VALUES (?, ?)', args: [forgeId, failureId] });
  }

  const documentIds = new Map<string, number>();
  for (const document of rows('SELECT * FROM synthetic_documents WHERE batch_id = ? ORDER BY topic_id, ordinal', text(oldBatch, 'id'))) {
    const failureId = failureIds.get(text(document, 'failure_id'));
    const topicId = topicIds.get(text(document, 'topic_id')) ?? null;
    if (!failureId) continue;
    const documentId = await insert(
      `INSERT INTO documents (forge_run_id, failure_item_id, topic_id, ordinal, title, document_type,
                              content, task_instruction, reference_answer, verifier_targets_json,
                              content_sha256, normalized_sha256, shingles_json, word_count, max_similarity,
                              nearest_source, novelty_status, novelty_json, review_status, role,
                              generation_attempt, retry_of_document_id, retry_reason, created_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [forgeId, failureId, topicId, integer(document, 'ordinal'), text(document, 'title'), text(document, 'document_type'),
        text(document, 'content'), text(document, 'task_instruction'), text(document, 'reference_answer'), jsonText(document, 'verifier_targets_json', '[]'),
        text(document, 'content_sha256'), text(document, 'normalized_sha256'), jsonText(document, 'shingles_json'), integer(document, 'word_count', 1), Number(document.max_similarity),
        nullableText(document, 'nearest_source'), text(document, 'novelty_status'), jsonText(document, 'novelty_json'), text(document, 'review_status'), text(document, 'role'),
        integer(document, 'generation_attempt', 1), null, nullableText(document, 'retry_reason'), text(document, 'created_at'), nullableText(document, 'reviewed_at')],
    );
    documentIds.set(text(document, 'id'), documentId);
    await audit('documents', documentId, text(document, 'id'));
  }

  const verifierIds = new Map<string, number>();
  for (const verifier of rows('SELECT * FROM verifiers WHERE topic_id IN (SELECT topic_id FROM taxonomy_topics WHERE taxonomy_id = ?) ORDER BY id', text(oldTaxonomy, 'id'))) {
    const topicId = topicIds.get(text(verifier, 'topic_id'));
    if (!topicId) continue;
    const verifierId = await insert(
      `INSERT INTO verifiers (topic_id, name, version, kind, status, description, rubric_json, code, pass_threshold, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [topicId, text(verifier, 'name'), integer(verifier, 'version', 1), text(verifier, 'kind'), text(verifier, 'status'), text(verifier, 'description'),
        jsonText(verifier, 'rubric_json'), text(verifier, 'code'), Number(verifier.pass_threshold), text(verifier, 'created_at'), text(verifier, 'updated_at')],
    );
    verifierIds.set(text(verifier, 'id'), verifierId);
    await audit('verifiers', verifierId, text(verifier, 'id'));
  }

  const environmentIds = new Map<string, number>();
  for (const environment of rows('SELECT * FROM rl_environments WHERE benchmark_run_id = ? ORDER BY id', LEGACY_RUN_ID)) {
    const topicId = topicIds.get(text(environment, 'topic_id'));
    const verifierId = verifierIds.get(text(environment, 'verifier_id'));
    if (!topicId || !verifierId) continue;
    const environmentId = await insert(
      `INSERT INTO environments (run_id, topic_id, verifier_id, name, slug, status, base_model,
                                 inference_model, harness, local_path, package_hash, scale_ready,
                                 scale_ready_at, taskset_json, training_toml, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, topicId, verifierId, text(environment, 'name'), text(environment, 'slug'), text(environment, 'status') === 'pushing' ? 'built' : text(environment, 'status'),
        text(environment, 'base_model'), text(environment, 'inference_model'), text(environment, 'harness', 'endpoint'), nullableText(environment, 'local_path'), nullableText(environment, 'package_hash'), integer(environment, 'scale_ready'),
        nullableText(environment, 'scale_ready_at'), jsonText(environment, 'taskset_config_json'), text(environment, 'training_config_toml'), text(environment, 'created_at'), text(environment, 'updated_at')],
    );
    environmentIds.set(text(environment, 'id'), environmentId);
    await audit('environments', environmentId, text(environment, 'id'));
    await insert(`INSERT INTO jobs (kind, subject_type, subject_id, status, step, progress, exit_code, created_at, started_at, finished_at) VALUES ('env_build', 'environments', ?, 'succeeded', 'legacy environment build', 1, 0, ?, ?, ?)`, [environmentId, text(environment, 'created_at'), text(environment, 'created_at'), text(environment, 'updated_at')]);
  }
  for (const link of rows('SELECT * FROM environment_documents WHERE environment_id IN (SELECT id FROM rl_environments WHERE benchmark_run_id = ?)', LEGACY_RUN_ID)) {
    const environmentId = environmentIds.get(text(link, 'environment_id'));
    const documentId = documentIds.get(text(link, 'document_id'));
    if (environmentId && documentId) await db.execute({ sql: 'INSERT INTO environment_documents (environment_id, document_id, role) VALUES (?, ?, ?)', args: [environmentId, documentId, text(link, 'role')] });
  }

  for (const evaluation of rows('SELECT * FROM environment_evaluations WHERE benchmark_run_id = ? ORDER BY created_at, id', LEGACY_RUN_ID)) {
    const oldEnvironmentIds = JSON.parse(jsonText(evaluation, 'environment_ids_json', '[]')) as string[];
    const newEnvironmentIds = oldEnvironmentIds.map((id) => environmentIds.get(id)).filter((id): id is number => id !== undefined);
    const evaluationId = await insert(
      `INSERT INTO environment_evaluations (run_id, kind, model, endpoint_label, rollouts_per_example,
                                             max_concurrent, environment_ids_json, metrics_json,
                                             result_paths_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, text(evaluation, 'kind') === 'local_rl_test' ? 'rl_test' : 'validation', text(evaluation, 'model'), text(evaluation, 'endpoint_label'),
        integer(evaluation, 'rollouts_per_example', 1), integer(evaluation, 'max_concurrent', 1), JSON.stringify(newEnvironmentIds), JSON.stringify(evaluationMetrics(parsedJson(evaluation, 'metrics_json'))),
        jsonText(evaluation, 'result_paths_json'), text(evaluation, 'created_at'), text(evaluation, 'finished_at', text(evaluation, 'created_at'))],
    );
    await audit('environment_evaluations', evaluationId, text(evaluation, 'id'));
    const evaluationJob = await insert(`INSERT INTO jobs (kind, subject_type, subject_id, status, step, progress, exit_code, created_at, started_at, finished_at) VALUES ('env_eval', 'environment_evaluations', ?, ?, 'legacy environment evaluation', ?, ?, ?, ?, ?)`, [evaluationId, status(text(evaluation, 'status')), status(text(evaluation, 'status')) === 'succeeded' || status(text(evaluation, 'status')) === 'failed' ? 1 : 0, status(text(evaluation, 'status')) === 'succeeded' ? 0 : status(text(evaluation, 'status')) === 'failed' ? 1 : null, text(evaluation, 'created_at'), nullableText(evaluation, 'started_at'), nullableText(evaluation, 'finished_at')]);
    if (text(evaluation, 'log')) await db.execute({ sql: 'INSERT INTO job_log_lines (job_id, seq, at, stream, line) VALUES (?, 1, ?, \'out\', ?)', args: [evaluationJob, text(evaluation, 'created_at'), text(evaluation, 'log')] });
  }
  for (const oldJob of rows('SELECT * FROM environment_jobs WHERE benchmark_run_id = ? ORDER BY created_at, id', LEGACY_RUN_ID)) {
    const jobId = await insert(`INSERT INTO jobs (kind, subject_type, subject_id, status, step, progress, params_json, result_json, created_at, started_at, finished_at) VALUES (?, 'benchmark_runs', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [text(oldJob, 'kind') === 'publish' ? 'env_publish' : 'env_eval', runId, status(text(oldJob, 'status')), text(oldJob, 'kind') === 'publish' ? 'legacy publish' : 'legacy local test', status(text(oldJob, 'status')) === 'succeeded' || status(text(oldJob, 'status')) === 'failed' ? 1 : 0, jsonText(oldJob, 'environment_ids_json', '[]'), jsonText(oldJob, 'result_json'), text(oldJob, 'created_at'), nullableText(oldJob, 'started_at'), nullableText(oldJob, 'finished_at')]);
    if (text(oldJob, 'log')) await db.execute({ sql: 'INSERT INTO job_log_lines (job_id, seq, at, stream, line) VALUES (?, 1, ?, \'out\', ?)', args: [jobId, text(oldJob, 'created_at'), text(oldJob, 'log')] });
  }
  await db.execute('COMMIT');
  legacy.close();
  console.log(`✓ imported ${LEGACY_RUN_ID} as ${code('benchmark_runs', runId)} / ${text(oldModel, 'name')}`);
  console.log('  16 failure items, 6 topics, 12 documents, 6 environments, 3 evaluations');
} catch (error) {
  await db.execute('ROLLBACK');
  legacy.close();
  throw error;
}
