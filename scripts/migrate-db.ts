#!/usr/bin/env bun
/** Apply safe, append-only-compatible migrations to the configured database. */
import { all, db, json, one, value, type Row } from '../src/db/client.ts';
import { readSavedResult } from '../src/gym/pi-results.ts';

type Column = { name: string };

const tableExists = async (name: string): Promise<boolean> =>
  Boolean(await value<number>(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]));

const columnsOf = (name: string) => all<Column>(`PRAGMA table_info(${name})`);

async function migrateBenchmarkSources(): Promise<void> {
  if (!(await tableExists('benchmark_sources'))) {
    console.log('✓ benchmark_sources does not exist; run db:setup for a new database');
    return;
  }
  const columns = await columnsOf('benchmark_sources');
  if (columns.some((column) => column.name === 'benchmark_id')) {
    console.log('✓ benchmark_sources already has benchmark_id');
    return;
  }

  const count = await value<number>('SELECT COUNT(*) FROM benchmark_sources');
  if (count !== 0) {
    throw new Error(
      `Refusing to rebuild benchmark_sources because it contains ${count} rows. ` +
      'Reconcile those source rows before applying this migration.',
    );
  }

  await db.execute('BEGIN');
  try {
    await db.execute(`
      CREATE TABLE benchmark_sources_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        benchmark_id      INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
        task_id           TEXT    NOT NULL,
        relative_path     TEXT    NOT NULL,
        content_sha256    TEXT    NOT NULL,
        normalized_sha256 TEXT    NOT NULL,
        word_count        INTEGER NOT NULL CHECK (word_count >= 0),
        shingles_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(shingles_json)),
        created_at        TEXT    NOT NULL,
        UNIQUE (benchmark_id, task_id, relative_path)
      )
    `);
    await db.execute('DROP TABLE benchmark_sources');
    await db.execute('ALTER TABLE benchmark_sources_new RENAME TO benchmark_sources');
    await db.execute('CREATE INDEX idx_sources_benchmark_task ON benchmark_sources(benchmark_id, task_id)');
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK').catch(() => undefined);
    throw error;
  }
  console.log('✓ benchmark_sources migrated; existing source rows were not repopulated');
}

type ExistingEvaluation = Row & {
  id: number;
  benchmark_run_id: number;
  kind: 'rl_test' | 'validation';
  model: string;
  endpoint_label: string;
  rollouts_per_example: number;
  max_concurrent: number;
  environment_ids_json: string;
  metrics_json: string;
  result_paths_json: string;
  created_at: string;
  updated_at: string;
};

type EvalJob = Row & {
  id: number;
  subject_id: number;
  created_at: string;
  finished_at: string | null;
};

const EVALUATION_TABLE = `
  CREATE TABLE environment_evaluations_new (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_run_id     INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
    job_id               INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
    kind                 TEXT    NOT NULL CHECK (kind IN ('rl_test','validation')),
    model                TEXT    NOT NULL,
    endpoint_label       TEXT    NOT NULL DEFAULT '',
    judge_model          TEXT    NOT NULL DEFAULT '',
    judge_endpoint_label TEXT    NOT NULL DEFAULT '',
    rollouts_per_example INTEGER NOT NULL DEFAULT 1 CHECK (rollouts_per_example BETWEEN 1 AND 20),
    max_concurrent       INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent BETWEEN 1 AND 32),
    environment_ids_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(environment_ids_json)),
    metrics_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
    result_paths_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(result_paths_json)),
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
  )
`;

function distanceToJob(evaluationAt: string, job: EvalJob): number {
  const at = Date.parse(evaluationAt);
  const started = Date.parse(job.created_at);
  const finished = job.finished_at ? Date.parse(job.finished_at) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(at) && at >= started && at <= finished) return 0;
  const end = Number.isFinite(finished) ? finished : started;
  return Math.abs((Number.isFinite(at) ? at : started) - end);
}

async function judgeModelOf(jobId: number): Promise<string> {
  const row = await one<Row & { line: string }>(
    `SELECT line FROM job_log_lines WHERE job_id = ? AND line LIKE '%judge model%' ORDER BY seq ASC LIMIT 1`,
    [jobId],
  );
  if (!row) return '';
  const marker = 'judge model';
  const at = row.line.indexOf(marker);
  return at < 0 ? '' : row.line.slice(at + marker.length).trim();
}

async function migrateEvaluationTable(): Promise<void> {
  if (!(await tableExists('environment_evaluations'))) return;
  const columns = await columnsOf('environment_evaluations');
  const hasJob = columns.some((column) => column.name === 'job_id');
  const hasJudge = columns.some((column) => column.name === 'judge_model');
  const hasJudgeEndpoint = columns.some((column) => column.name === 'judge_endpoint_label');

  if (!hasJob) {
    const evaluations = await all<ExistingEvaluation>(`SELECT * FROM environment_evaluations ORDER BY id`);
    const jobs = await all<EvalJob>(
      `SELECT id, subject_id, created_at, finished_at FROM jobs
        WHERE kind = 'env_eval' AND subject_type = 'benchmark_runs'
        ORDER BY id`,
    );
    const used = new Set<number>();
    const mappings: Array<{ evaluation: ExistingEvaluation; jobId: number; judgeModel: string }> = [];
    for (const evaluation of evaluations) {
      const candidates = jobs
        .filter((job) => job.subject_id === evaluation.benchmark_run_id && !used.has(job.id))
        .sort((a, b) => distanceToJob(evaluation.created_at, a) - distanceToJob(evaluation.created_at, b));
      const job = candidates[0];
      if (!job) {
        throw new Error(`Could not map environment evaluation ${evaluation.id} to an env_eval job.`);
      }
      used.add(job.id);
      mappings.push({ evaluation, jobId: job.id, judgeModel: await judgeModelOf(job.id) });
    }

    await db.execute('BEGIN');
    try {
      await db.execute(EVALUATION_TABLE);
      for (const { evaluation, jobId, judgeModel } of mappings) {
        await db.execute(
          `INSERT INTO environment_evaluations_new
             (id, benchmark_run_id, job_id, kind, model, endpoint_label, judge_model, judge_endpoint_label,
              rollouts_per_example, max_concurrent, environment_ids_json, metrics_json, result_paths_json,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
          [
            evaluation.id,
            evaluation.benchmark_run_id,
            jobId,
            evaluation.kind,
            evaluation.model,
            evaluation.endpoint_label,
            judgeModel,
            evaluation.rollouts_per_example,
            evaluation.max_concurrent,
            evaluation.environment_ids_json,
            evaluation.metrics_json,
            evaluation.result_paths_json,
            evaluation.created_at,
            evaluation.updated_at,
          ],
        );
      }
      await db.execute('DROP TABLE environment_evaluations');
      await db.execute('ALTER TABLE environment_evaluations_new RENAME TO environment_evaluations');
      await db.execute('CREATE INDEX idx_env_evals_benchmark_run ON environment_evaluations(benchmark_run_id, created_at DESC, id DESC)');
      await db.execute('CREATE INDEX idx_env_evals_job ON environment_evaluations(job_id)');
      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK').catch(() => undefined);
      throw error;
    }
    console.log(`✓ environment_evaluations linked ${mappings.length} existing row(s) to jobs`);
    return;
  }

  if (!hasJudge) await db.execute(`ALTER TABLE environment_evaluations ADD COLUMN judge_model TEXT NOT NULL DEFAULT ''`);
  if (!hasJudgeEndpoint) await db.execute(`ALTER TABLE environment_evaluations ADD COLUMN judge_endpoint_label TEXT NOT NULL DEFAULT ''`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_env_evals_benchmark_run ON environment_evaluations(benchmark_run_id, created_at DESC, id DESC)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_env_evals_job ON environment_evaluations(job_id)');
  console.log('✓ environment_evaluations lineage columns already present');
}

async function repairEvaluationAuditEvents(): Promise<void> {
  const events = await all<Row & { id: number; entity_id: number; details_json: string; created_at: string }>(
    `SELECT id, entity_id, details_json, created_at FROM audit_events
      WHERE entity_type = 'environment_evaluations'
        AND json_extract(details_json, '$.evaluationId') IS NULL
      ORDER BY id`,
  );
  for (const event of events) {
    let details: Record<string, unknown>;
    try {
      details = JSON.parse(event.details_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const benchmarkRunId = Number(details.benchmarkRunId ?? event.entity_id);
    const kind = details.kind === 'validation' ? 'validation' : 'rl_test';
    const evaluation = await one<Row & { id: number }>(
      `SELECT id FROM environment_evaluations
        WHERE benchmark_run_id = ? AND kind = ?
        ORDER BY abs(unixepoch(created_at) - unixepoch(?)), id
        LIMIT 1`,
      [benchmarkRunId, kind, event.created_at],
    );
    if (!evaluation) continue;
    details.evaluationId = evaluation.id;
    await db.execute(
      `UPDATE audit_events SET entity_id = ?, details_json = ? WHERE id = ?`,
      [evaluation.id, JSON.stringify(details), event.id],
    );
  }
  if (events.length) console.log(`✓ repaired ${events.length} legacy evaluation audit event(s)`);
}

const TRACKING_TABLES = `
CREATE TABLE IF NOT EXISTS environment_evaluation_environments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id        INTEGER NOT NULL REFERENCES environment_evaluations(id) ON DELETE CASCADE,
  environment_id      INTEGER NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  split                TEXT    NOT NULL CHECK (split IN ('train','canary','heldout')),
  task_count           INTEGER NOT NULL DEFAULT 0 CHECK (task_count >= 0),
  rollouts_per_example INTEGER NOT NULL CHECK (rollouts_per_example BETWEEN 1 AND 20),
  mean_reward          REAL CHECK (mean_reward IS NULL OR (mean_reward >= 0 AND mean_reward <= 1)),
  pass_rate            REAL CHECK (pass_rate IS NULL OR (pass_rate >= 0 AND pass_rate <= 1)),
  within_task_std      REAL CHECK (within_task_std IS NULL OR within_task_std >= 0),
  saturated_fraction   REAL CHECK (saturated_fraction IS NULL OR (saturated_fraction >= 0 AND saturated_fraction <= 1)),
  tasks_scored         INTEGER NOT NULL DEFAULT 0 CHECK (tasks_scored >= 0),
  error                TEXT    NOT NULL DEFAULT '',
  result_path          TEXT,
  metrics_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  created_at           TEXT    NOT NULL,
  UNIQUE (evaluation_id, environment_id, split)
);
CREATE INDEX IF NOT EXISTS idx_env_eval_envs_evaluation ON environment_evaluation_environments(evaluation_id, environment_id);
CREATE INDEX IF NOT EXISTS idx_env_eval_envs_environment ON environment_evaluation_environments(environment_id, created_at DESC);
CREATE TABLE IF NOT EXISTS environment_evaluation_rollouts (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_environment_id INTEGER NOT NULL REFERENCES environment_evaluation_environments(id) ON DELETE CASCADE,
  document_id              INTEGER REFERENCES documents(id) ON DELETE RESTRICT,
  example_index            INTEGER NOT NULL CHECK (example_index >= 0),
  rollout_index            INTEGER NOT NULL CHECK (rollout_index >= 0),
  trial_name               TEXT    NOT NULL DEFAULT '',
  reward                   REAL CHECK (reward IS NULL OR (reward >= 0 AND reward <= 1)),
  outcome                  TEXT    NOT NULL CHECK (outcome IN ('passed','failed','error','skipped')),
  error                    TEXT    NOT NULL DEFAULT '',
  result_path              TEXT,
  agent_input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (agent_input_tokens >= 0),
  agent_output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (agent_output_tokens >= 0),
  agent_turns              INTEGER NOT NULL DEFAULT 0 CHECK (agent_turns >= 0),
  judge_input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (judge_input_tokens >= 0),
  judge_output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (judge_output_tokens >= 0),
  judge_wall_clock_seconds REAL NOT NULL DEFAULT 0 CHECK (judge_wall_clock_seconds >= 0),
  metadata_json            TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at               TEXT    NOT NULL,
  UNIQUE (evaluation_environment_id, example_index, rollout_index)
);
CREATE INDEX IF NOT EXISTS idx_env_eval_rollouts_environment ON environment_evaluation_rollouts(evaluation_environment_id, example_index, rollout_index);
CREATE INDEX IF NOT EXISTS idx_env_eval_rollouts_document ON environment_evaluation_rollouts(document_id, created_at DESC);
CREATE TABLE IF NOT EXISTS environment_evaluation_target_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rollout_id   INTEGER NOT NULL REFERENCES environment_evaluation_rollouts(id) ON DELETE CASCADE,
  target_index INTEGER NOT NULL CHECK (target_index >= 0),
  target_text  TEXT    NOT NULL,
  score        REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  verdict      TEXT    NOT NULL CHECK (verdict IN ('pass','fail','error')),
  judge_model  TEXT    NOT NULL DEFAULT '',
  error        TEXT    NOT NULL DEFAULT '',
  details_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at   TEXT    NOT NULL,
  UNIQUE (rollout_id, target_index)
);
CREATE INDEX IF NOT EXISTS idx_env_eval_targets_rollout ON environment_evaluation_target_scores(rollout_id, target_index);
CREATE INDEX IF NOT EXISTS idx_env_eval_targets_verdict ON environment_evaluation_target_scores(verdict, created_at DESC);
CREATE TABLE IF NOT EXISTS verifier_training_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE RESTRICT,
  job_id          INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  algorithm       TEXT    NOT NULL DEFAULT '',
  policy_model    TEXT    NOT NULL DEFAULT '',
  judge_model     TEXT    NOT NULL DEFAULT '',
  base_checkpoint TEXT,
  output_path     TEXT,
  config_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  result_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verifier_training_runs_benchmark ON verifier_training_runs(benchmark_run_id, created_at DESC);
CREATE TABLE IF NOT EXISTS verifier_training_environments (
  training_run_id INTEGER NOT NULL REFERENCES verifier_training_runs(id) ON DELETE CASCADE,
  environment_id  INTEGER NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  PRIMARY KEY (training_run_id, environment_id)
);
CREATE TABLE IF NOT EXISTS verifier_training_checkpoints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  training_run_id INTEGER NOT NULL REFERENCES verifier_training_runs(id) ON DELETE CASCADE,
  step            INTEGER NOT NULL CHECK (step >= 0),
  epoch           REAL CHECK (epoch IS NULL OR epoch >= 0),
  label           TEXT    NOT NULL DEFAULT '',
  path            TEXT    NOT NULL,
  sha256          TEXT,
  size_bytes      INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  metrics_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  created_at      TEXT    NOT NULL,
  UNIQUE (training_run_id, step)
);
CREATE INDEX IF NOT EXISTS idx_verifier_training_checkpoints_run ON verifier_training_checkpoints(training_run_id, step);
CREATE TABLE IF NOT EXISTS verifier_training_artifacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  training_run_id INTEGER NOT NULL REFERENCES verifier_training_runs(id) ON DELETE CASCADE,
  checkpoint_id   INTEGER REFERENCES verifier_training_checkpoints(id) ON DELETE SET NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('model','checkpoint','config','metrics','logs','dataset','other')),
  path            TEXT    NOT NULL,
  sha256          TEXT,
  size_bytes      INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  metadata_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at      TEXT    NOT NULL,
  UNIQUE (training_run_id, path)
);
CREATE INDEX IF NOT EXISTS idx_verifier_training_artifacts_run ON verifier_training_artifacts(training_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verifier_training_artifacts_checkpoint ON verifier_training_artifacts(checkpoint_id);
`;

type MetricEntry = {
  environment_id?: number;
  mean_reward?: number | null;
  pass_rate?: number | null;
  within_task_std?: number | null;
  saturated_fraction?: number | null;
  tasks_scored?: number;
  error?: string;
};

type Metrics = { environments?: MetricEntry[] };

async function backfillEvaluationRows(): Promise<void> {
  const evaluations = await all<Row & {
    id: number;
    benchmark_run_id: number;
    rollouts_per_example: number;
    metrics_json: string;
    result_paths_json: string;
    created_at: string;
  }>(`SELECT id, benchmark_run_id, rollouts_per_example, metrics_json, result_paths_json, created_at FROM environment_evaluations ORDER BY id`);
  let environmentsInserted = 0;
  let rolloutsInserted = 0;
  for (const evaluation of evaluations) {
    const existing = await value<number>(
      `SELECT count(*) FROM environment_evaluation_environments WHERE evaluation_id = ?`,
      [evaluation.id],
    );
    if (existing) continue;
    const metrics = json<Metrics>(evaluation.metrics_json, {});
    const paths = json<Record<string, string>>(evaluation.result_paths_json, {});
    const byEnvironment = new Map<number, MetricEntry>();
    for (const entry of metrics.environments ?? []) {
      if (typeof entry.environment_id === 'number') byEnvironment.set(entry.environment_id, entry);
    }

    const pathEntries = Object.entries(paths);
    const seen = new Set<number>();
    for (const [key, resultPath] of pathEntries) {
      const splitAt = key.lastIndexOf(':');
      if (splitAt < 1) continue;
      const slug = key.slice(0, splitAt);
      const split = key.slice(splitAt + 1);
      if (split !== 'train' && split !== 'canary' && split !== 'heldout') continue;
      const environment = await one<Row & { id: number; pass_threshold: number }>(
        `SELECT e.id, v.pass_threshold FROM environments e JOIN verifiers v ON v.id = e.verifier_id WHERE e.slug = ?`,
        [slug],
      );
      if (!environment) continue;
      const entry = byEnvironment.get(environment.id) ?? {};
      const documentRows = await all<Row & { document_id: number }>(
        `SELECT document_id FROM environment_documents WHERE environment_id = ? AND role = ? ORDER BY document_id`,
        [environment.id, split],
      );
      const saved = await readSavedResult(resultPath).catch(() => []);
      await db.execute(
        `INSERT OR IGNORE INTO environment_evaluation_environments
           (evaluation_id, environment_id, split, task_count, rollouts_per_example,
            mean_reward, pass_rate, within_task_std, saturated_fraction, tasks_scored,
            error, result_path, metrics_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          evaluation.id,
          environment.id,
          split,
          documentRows.length,
          evaluation.rollouts_per_example,
          entry.mean_reward ?? null,
          entry.pass_rate ?? null,
          entry.within_task_std ?? null,
          entry.saturated_fraction ?? null,
          entry.tasks_scored ?? 0,
          entry.error ?? '',
          resultPath,
          JSON.stringify({ source: 'migration-backfill' }),
          evaluation.created_at,
        ],
      );
      const envRowId = Number(await value<number>(
        `SELECT id FROM environment_evaluation_environments WHERE evaluation_id = ? AND environment_id = ? AND split = ?`,
        [evaluation.id, environment.id, split],
      ));
      environmentsInserted += 1;
      seen.add(environment.id);
      for (const rollout of saved) {
        await db.execute(
          `INSERT OR IGNORE INTO environment_evaluation_rollouts
             (evaluation_environment_id, document_id, example_index, rollout_index, trial_name,
              reward, outcome, error, result_path, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            envRowId,
            documentRows[rollout.exampleId]?.document_id ?? null,
            rollout.exampleId,
            rollout.rolloutIndex,
            rollout.trialName,
            rollout.reward,
            rollout.error ? 'error' : rollout.reward !== null && rollout.reward >= Number(environment.pass_threshold) ? 'passed' : 'failed',
            rollout.error ?? '',
            resultPath,
            JSON.stringify({ source: 'migration-backfill' }),
            evaluation.created_at,
          ],
        );
        const rolloutId = Number(await value<number>(
          `SELECT id FROM environment_evaluation_rollouts WHERE evaluation_environment_id = ? AND example_index = ? AND rollout_index = ?`,
          [envRowId, rollout.exampleId, rollout.rolloutIndex],
        ));
        rolloutsInserted += 1;
        for (const target of rollout.targetScores) {
          await db.execute(
            `INSERT OR IGNORE INTO environment_evaluation_target_scores
               (rollout_id, target_index, target_text, score, verdict, judge_model, error, details_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [rolloutId, target.targetIndex, target.targetText, target.score, target.verdict, target.judgeModel, target.error, JSON.stringify(target.details), evaluation.created_at],
          );
        }
      }
    }

    for (const entry of metrics.environments ?? []) {
      if (typeof entry.environment_id !== 'number' || seen.has(entry.environment_id)) continue;
      const documentCount = await value<number>(
        `SELECT count(*) FROM environment_documents WHERE environment_id = ? AND role = 'train'`,
        [entry.environment_id],
      );
      await db.execute(
        `INSERT OR IGNORE INTO environment_evaluation_environments
           (evaluation_id, environment_id, split, task_count, rollouts_per_example,
            mean_reward, pass_rate, within_task_std, saturated_fraction, tasks_scored,
            error, result_path, metrics_json, created_at)
         VALUES (?, ?, 'train', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          evaluation.id,
          entry.environment_id,
          Number(documentCount ?? 0),
          evaluation.rollouts_per_example,
          entry.mean_reward ?? null,
          entry.pass_rate ?? null,
          entry.within_task_std ?? null,
          entry.saturated_fraction ?? null,
          entry.tasks_scored ?? 0,
          entry.error ?? 'No saved result was available.',
          JSON.stringify({ source: 'migration-backfill' }),
          evaluation.created_at,
        ],
      );
      environmentsInserted += 1;
    }
  }
  console.log(`✓ evaluation detail backfill created ${environmentsInserted} environment row(s) and ${rolloutsInserted} rollout row(s)`);
}

await migrateBenchmarkSources();
await migrateEvaluationTable();
await repairEvaluationAuditEvents();
await db.executeMultiple(TRACKING_TABLES);
await backfillEvaluationRows();
console.log('✓ evaluation and verifier-training schema is ready');
