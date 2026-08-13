#!/usr/bin/env bun
/**
 * `bun run db:seed` — one complete lineage to develop against.
 *
 * Builds BR → FM → (FI*, TX → TP*) → DF → DOC* → VF/ENV plus the jobs that
 * produced each stage. Idempotent by way of db:reset, not by upsert: if the
 * database already has a run, this refuses rather than duplicating.
 */
import { createHash } from 'node:crypto';
import { db, insert, now, value } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { code } from '../src/db/ids.ts';
import {
  ANALYSIS_PROMPT,
  DOCUMENT_TYPES,
  GENERATION_PROMPT,
  RUN,
  TASK_ID,
  TOPICS,
  type SeedTopic,
} from './seed-data.ts';

await migrate();

if ((await value<number>('SELECT count(*) FROM benchmark_runs')) ?? 0) {
  console.error('✗ database already seeded — run `bun run db:reset` to start clean');
  process.exit(1);
}

const at = now();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Records the job that produced a stage, so the UI has real execution history. */
async function job(kind: string, subjectType: string, subjectId: number, step: string) {
  return insert(
    `INSERT INTO jobs (kind, subject_type, subject_id, status, step, progress,
                       exit_code, created_at, started_at, finished_at)
     VALUES (?, ?, ?, 'succeeded', ?, 1, 0, ?, ?, ?)`,
    [kind, subjectType, subjectId, step, at, at, at],
  );
}

/** A prompt template plus its first, active revision. */
async function prompt(key: string, name: string, purpose: string, body: string) {
  const templateId = await insert(
    `INSERT INTO prompt_templates (prompt_key, name, purpose, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [key, name, purpose, at, at],
  );
  const revisionId = await insert(
    `INSERT INTO prompt_revisions (template_id, revision_number, body, is_active, created_at)
     VALUES (?, 1, ?, 1, ?)`,
    [templateId, body, at],
  );
  return revisionId;
}

// ---------------------------------------------------------------------------

const analysisRevision = await prompt(
  'failure-analysis',
  'Failure analysis',
  'analysis',
  ANALYSIS_PROMPT,
);
const generationRevision = await prompt(
  'document-generation',
  'Document generation',
  'generation',
  GENERATION_PROMPT,
);

// Benchmark + the single task these failures came from.
const benchmarkId = await insert(
  `INSERT INTO benchmarks (name, lab, source_kind, adapter, status, runnable,
                           description, created_at, updated_at)
   VALUES (?, ?, 'builtin', ?, 'ready', 1, ?, ?, ?)`,
  [RUN.benchmark.name, RUN.benchmark.lab, RUN.benchmark.adapter, RUN.benchmark.description, at, at],
);

await db.execute({
  sql: `INSERT INTO benchmark_tasks (benchmark_id, dataset, task_id, name, source_path, position)
        VALUES (?, 'validation', ?, ?, ?, 0)`,
  args: [
    benchmarkId,
    TASK_ID,
    'Extract distribution requirements from trust agreement',
    `tasks/${TASK_ID}`,
  ],
});

// BR — the benchmark run.
const runId = await insert(
  `INSERT INTO benchmark_runs (benchmark_id, label, model, task_count,
                               settings_json, metrics_json, output_path, created_at, updated_at)
   VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  [
    benchmarkId,
    RUN.label,
    RUN.model,
    JSON.stringify(RUN.settings),
    JSON.stringify(RUN.metrics),
    null,
    at,
    at,
  ],
);
await db.execute({
  sql: 'UPDATE benchmark_runs SET output_path = ? WHERE id = ?',
  args: [`results/lab/${code('benchmark_runs', runId)}/${RUN.model}.jsonl`, runId],
});
await job('benchmark_run', 'benchmark_runs', runId, 'collect rollouts');

// FM + TX — the failure map and its taxonomy.
const failureMapId = await insert(
  `INSERT INTO failure_maps (run_id, prompt_revision_id, provider_model,
                             usage_json, created_at, updated_at)
   VALUES (?, ?, 'deepseek-v4-pro', ?, ?, ?)`,
  [
    runId,
    analysisRevision,
    JSON.stringify({ input_tokens: 18420, output_tokens: 3106 }),
    at,
    at,
  ],
);
await job('failure_map', 'failure_maps', failureMapId, 'group failed criteria');

const taxonomyId = await insert(
  `INSERT INTO taxonomies (failure_map_id, name, status, created_at, updated_at)
   VALUES (?, ?, 'ready', ?, ?)`,
  [failureMapId, `${RUN.label} capability taxonomy`, at, at],
);

// TP + FI — topics, their membership, and the failed criteria under each.
const topicIds = new Map<string, number>();
const failureIdsByTopic = new Map<number, number[]>();

for (const topic of TOPICS as readonly SeedTopic[]) {
  const topicId = await insert(
    `INSERT INTO topics (name, slug, description, verifier_strategy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [topic.name, topic.slug, topic.description, topic.verifier_strategy, at, at],
  );
  topicIds.set(topic.slug, topicId);

  await db.execute({
    sql: 'INSERT INTO taxonomy_topics (taxonomy_id, topic_id, created_at) VALUES (?, ?, ?)',
    args: [taxonomyId, topicId, at],
  });

  const ids: number[] = [];
  for (const [criterionId, criterionTitle, reasoning] of topic.failures) {
    ids.push(
      await insert(
        `INSERT INTO failure_items (failure_map_id, topic_id, task_id, trial_name,
                                    criterion_id, criterion_title, reasoning, capability,
                                    severity, status, occurrences, created_at, updated_at)
         VALUES (?, ?, ?, 'trial-1', ?, ?, ?, ?, 'high', 'approved', 1, ?, ?)`,
        [failureMapId, topicId, TASK_ID, criterionId, criterionTitle, reasoning, topic.name, at, at],
      ),
    );
  }
  failureIdsByTopic.set(topicId, ids);
}

// DF + DOC — the forge run and the documents it produced.
const docsPerTopic = 2;
const forgeRunId = await insert(
  `INSERT INTO forge_runs (failure_map_id, taxonomy_id, prompt_revision_id, backend,
                           provider_model, docs_per_topic, novelty_threshold, auto_approve,
                           requested_documents, usage_json, created_at, updated_at)
   VALUES (?, ?, ?, 'data_designer', 'deepseek-v4-flash', ?, 0.22, 0, ?, ?, ?, ?)`,
  [
    failureMapId,
    taxonomyId,
    generationRevision,
    docsPerTopic,
    TOPICS.length * docsPerTopic,
    JSON.stringify({ input_tokens: 96410, output_tokens: 41288 }),
    at,
    at,
  ],
);
await job('forge_run', 'forge_runs', forgeRunId, 'generate and fingerprint');

const documentIdsByTopic = new Map<number, number[]>();

for (const topic of TOPICS as readonly SeedTopic[]) {
  const topicId = topicIds.get(topic.slug)!;
  const failureIds = failureIdsByTopic.get(topicId)!;
  const docs: number[] = [];

  for (let ordinal = 1; ordinal <= docsPerTopic; ordinal++) {
    // Each document answers one of the topic's failures, round-robin.
    const failureItemId = failureIds[(ordinal - 1) % failureIds.length]!;
    const docType = DOCUMENT_TYPES[(topicId + ordinal) % DOCUMENT_TYPES.length]!;
    const title = `${topic.name} — exhibit ${ordinal}`;
    const content =
      `${title}\n\nA synthetic ${docType.replace('_', ' ')} written to exercise one capability: ` +
      `${topic.description.toLowerCase()} It shares no wording with any benchmark source ` +
      `document — the generator was given only this topic's name, description, and verifier ` +
      `strategy.\n\n[body omitted in fixtures]`;

    await db.execute({
      sql: 'INSERT INTO forge_run_items (forge_run_id, failure_item_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      args: [forgeRunId, failureItemId],
    });

    docs.push(
      await insert(
        `INSERT INTO documents (forge_run_id, failure_item_id, topic_id, ordinal, title,
                                document_type, content, task_instruction, reference_answer,
                                verifier_targets_json, content_sha256, normalized_sha256,
                                word_count, max_similarity, nearest_source, novelty_status,
                                review_status, role, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'passed', 'approved', 'train', ?, ?)`,
        [
          forgeRunId,
          failureItemId,
          topicId,
          ordinal,
          title,
          docType,
          content,
          `Read the ${docType.replace('_', ' ')} and ${topic.description.toLowerCase()}`,
          `A correct response applies the rule: ${topic.verifier_strategy}`,
          JSON.stringify([topic.verifier_strategy]),
          sha(content),
          sha(content.toLowerCase()),
          content.split(/\s+/).length,
          0.04 + ordinal * 0.01,
          at,
          at,
        ],
      ),
    );
  }
  documentIdsByTopic.set(topicId, docs);
}

// VF + ENV — one verifier and one environment package per topic.
const evaluationEnvironmentIds: number[] = [];

for (const topic of TOPICS as readonly SeedTopic[]) {
  const topicId = topicIds.get(topic.slug)!;

  const verifierId = await insert(
    `INSERT INTO verifiers (topic_id, name, version, kind, status, description,
                            rubric_json, pass_threshold, created_at, updated_at)
     VALUES (?, ?, 1, 'llm', 'ready', ?, ?, 0.3, ?, ?)`,
    [
      topicId,
      `${topic.slug}-verifier`,
      topic.verifier_strategy,
      JSON.stringify({ scoring: 'judge_coverage', criteria: [topic.verifier_strategy] }),
      at,
      at,
    ],
  );

  const environmentId = await insert(
    `INSERT INTO environments (run_id, topic_id, verifier_id, name, slug, status,
                               base_model, inference_model, local_path, package_hash,
                               scale_ready, taskset_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'built', ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      runId,
      topicId,
      verifierId,
      topic.name,
      topic.slug,
      RUN.model,
      RUN.model,
      `recursive_workspace/environments/${topic.slug}`,
      sha(topic.slug).slice(0, 16),
      JSON.stringify({ rollouts_per_example: 4 }),
      at,
      at,
    ],
  );
  evaluationEnvironmentIds.push(environmentId);
  await job('env_build', 'environments', environmentId, 'build and contract-check');

  for (const documentId of documentIdsByTopic.get(topicId)!) {
    await db.execute({
      sql: 'INSERT INTO environment_documents (environment_id, document_id, role) VALUES (?, ?, ?)',
      args: [environmentId, documentId, 'train'],
    });
  }
}

// The local proof pass. One topic sits below threshold, and no environment is
// scale-ready — the learnability signal is the gate, not the pass rate.
const meanReward =
  TOPICS.reduce((sum, topic) => sum + topic.reward, 0) / TOPICS.length;

const evaluationId = await insert(
  `INSERT INTO environment_evaluations (run_id, kind, model, endpoint_label,
                                        rollouts_per_example, max_concurrent,
                                        environment_ids_json, metrics_json, created_at, updated_at)
   VALUES (?, 'validation', ?, 'local', 4, 1, ?, ?, ?, ?)`,
  [
    runId,
    RUN.model,
    JSON.stringify(evaluationEnvironmentIds),
    JSON.stringify({
      mean_reward: Number(meanReward.toFixed(3)),
      above_threshold: TOPICS.length,
      tasks_scored: TOPICS.length * docsPerTopic,
      rollouts_per_task: 4,
      // Only one environment shows real spread; the rest are saturated, which
      // is exactly why none of them may be handed to the cluster.
      trainable_signal: 1,
      within_task_std: 0.0,
      saturated_fraction: 0.83,
      // Per-topic reward, keyed by slug. The topics table reads this.
      per_topic: Object.fromEntries(TOPICS.map((topic) => [topic.slug, topic.reward])),
    }),
    at,
    at,
  ],
);
await job('env_eval', 'environment_evaluations', evaluationId, 'local validation');

const count = async (table: string) => (await value<number>(`SELECT count(*) FROM ${table}`)) ?? 0;

console.log(`✓ seeded ${code('benchmark_runs', runId)} "${RUN.label}" / ${RUN.model}`);
for (const table of [
  'failure_maps',
  'failure_items',
  'taxonomies',
  'topics',
  'forge_runs',
  'documents',
  'verifiers',
  'environments',
  'jobs',
]) {
  console.log(`    ${String(await count(table)).padStart(3)}  ${table}`);
}

process.exit(0);
