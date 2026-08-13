#!/usr/bin/env bun
/**
 * Migrate the first local result shape to the normalized hierarchy:
 * benchmark result → task results → task criterion results.
 *
 * The migration is intentionally conservative: row ids, imported explanations,
 * failure maps, topics, and generated documents are preserved.
 */
import { db, value } from '../src/db/client.ts';

const tableExists = async (name: string) =>
  Boolean(await value<number>("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));

if (!(await tableExists('benchmarks_results'))) {
  console.log('✓ result hierarchy already uses the normalized table names');
  process.exit(0);
}

await db.execute('PRAGMA foreign_keys = OFF');
await db.execute('BEGIN');
try {
  await db.execute(`
    CREATE TABLE benchmark_results_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmark_run_id INTEGER NOT NULL UNIQUE REFERENCES benchmark_runs(id) ON DELETE CASCADE,
      benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      outcome TEXT NOT NULL CHECK (outcome IN ('passed','failed','error','skipped')),
      tasks_total INTEGER NOT NULL DEFAULT 0 CHECK (tasks_total >= 0),
      tasks_passed INTEGER NOT NULL DEFAULT 0 CHECK (tasks_passed >= 0),
      tasks_failed INTEGER NOT NULL DEFAULT 0 CHECK (tasks_failed >= 0),
      tasks_error INTEGER NOT NULL DEFAULT 0 CHECK (tasks_error >= 0),
      tasks_skipped INTEGER NOT NULL DEFAULT 0 CHECK (tasks_skipped >= 0),
      criteria_total INTEGER,
      criteria_passed INTEGER,
      criteria_failed INTEGER,
      pass_rate REAL,
      reward REAL,
      result_path TEXT,
      metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(`
    INSERT INTO benchmark_results_new
      (id, benchmark_run_id, benchmark_id, outcome, tasks_total, tasks_passed,
       tasks_failed, tasks_error, tasks_skipped, criteria_total, criteria_passed,
       criteria_failed, pass_rate, reward, result_path, metrics_json, created_at, updated_at)
    SELECT MIN(r.id), r.benchmark_run_id, r.benchmark_id,
           CASE
             WHEN SUM(r.outcome = 'error') > 0 THEN 'error'
             WHEN SUM(r.outcome = 'failed') > 0 THEN 'failed'
             WHEN SUM(r.outcome = 'skipped') = COUNT(*) THEN 'skipped'
             ELSE 'passed'
           END,
           COUNT(*), SUM(r.outcome = 'passed'), SUM(r.outcome = 'failed'),
           SUM(r.outcome = 'error'), SUM(r.outcome = 'skipped'),
           SUM(COALESCE(r.criteria_total, 0)), SUM(COALESCE(r.criteria_passed, 0)),
           SUM(COALESCE(r.criteria_failed, 0)),
           CASE WHEN SUM(COALESCE(r.criteria_total, 0)) > 0
                THEN CAST(SUM(COALESCE(r.criteria_passed, 0)) AS REAL) / SUM(COALESCE(r.criteria_total, 0))
           END,
           AVG(r.reward),
           COALESCE(MAX(r.result_path), (SELECT source.output_path FROM benchmark_runs source WHERE source.id = r.benchmark_run_id)),
           (SELECT source.metrics_json FROM benchmark_runs source WHERE source.id = r.benchmark_run_id),
           MIN(r.created_at), MAX(r.updated_at)
      FROM benchmarks_results r
     GROUP BY r.benchmark_run_id, r.benchmark_id
  `);
  await db.execute('CREATE TEMP TABLE legacy_task_result_map AS SELECT r.id AS task_result_id, br.id AS benchmark_result_id FROM benchmarks_results r JOIN benchmark_results_new br ON br.benchmark_run_id = r.benchmark_run_id');

  await db.execute(`
    CREATE TABLE benchmark_task_results_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmark_result_id INTEGER NOT NULL REFERENCES benchmark_results_new(id) ON DELETE CASCADE,
      benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      dataset TEXT NOT NULL DEFAULT 'validation',
      task_id TEXT NOT NULL,
      trial_name TEXT NOT NULL DEFAULT 'trial-1',
      outcome TEXT NOT NULL CHECK (outcome IN ('passed','failed','error','skipped')),
      reward REAL,
      criteria_total INTEGER,
      criteria_passed INTEGER,
      criteria_failed INTEGER,
      result_path TEXT,
      metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (benchmark_id, dataset, task_id) REFERENCES benchmark_tasks(benchmark_id, dataset, task_id) ON DELETE CASCADE,
      UNIQUE (benchmark_result_id, dataset, task_id, trial_name)
    )
  `);
  await db.execute(`
    INSERT INTO benchmark_task_results_new
      (id, benchmark_result_id, benchmark_id, dataset, task_id, trial_name, outcome,
       reward, criteria_total, criteria_passed, criteria_failed, result_path,
       metrics_json, created_at, updated_at)
    SELECT r.id, m.benchmark_result_id, r.benchmark_id, r.dataset, r.task_id,
           r.trial_name, r.outcome, r.reward, r.criteria_total, r.criteria_passed,
           r.criteria_failed, r.result_path, r.metrics_json, r.created_at, r.updated_at
      FROM benchmarks_results r
      JOIN legacy_task_result_map m ON m.task_result_id = r.id
  `);

  await db.execute(`
    CREATE TABLE benchmark_task_criterion_results_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmark_task_result_id INTEGER NOT NULL REFERENCES benchmark_task_results_new(id) ON DELETE CASCADE,
      benchmark_task_criterion_id INTEGER NOT NULL REFERENCES benchmark_task_criteria(id) ON DELETE RESTRICT,
      task_id TEXT NOT NULL,
      trial_name TEXT NOT NULL DEFAULT '',
      criterion_id TEXT NOT NULL,
      criterion_title TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail','error')),
      reasoning TEXT NOT NULL DEFAULT '',
      match_criteria TEXT NOT NULL DEFAULT '',
      judge_model TEXT NOT NULL DEFAULT '',
      judge_error INTEGER NOT NULL DEFAULT 0 CHECK (judge_error IN (0,1)),
      error_type TEXT,
      source_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (benchmark_task_result_id, benchmark_task_criterion_id)
    )
  `);
  await db.execute(`
    INSERT INTO benchmark_task_criterion_results_new
      (id, benchmark_task_result_id, benchmark_task_criterion_id, task_id, trial_name,
       criterion_id, criterion_title, verdict, reasoning, match_criteria, judge_model,
       judge_error, error_type, source_json, created_at, updated_at)
    SELECT c.id, c.benchmark_result_id, c.benchmark_task_criterion_id, c.task_id,
           c.trial_name, c.criterion_id, c.criterion_title, c.verdict, c.reasoning,
           c.match_criteria, c.judge_model, c.judge_error, c.error_type,
           c.source_json, c.created_at, c.updated_at
      FROM benchmark_criteria_results c
  `);

  await db.execute(`
    CREATE TABLE failure_maps_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmark_result_id INTEGER NOT NULL REFERENCES benchmark_results_new(id) ON DELETE CASCADE,
      prompt_revision_id INTEGER NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
      provider_model TEXT NOT NULL,
      usage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
      raw_output_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(raw_output_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(`
    INSERT INTO failure_maps_new
      (id, benchmark_result_id, prompt_revision_id, provider_model, usage_json,
       raw_output_json, created_at, updated_at)
    SELECT fm.id, m.benchmark_result_id, fm.prompt_revision_id, fm.provider_model,
           fm.usage_json, fm.raw_output_json, fm.created_at, fm.updated_at
      FROM failure_maps fm
      JOIN legacy_task_result_map m ON m.task_result_id = fm.benchmark_result_id
  `);

  await db.execute(`
    CREATE TABLE failure_items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      failure_map_id INTEGER NOT NULL REFERENCES failure_maps_new(id) ON DELETE CASCADE,
      benchmark_result_id INTEGER NOT NULL REFERENCES benchmark_results_new(id) ON DELETE CASCADE,
      benchmark_task_criterion_result_id INTEGER NOT NULL REFERENCES benchmark_task_criterion_results_new(id) ON DELETE RESTRICT,
      topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
      task_id TEXT NOT NULL,
      trial_name TEXT NOT NULL DEFAULT '',
      criterion_id TEXT NOT NULL,
      criterion_title TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      capability TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','ignored')),
      occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
      source_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (failure_map_id, benchmark_task_criterion_result_id)
    )
  `);
  await db.execute(`
    INSERT INTO failure_items_new
      (id, failure_map_id, benchmark_result_id, benchmark_task_criterion_result_id,
       topic_id, task_id, trial_name, criterion_id, criterion_title, reasoning,
       capability, severity, status, occurrences, source_json, created_at, updated_at)
    SELECT fi.id, fi.failure_map_id, m.benchmark_result_id,
           fi.benchmark_criterion_result_id, fi.topic_id, fi.task_id, fi.trial_name,
           fi.criterion_id, fi.criterion_title, fi.reasoning, fi.capability,
           fi.severity, fi.status, fi.occurrences, fi.source_json, fi.created_at,
           fi.updated_at
      FROM failure_items fi
      JOIN legacy_task_result_map m ON m.task_result_id = fi.benchmark_result_id
  `);

  await db.execute('DROP TABLE failure_items');
  await db.execute('DROP TABLE failure_maps');
  await db.execute('DROP TABLE benchmark_criteria_results');
  await db.execute('DROP TABLE benchmarks_results');
  await db.execute('ALTER TABLE benchmark_results_new RENAME TO benchmark_results');
  await db.execute('ALTER TABLE benchmark_task_results_new RENAME TO benchmark_task_results');
  await db.execute('ALTER TABLE benchmark_task_criterion_results_new RENAME TO benchmark_task_criterion_results');
  await db.execute('ALTER TABLE failure_maps_new RENAME TO failure_maps');
  await db.execute('ALTER TABLE failure_items_new RENAME TO failure_items');

  await db.execute('CREATE INDEX idx_benchmark_results_run ON benchmark_results(benchmark_run_id)');
  await db.execute('CREATE INDEX idx_benchmark_task_results_result ON benchmark_task_results(benchmark_result_id, created_at DESC)');
  await db.execute('CREATE INDEX idx_benchmark_task_results_task ON benchmark_task_results(benchmark_id, dataset, task_id, created_at DESC)');
  await db.execute('CREATE INDEX idx_task_criterion_results_task_result ON benchmark_task_criterion_results(benchmark_task_result_id, criterion_id)');
  await db.execute('CREATE INDEX idx_task_criterion_results_criterion ON benchmark_task_criterion_results(benchmark_task_criterion_id)');
  await db.execute('CREATE UNIQUE INDEX idx_fm_one_per_result ON failure_maps(benchmark_result_id)');
  await db.execute('CREATE INDEX idx_failure_items_map ON failure_items(failure_map_id)');
  await db.execute('CREATE INDEX idx_failure_items_result ON failure_items(benchmark_result_id)');
  await db.execute('CREATE INDEX idx_failure_items_criterion_result ON failure_items(benchmark_task_criterion_result_id)');
  await db.execute('CREATE INDEX idx_failure_items_topic ON failure_items(topic_id, status)');
  await db.execute('ALTER TABLE benchmark_runs DROP COLUMN metrics_json');
  await db.execute('ALTER TABLE benchmark_runs DROP COLUMN output_path');
  await db.execute('DROP TABLE legacy_task_result_map');
  await db.execute('COMMIT');
} catch (error) {
  await db.execute('ROLLBACK');
  throw error;
} finally {
  await db.execute('PRAGMA foreign_keys = ON');
}

console.log('✓ migrated benchmark results to aggregate → task → criterion hierarchy');
