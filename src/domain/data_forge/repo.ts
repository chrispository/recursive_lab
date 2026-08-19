import { all, db, insert, json, now, one, run, type Row } from '../../db/client.ts';
import { code, parse } from '../../db/ids.ts';
import type { DataForgeSummary, DocumentRow, ForgeTopicInput } from './model.ts';

type DataForgeDb = Row & {
  data_forge_run_id: number;
  failure_map_id: number;
  prompt_revision_id: number;
  topic_count: number;
  backend: 'data_designer' | 'frontier';
  provider_model: string;
  docs_per_topic: number;
  novelty_threshold: number;
  auto_approve: number;
  requested_documents: number;
  usage_json: string;
  created_documents: number;
  novel_documents: number;
  pending_review: number;
  rejected_documents: number;
};

type DocumentDb = Row & {
  id: number;
  topic_id: number;
  topic_name: string;
  title: string;
  document_type: string;
  novelty_status: DocumentRow['noveltyStatus'];
  review_status: DocumentRow['reviewStatus'];
  role: DocumentRow['role'];
  word_count: number;
  max_similarity: number;
  content: string;
  task_instruction: string;
  reference_answer: string;
  verifier_targets_json: string;
};

export type ForgeContext = {
  dataForgeRunId: number | null;
  promptRevisionId: number | null;
  failureMapId: number;
  benchmarkResultId: number;
  benchmarkId: number;
  providerModel: string;
  backend: 'data_designer' | 'frontier';
  docsPerTopic: number;
  noveltyThreshold: number;
  autoApprove: boolean;
  requestedDocuments: number;
};

type TopicDb = Row & {
  id: number;
  name: string;
  slug: string;
  description: string;
  verifier_strategy: string;
  failure_count: number;
  filled_count: number;
};

type FailureItemDb = Row & { id: number; topic_id: number };

type SourceDb = Row & {
  content_sha256: string;
  normalized_sha256: string;
  shingles_json: string;
};

const DATA_FORGE_SELECT = `
  SELECT df.id AS data_forge_run_id, df.failure_map_id, df.prompt_revision_id,
         df.backend, df.provider_model, df.docs_per_topic, df.novelty_threshold,
         df.auto_approve, df.requested_documents, df.usage_json,
         (SELECT count(*) FROM topics tp WHERE tp.failure_map_id = df.failure_map_id) AS topic_count,
         (SELECT count(*) FROM documents d WHERE d.data_forge_run_id = df.id) AS created_documents,
         (SELECT count(*) FROM documents d WHERE d.data_forge_run_id = df.id AND d.novelty_status = 'passed') AS novel_documents,
         (SELECT count(*) FROM documents d WHERE d.data_forge_run_id = df.id
            AND d.novelty_status = 'passed' AND d.review_status = 'pending') AS pending_review,
         (SELECT count(*) FROM documents d WHERE d.data_forge_run_id = df.id AND d.novelty_status = 'rejected') AS rejected_documents
    FROM data_forge_runs df`;

const toDataForge = (row: DataForgeDb): DataForgeSummary => {
  const usage = json<{ input_tokens?: number; output_tokens?: number }>(row.usage_json, {});
  return {
    dataForgeCode: code('data_forge_runs', row.data_forge_run_id),
    failureMapCode: code('failure_maps', row.failure_map_id),
    promptRevisionId: row.prompt_revision_id,
    topicCount: row.topic_count,
    backend: row.backend,
    providerModel: row.provider_model,
    docsPerTopic: row.docs_per_topic,
    noveltyThreshold: row.novelty_threshold,
    autoApprove: row.auto_approve === 1,
    requestedDocuments: row.requested_documents,
    createdDocuments: row.created_documents,
    novelDocuments: row.novel_documents,
    pendingReview: row.pending_review,
    rejectedDocuments: row.rejected_documents,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
};

export async function findByBenchmarkRun(benchmarkRunId: number): Promise<DataForgeSummary | null> {
  const row = await one<DataForgeDb>(
    `${DATA_FORGE_SELECT}
       JOIN failure_maps fm ON fm.id = df.failure_map_id
       JOIN benchmark_results brs ON brs.id = fm.benchmark_result_id
      WHERE brs.benchmark_run_id = ?
      ORDER BY df.created_at DESC, df.id DESC`,
    [benchmarkRunId],
  );
  return row ? toDataForge(row) : null;
}

const CONTEXT_SELECT = `
  SELECT fm.id AS failure_map_id, br.id AS benchmark_result_id, br.benchmark_id,
         df.id AS data_forge_run_id, df.prompt_revision_id, df.backend, df.provider_model,
         df.docs_per_topic, df.novelty_threshold, df.auto_approve,
         df.requested_documents
    FROM failure_maps fm
    JOIN benchmark_results br ON br.id = fm.benchmark_result_id
    LEFT JOIN data_forge_runs df ON df.failure_map_id = fm.id
`;

export async function forgeContext(benchmarkRunId: number): Promise<ForgeContext | null> {
  const row = await one<Row & {
    failure_map_id: number;
    benchmark_result_id: number;
    benchmark_id: number;
    data_forge_run_id: number | null;
    prompt_revision_id: number | null;
    backend: 'data_designer' | 'frontier' | null;
    provider_model: string | null;
    docs_per_topic: number | null;
    novelty_threshold: number | null;
    auto_approve: number | null;
    requested_documents: number | null;
  }>(`${CONTEXT_SELECT} WHERE br.benchmark_run_id = ?`, [benchmarkRunId]);
  if (!row) return null;
  return {
    dataForgeRunId: row.data_forge_run_id,
    promptRevisionId: row.prompt_revision_id,
    failureMapId: row.failure_map_id,
    benchmarkResultId: row.benchmark_result_id,
    benchmarkId: row.benchmark_id,
    providerModel: row.provider_model ?? '',
    backend: row.backend ?? 'data_designer',
    docsPerTopic: row.docs_per_topic ?? 3,
    noveltyThreshold: row.novelty_threshold ?? 0.22,
    autoApprove: row.auto_approve === 1,
    requestedDocuments: row.requested_documents ?? 0,
  };
}

export async function topicsForRun(
  benchmarkRunId: number,
  dataForgeRunId: number | null,
  docsPerTopicOverride?: number,
): Promise<ForgeTopicInput[]> {
  const rows = await all<TopicDb>(
    `SELECT tp.id, tp.name, tp.slug, tp.description, tp.verifier_strategy,
            (SELECT count(*) FROM failure_items fi
              WHERE fi.failure_map_id = fm.id AND fi.topic_id = tp.id) AS failure_count,
            (SELECT count(*) FROM documents d
              WHERE d.data_forge_run_id = ? AND d.topic_id = tp.id
                AND d.novelty_status = 'passed') AS filled_count
       FROM topics tp
       JOIN failure_maps fm ON fm.id = tp.failure_map_id
       JOIN benchmark_results br ON br.id = fm.benchmark_result_id
      WHERE br.benchmark_run_id = ? AND tp.status = 'active'
        AND EXISTS (SELECT 1 FROM failure_items fi0
                     WHERE fi0.failure_map_id = fm.id AND fi0.topic_id = tp.id)
      ORDER BY tp.name ASC`,
    [dataForgeRunId ?? 0, benchmarkRunId],
  );
  const context = dataForgeRunId
    ? await one<Row & { docs_per_topic: number }>('SELECT docs_per_topic FROM data_forge_runs WHERE id = ?', [dataForgeRunId])
    : null;
  const docsPerTopic = docsPerTopicOverride ?? context?.docs_per_topic ?? 3;
  return rows.map((row) => ({
    topicId: row.id,
    topicCode: code('topics', row.id),
    name: row.name,
    description: row.description,
    verifierStrategy: row.verifier_strategy,
    remaining: Math.max(0, docsPerTopic - row.filled_count),
  }));
}

export async function failureItemsByTopic(failureMapId: number): Promise<Map<number, number>> {
  const rows = await all<FailureItemDb>(
    `SELECT id, topic_id FROM failure_items
      WHERE failure_map_id = ? AND topic_id IS NOT NULL
      ORDER BY topic_id ASC, id ASC`,
    [failureMapId],
  );
  const result = new Map<number, number>();
  for (const row of rows) if (!result.has(row.topic_id)) result.set(row.topic_id, row.id);
  return result;
}

export async function createRun(input: {
  failureMapId: number;
  promptRevisionId: number;
  backend: 'data_designer' | 'frontier';
  providerModel: string;
  docsPerTopic: number;
  noveltyThreshold: number;
  autoApprove: boolean;
  requestedDocuments: number;
}): Promise<number> {
  const at = now();
  const tx = await db.transaction('write');
  try {
    const result = await tx.execute({
      sql: `INSERT INTO data_forge_runs
              (failure_map_id, prompt_revision_id, backend, provider_model,
               docs_per_topic, novelty_threshold, auto_approve,
               requested_documents, usage_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      args: [
        input.failureMapId,
        input.promptRevisionId,
        input.backend,
        input.providerModel,
        input.docsPerTopic,
        input.noveltyThreshold,
        input.autoApprove ? 1 : 0,
        input.requestedDocuments,
        at,
        at,
      ],
    });
    const dataForgeRunId = Number(result.lastInsertRowid);
    const items = await tx.execute({
      sql: `SELECT id FROM failure_items WHERE failure_map_id = ? AND topic_id IS NOT NULL`,
      args: [input.failureMapId],
    });
    for (const row of items.rows as unknown as Array<{ id: number }>) {
      await tx.execute({
        sql: `INSERT INTO data_forge_run_items (data_forge_run_id, failure_item_id) VALUES (?, ?)`,
        args: [dataForgeRunId, row.id],
      });
    }
    await tx.commit();
    return dataForgeRunId;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

export async function nextOrdinal(dataForgeRunId: number, topicId: number): Promise<number> {
  const row = await one<Row & { next_ordinal: number }>(
    `SELECT coalesce(max(ordinal), 0) + 1 AS next_ordinal
       FROM documents WHERE data_forge_run_id = ? AND topic_id = ?`,
    [dataForgeRunId, topicId],
  );
  return row?.next_ordinal ?? 1;
}

export async function sourceFingerprints(benchmarkRunId: number): Promise<Array<{ normalizedSha256: string; contentSha256: string; shingles: string[] }>> {
  const rows = await all<SourceDb>(
    `SELECT DISTINCT bs.content_sha256, bs.normalized_sha256, bs.shingles_json
       FROM benchmark_sources bs
       JOIN benchmark_run_tasks brt ON brt.task_id = bs.task_id
       JOIN benchmark_results br ON br.benchmark_id = brt.benchmark_id
                              AND br.benchmark_run_id = brt.benchmark_run_id
      WHERE br.benchmark_run_id = ?`,
    [benchmarkRunId],
  );
  return rows.map((row) => ({
    normalizedSha256: row.normalized_sha256,
    contentSha256: row.content_sha256,
    shingles: shinglesOf(row.shingles_json),
  }));
}

export async function insertDocument(input: {
  dataForgeRunId: number;
  failureItemId: number;
  topicId: number;
  ordinal: number;
  title: string;
  documentType: string;
  content: string;
  taskInstruction: string;
  referenceAnswer: string;
  verifierTargets: string[];
  contentSha256: string;
  normalizedSha256: string;
  shingles: string[];
  wordCount: number;
  maxSimilarity: number;
  noveltyThreshold: number;
  nearestSource: string | null;
  noveltyStatus: DocumentRow['noveltyStatus'];
  autoApprove: boolean;
}): Promise<number> {
  return insert(
    `INSERT INTO documents
       (data_forge_run_id, failure_item_id, topic_id, ordinal, title, document_type,
        content, task_instruction, reference_answer, verifier_targets_json,
        content_sha256, normalized_sha256, shingles_json, word_count, max_similarity,
        nearest_source, novelty_status, novelty_json, review_status, role,
        generation_attempt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      input.dataForgeRunId,
      input.failureItemId,
      input.topicId,
      input.ordinal,
      input.title,
      input.documentType,
      input.content,
      input.taskInstruction,
      input.referenceAnswer,
      JSON.stringify(input.verifierTargets),
      input.contentSha256,
      input.normalizedSha256,
      JSON.stringify(input.shingles),
      input.wordCount,
      input.maxSimilarity,
      input.nearestSource,
      input.noveltyStatus,
      JSON.stringify({ maxSimilarity: input.maxSimilarity, threshold: input.noveltyThreshold }),
      input.noveltyStatus === 'rejected'
        ? 'rejected'
        : input.autoApprove
          ? 'approved'
          : 'pending',
      input.noveltyStatus === 'rejected' ? 'excluded' : 'train',
      now(),
    ],
  );
}

function shinglesOf(raw: string): string[] {
  const value = json<unknown>(raw, []);
  if (Array.isArray(value)) return value.map(String);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap((part) => Array.isArray(part) ? part.map(String) : []);
}

export async function updateUsage(dataForgeRunId: number, usage: Record<string, unknown>): Promise<void> {
  await run(
    `UPDATE data_forge_runs SET usage_json = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(usage), now(), dataForgeRunId],
  );
}

export async function reviewDocument(documentId: number, reviewStatus: 'approved' | 'rejected'): Promise<{ dataForgeRunId: number; noveltyStatus: DocumentRow['noveltyStatus'] } | null> {
  const row = await reviewState(documentId);
  if (!row) return null;
  await run(
    `UPDATE documents
        SET review_status = ?, role = ?, reviewed_at = ?
      WHERE id = ?`,
    [reviewStatus, reviewStatus === 'approved' ? 'train' : 'excluded', now(), documentId],
  );
  return row;
}

export async function reviewState(documentId: number): Promise<{ dataForgeRunId: number; noveltyStatus: DocumentRow['noveltyStatus'] } | null> {
  const row = await one<Row & { data_forge_run_id: number; novelty_status: DocumentRow['noveltyStatus'] }>(
    `SELECT data_forge_run_id, novelty_status FROM documents WHERE id = ?`,
    [documentId],
  );
  if (!row) return null;
  return { dataForgeRunId: row.data_forge_run_id, noveltyStatus: row.novelty_status };
}

export async function listDocuments(dataForgeCode: string): Promise<DocumentRow[]> {
  const parsed = parse(dataForgeCode);
  if (!parsed || parsed.entity !== 'data_forge_runs') return [];
  const dataForgeId = parsed.id;
  const rows = await all<DocumentDb>(
    `SELECT d.id, d.topic_id, tp.name AS topic_name, d.title, d.document_type,
            d.content, d.task_instruction, d.reference_answer, d.verifier_targets_json,
            d.novelty_status, d.review_status, d.role, d.word_count, d.max_similarity
       FROM documents d
       JOIN topics tp ON tp.id = d.topic_id
      WHERE d.data_forge_run_id = ?
      ORDER BY tp.name ASC, d.ordinal ASC`,
    [dataForgeId],
  );
  return rows.map((row) => ({
    documentCode: code('documents', row.id),
    topicCode: code('topics', row.topic_id),
    topicName: row.topic_name,
    title: row.title,
    documentType: row.document_type,
    noveltyStatus: row.novelty_status,
    reviewStatus: row.review_status,
    role: row.role,
    wordCount: row.word_count,
    maxSimilarity: row.max_similarity,
    content: row.content,
    taskInstruction: row.task_instruction,
    referenceAnswer: row.reference_answer,
    verifierTargets: json<string[]>(row.verifier_targets_json, []),
  }));
}
