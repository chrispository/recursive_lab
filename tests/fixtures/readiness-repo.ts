/** Runs in a child with a disposable database; no production rows are touched. */
import assert from 'node:assert/strict';
import { db } from '../../src/db/client.ts';
import * as repo from '../../src/domain/environments/repo.ts';
import type { BuildDocument } from '../../src/domain/environments/model.ts';

await db.executeMultiple(await Bun.file(new URL('../../src/db/schema.sql', import.meta.url)).text());
// Upstream benchmark/forge rows are irrelevant to these repository transitions.
await db.execute('PRAGMA foreign_keys = OFF');
const at = '2026-09-06T00:00:00.000Z';
await db.execute(`INSERT INTO topics (id, failure_map_id, name, slug, created_at, updated_at) VALUES (1,1,'Topic','topic',?,?)`, [at, at]);
await db.execute(`INSERT INTO verifiers (id, topic_id, name, kind, created_at, updated_at) VALUES (1,1,'Judge','llm',?,?)`, [at, at]);
for (const id of [1, 2]) await db.execute(`INSERT INTO documents
  (id, data_forge_run_id, failure_item_id, topic_id, ordinal, title, document_type, content, task_instruction,
   reference_answer, content_sha256, normalized_sha256, word_count, novelty_status, created_at)
  VALUES (?,1,1,1,?,'Memo','memo','Body','Task','Answer','hash','hash',1,'passed',?)`, [id, id, at]);
await db.execute(`INSERT INTO environments
  (id, benchmark_run_id, topic_id, verifier_id, name, slug, status, package_hash, taskset_json, scale_ready, training_toml, created_at, updated_at)
  VALUES (1,1,1,1,'Topic','topic','built','hash','{"packageVersion":2}',1,'old-export',?,?)`, [at, at]);
await db.execute(`INSERT INTO environment_documents VALUES (1,1,'train')`);
await db.execute(`INSERT INTO jobs (id, kind, subject_type, subject_id, status, created_at) VALUES (1,'env_eval','benchmark_runs',1,'succeeded',?)`, [at]);
const metrics = { environments: [{ environment_id: 1, package_hash: 'hash', mean_reward: 0.5,
  pass_rate: 1, within_task_std: 0.2, saturated_fraction: 0, tasks_scored: 1 }] };
await db.execute(`INSERT INTO environment_evaluations
  (id, benchmark_run_id, job_id, kind, model, judge_model, rollouts_per_example, metrics_json, created_at, updated_at)
  VALUES (1,1,1,'validation','policy','judge',4,?,?,?)`, [JSON.stringify(metrics), at, at]);
const current = async () => (await repo.listByBenchmarkRun(1))[0]!;
assert.equal((await current()).scaleReady, true);
await repo.clearReadiness(1);
assert.equal((await current()).scaleReady, false);
assert.equal((await current()).clusterPrepared, false);
assert.equal(await repo.markScaleReady(1, '', 1, 'hash'), 1);
await db.execute(`UPDATE jobs SET status = 'cancelled' WHERE id = 1`);
assert.equal((await current()).scaleReady, false);
assert.equal(await repo.markScaleReady(1, '', 1, 'hash'), 0);
await db.execute(`UPDATE jobs SET status = 'succeeded' WHERE id = 1`);
await db.execute(`INSERT INTO jobs (id, kind, subject_type, subject_id, status, created_at) VALUES (2,'env_eval','benchmark_runs',1,'running',?)`, [at]);
await repo.clearReadiness(1);
assert.equal(await repo.markScaleReady(1, 'late-export', 1, 'hash'), 0);
assert.equal((await current()).clusterPrepared, false);
await db.execute(`UPDATE jobs SET status = 'succeeded' WHERE id = 2`);
metrics.environments[0]!.within_task_std = 0;
await db.execute(`INSERT INTO environment_evaluations
  (id, benchmark_run_id, job_id, kind, model, judge_model, rollouts_per_example, metrics_json, created_at, updated_at)
  VALUES (2,1,2,'validation','policy','judge',4,?,?,?)`, [JSON.stringify(metrics), at, at]);
await db.execute(`UPDATE environments SET scale_ready = 1, training_toml = 'historical' WHERE id = 1`);
assert.equal((await current()).scaleReady, false);
assert.equal((await current()).clusterPrepared, false);
const doc: BuildDocument = { documentId: 2, topicId: 1, role: 'train', title: 'Memo', content: 'Body',
  taskInstruction: 'Task', referenceAnswer: 'Answer', verifierTargets: ['Target'] };
await repo.markBuilt(1, { localPath: '/new/revision', packageHash: 'new-hash', inferenceModel: '' }, [doc]);
assert.equal((await current()).scaleReady, false);
assert.equal((await current()).packageHash, 'new-hash');
assert.equal((await current()).taskCounts.tasks, 1);
assert.equal((await db.execute('SELECT document_id FROM environment_documents')).rows[0]!.document_id, 2);
assert.equal((await db.execute('SELECT count(*) AS n FROM environment_evaluations')).rows[0]!.n, 2);
db.close();
console.log('Readiness persistence and rebuild transitions passed');
