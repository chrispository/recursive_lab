#!/usr/bin/env bun
/**
 * `bun run db:seed` — one run progressed through every stage, to develop against.
 *
 * Builds BR → BTR → FM → (FI*, TP*) → DF → DOC* → VF/ENV plus the jobs that
 * produced each stage. Idempotent by way of db:reset, not by upsert: if the
 * database already has a run, this refuses rather than duplicating.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { db, insert, now, value } from '../src/db/client.ts';
import { code } from '../src/db/ids.ts';
import { config } from '../src/config.ts';

const RUN = {
  label: 'harvey_001',
  model: 'glm-5.2',
  benchmark: {
    name: 'Legal Agent Bench',
    lab: 'Harvey',
    adapter: 'legal_agent_bench',
    description: 'Long-horizon legal research and drafting tasks, judged criterion by criterion.',
  },
  settings: { repeats: 1, concurrency: 1, temperature: 1.0, top_p: 0.95, judge_parallelism: 6, reward_mode: 'criteria_pass_rate' },
  metrics: { rollouts: 1, criteria_total: 69, criteria_passed: 53, pass_rate: 0.768, mean_reward: 0.768, input_tokens: 742312, output_tokens: 38754 },
} as const;
const TASK_ID = 'trusts-estates-private-client__extract-distribution-requirements-from-trust-agreement';
type TaskCriterion = { id: string; title: string; match_criteria: string; [key: string]: unknown };

const taskDefinitionPath = resolve(
  config.gym.root,
  'resources_servers/legal_agent_bench/data/cache/harbor_tasks/legal_agent_bench',
  TASK_ID,
  'task.json',
);
const taskDefinition = await Bun.file(taskDefinitionPath).json() as { criteria: TaskCriterion[] };
const TOPICS = [
  { name: 'Provision Substance and Obligation Extraction', slug: 'provision-substance-and-obligation-extraction', description: 'Extract operative language, not a heading.', verifier_strategy: 'The response must quote or paraphrase the operative obligation, not merely name the section it appears in.', reward: 1.0, failures: [['C-014', 'Identifies the distribution standard', 'Named the article but not the operative "health, education, maintenance and support" standard it contains.'], ['C-022', 'States the trustee obligation', 'Described the trustee as "responsible for distributions" without extracting the mandatory-versus-discretionary language.'], ['C-031', 'Quotes the controlling sentence', 'Summarised the provision instead of quoting the sentence that creates the duty.'], ['C-047', 'Distinguishes mandatory from discretionary', 'Treated a discretionary distribution as mandatory; the word "may" was not surfaced.']] },
  { name: 'Provision-Fact Matching and Governing Section', slug: 'provision-fact-matching-and-governing-section', description: 'Match facts to the provision that governs.', verifier_strategy: 'Given a fact pattern, the response must cite the specific provision that governs it rather than the nearest topical heading.', reward: 1.0, failures: [['C-008', 'Cites the governing provision', 'Cited the general distributions article when the specific successor-trustee clause governed.'], ['C-019', 'Applies facts to the right clause', 'Applied the wrong clause to the beneficiary\'s stated circumstances.'], ['C-052', 'Excludes inapplicable provisions', 'Listed three provisions without saying which one actually controls.']] },
  { name: 'Prudent Actionable Next Steps', slug: 'prudent-actionable-next-steps', description: 'Recommend steps instead of a definitive conclusion.', verifier_strategy: 'Where the document is ambiguous, the response must recommend a concrete next step rather than assert a conclusion the text does not support.', reward: 0.746, failures: [['C-003', 'Recommends a next step', 'Asserted a definitive answer where the trust instrument was silent.'], ['C-027', 'Flags the need for further review', 'Did not note that the amendment history was incomplete.'], ['C-061', 'Avoids unsupported conclusions', 'Concluded the distribution was permitted without the governing amendment in evidence.']] },
  { name: 'Static Reference Ambiguity Flagging', slug: 'static-reference-ambiguity-flagging', description: 'External standard frozen as of a date.', verifier_strategy: 'When a document incorporates an external standard, the response must flag whether the reference is static (as of a date) or ambulatory.', reward: 1.0, failures: [['C-011', 'Flags static incorporation', 'Read an "as in effect on the date hereof" reference as tracking current law.'], ['C-038', 'Identifies the reference date', 'Did not surface the date the external standard was frozen to.']] },
  { name: 'Conflict of Interest Detection', slug: 'conflict-of-interest-detection', description: 'Successor fiduciary affiliated with the firm.', verifier_strategy: 'The response must surface any fiduciary appointment where the appointee is affiliated with the drafting firm or a beneficiary.', reward: 1.0, failures: [['C-016', 'Detects the affiliation', 'Missed that the named successor trustee is a partner at the drafting firm.'], ['C-044', 'Notes the disclosure requirement', 'Did not mention that the affiliation requires disclosure to beneficiaries.']] },
  { name: 'Indexed Value Computation', slug: 'indexed-value-computation', description: 'Show the arithmetic behind an indexed figure.', verifier_strategy: 'Where a figure is indexed or adjusted, the response must show the computation, not just the result.', reward: 1.0, failures: [['C-025', 'Shows the computation', 'Gave an adjusted figure with no arithmetic.'], ['C-058', 'Uses the correct index base', 'Applied the wrong base year to the adjustment.']] },
] as const;
const DOCUMENT_TYPES = ['memo', 'trust_agreement', 'letter', 'record'] as const;
const ANALYSIS_PROMPT = `You are grouping criterion-level benchmark failures into capability topics.

Return an abstract grouping of capabilities. Each topic needs a name, a description, and an observable verifier strategy — a rule an automated judge could apply to a fresh document.

Do not reference the specific task, document, or answer. A topic must describe a capability, not an incident.`;
const GENERATION_PROMPT = `You are writing a novel source document and a task that exercises one capability.

You will be given only a capability topic: its name, its description, and the verifier strategy that will judge the response. You will not be shown the original benchmark task, its documents, or its answer.

Write a realistic source document, a task instruction, a reference answer, and the list of targets a verifier should check.`;

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

const taskCriterionIds = new Map<string, number>();
for (const [position, criterion] of taskDefinition.criteria.entries()) {
  taskCriterionIds.set(
    criterion.id,
    await insert(
      `INSERT INTO benchmark_task_criteria (
         benchmark_id, dataset, task_id, criterion_id, title, match_criteria,
         position, source_json, created_at, updated_at
       ) VALUES (?, 'validation', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        benchmarkId,
        TASK_ID,
        criterion.id,
        criterion.title,
        criterion.match_criteria,
        position,
        JSON.stringify(criterion),
        at,
        at,
      ],
    ),
  );
}

// BR — the benchmark run.
const benchmarkRunId = await insert(
  `INSERT INTO benchmark_runs (benchmark_id, label, model, task_count,
                               settings_json, created_at, updated_at)
   VALUES (?, ?, ?, 1, ?, ?, ?)`,
  [
    benchmarkId,
    RUN.label,
    RUN.model,
    JSON.stringify(RUN.settings),
    at,
    at,
  ],
);
const benchmarkResultId = await insert(
  `INSERT INTO benchmark_results (
     benchmark_run_id, benchmark_id, outcome, tasks_total, tasks_passed, tasks_failed,
     criteria_total, criteria_passed, criteria_failed, pass_rate, reward,
     result_path, metrics_json, created_at, updated_at
   ) VALUES (?, ?, 'failed', 1, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [benchmarkRunId, benchmarkId, RUN.metrics.criteria_total, RUN.metrics.criteria_passed,
    RUN.metrics.criteria_total - RUN.metrics.criteria_passed, RUN.metrics.pass_rate,
    RUN.metrics.mean_reward,
    `results/lab/${code('benchmark_runs', benchmarkRunId)}/${RUN.model}.jsonl`, JSON.stringify(RUN.metrics), at, at],
);
const benchmarkTaskResultId = await insert(
  `INSERT INTO benchmark_task_results (
     benchmark_result_id, benchmark_id, dataset, task_id, trial_name, outcome, reward,
     criteria_total, criteria_passed, criteria_failed, result_path, metrics_json,
     created_at, updated_at
   ) VALUES (?, ?, 'validation', ?, 'trial-1', 'failed', ?, ?, ?, ?, ?, ?, ?, ?)`,
  [benchmarkResultId, benchmarkId, TASK_ID, RUN.metrics.mean_reward, RUN.metrics.criteria_total,
    RUN.metrics.criteria_passed, RUN.metrics.criteria_total - RUN.metrics.criteria_passed,
    `results/lab/${code('benchmark_runs', benchmarkRunId)}/${RUN.model}.jsonl`, JSON.stringify(RUN.metrics), at, at],
);

const fixtureFailures = new Map<string, string>(
  TOPICS.flatMap((topic) => topic.failures.map(([criterionId, , reasoning]) => [criterionId, reasoning] as const)),
);
const criterionResultIds = new Map<string, number>();
for (const criterion of taskDefinition.criteria) {
  const failureReasoning = fixtureFailures.get(criterion.id);
  criterionResultIds.set(
    criterion.id,
    await insert(
      `INSERT INTO benchmark_task_criterion_results (
         benchmark_task_result_id, benchmark_task_criterion_id, task_id, trial_name,
         criterion_id, criterion_title, verdict, reasoning, match_criteria,
         judge_model, judge_error, source_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'trial-1', ?, ?, ?, ?, ?, 'fixture/deepseek-v4-pro', 0, ?, ?, ?)`,
      [
        benchmarkTaskResultId,
        taskCriterionIds.get(criterion.id)!,
        TASK_ID,
        criterion.id,
        criterion.title,
        failureReasoning ? 'fail' : 'pass',
        failureReasoning ?? 'The seeded fixture passed this criterion.',
        criterion.match_criteria,
        JSON.stringify(criterion),
        at,
        at,
      ],
    ),
  );
}
await job('benchmark_run', 'benchmark_runs', benchmarkRunId, 'collect rollouts');

// FM — the failure map that owns the extracted topics.
const failureMapId = await insert(
  `INSERT INTO failure_maps (benchmark_result_id, prompt_revision_id, provider_model,
                             usage_json, created_at, updated_at)
   VALUES (?, ?, 'deepseek-v4-pro', ?, ?, ?)`,
  [
    benchmarkResultId,
    analysisRevision,
    JSON.stringify({ input_tokens: 18420, output_tokens: 3106 }),
    at,
    at,
  ],
);
await job('failure_map', 'failure_maps', failureMapId, 'group failed criteria');

// TP + FI — topics and the failed criteria under each.
const topicIds = new Map<string, number>();
const failureIdsByTopic = new Map<number, number[]>();

for (const topic of TOPICS) {
  const topicId = await insert(
    `INSERT INTO topics (failure_map_id, name, slug, description, verifier_strategy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [failureMapId, topic.name, topic.slug, topic.description, topic.verifier_strategy, at, at],
  );
  topicIds.set(topic.slug, topicId);

  const ids: number[] = [];
  for (const [criterionId, criterionTitle, reasoning] of topic.failures) {
    ids.push(
      await insert(
        `INSERT INTO failure_items (failure_map_id, benchmark_result_id, benchmark_task_criterion_result_id,
                                    topic_id, task_id, trial_name,
                                    criterion_id, criterion_title, reasoning, capability,
                                    severity, status, occurrences, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'trial-1', ?, ?, ?, ?, 'high', 'approved', 1, ?, ?)`,
        [failureMapId, benchmarkResultId, criterionResultIds.get(criterionId)!, topicId, TASK_ID,
          criterionId, criterionTitle, reasoning, topic.name, at, at],
      ),
    );
  }
  failureIdsByTopic.set(topicId, ids);
}

// DF + DOC — the data-forge run and the documents it produced.
const docsPerTopic = 2;
const dataForgeRunId = await insert(
  `INSERT INTO data_forge_runs (failure_map_id, prompt_revision_id, backend,
                           provider_model, docs_per_topic, novelty_threshold, auto_approve,
                           requested_documents, usage_json, created_at, updated_at)
   VALUES (?, ?, 'data_designer', 'deepseek-v4-flash', ?, 0.22, 0, ?, ?, ?, ?)`,
  [
    failureMapId,
    generationRevision,
    docsPerTopic,
    TOPICS.length * docsPerTopic,
    JSON.stringify({ input_tokens: 96410, output_tokens: 41288 }),
    at,
    at,
  ],
);
await job('data_forge_run', 'data_forge_runs', dataForgeRunId, 'generate and fingerprint');

const documentIdsByTopic = new Map<number, number[]>();

for (const topic of TOPICS) {
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
      sql: 'INSERT INTO data_forge_run_items (data_forge_run_id, failure_item_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      args: [dataForgeRunId, failureItemId],
    });

    docs.push(
      await insert(
        `INSERT INTO documents (data_forge_run_id, failure_item_id, topic_id, ordinal, title,
                                document_type, content, task_instruction, reference_answer,
                                verifier_targets_json, content_sha256, normalized_sha256,
                                word_count, max_similarity, nearest_source, novelty_status,
                                review_status, role, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'passed', 'approved', 'train', ?, ?)`,
        [
          dataForgeRunId,
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

for (const topic of TOPICS) {
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
    `INSERT INTO environments (benchmark_run_id, topic_id, verifier_id, name, slug, status,
                               base_model, inference_model, local_path, package_hash,
                               scale_ready, taskset_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'built', ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      benchmarkRunId,
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
  `INSERT INTO environment_evaluations (benchmark_run_id, kind, model, endpoint_label,
                                        rollouts_per_example, max_concurrent,
                                        environment_ids_json, metrics_json, created_at, updated_at)
   VALUES (?, 'validation', ?, 'local', 4, 1, ?, ?, ?, ?)`,
  [
    benchmarkRunId,
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

console.log(`✓ seeded ${code('benchmark_runs', benchmarkRunId)} "${RUN.label}" / ${RUN.model}`);
for (const table of [
  'failure_maps',
  'failure_items',
  'topics',
  'data_forge_runs',
  'documents',
  'verifiers',
  'environments',
  'jobs',
]) {
  console.log(`    ${String(await count(table)).padStart(3)}  ${table}`);
}

process.exit(0);
