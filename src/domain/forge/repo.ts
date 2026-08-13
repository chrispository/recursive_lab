import { all, json, one, type Row } from '../../db/client.ts';
import { code, parse } from '../../db/ids.ts';
import type { DocumentRow, ForgeSummary } from './model.ts';

type ForgeDb = Row & {
  forge_id: number;
  failure_map_id: number;
  taxonomy_id: number;
  taxonomy_name: string;
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
};

const FORGE_SELECT = `
  SELECT df.id AS forge_id, df.failure_map_id, df.taxonomy_id, tx.name AS taxonomy_name,
         df.backend, df.provider_model, df.docs_per_topic, df.novelty_threshold,
         df.auto_approve, df.requested_documents, df.usage_json,
         (SELECT count(*) FROM documents d WHERE d.forge_run_id = df.id) AS created_documents,
         (SELECT count(*) FROM documents d WHERE d.forge_run_id = df.id AND d.novelty_status = 'passed') AS novel_documents,
         (SELECT count(*) FROM documents d WHERE d.forge_run_id = df.id AND d.review_status = 'pending') AS pending_review,
         (SELECT count(*) FROM documents d WHERE d.forge_run_id = df.id AND d.novelty_status = 'rejected') AS rejected_documents
    FROM forge_runs df
    JOIN taxonomies tx ON tx.id = df.taxonomy_id`;

const toForge = (row: ForgeDb): ForgeSummary => {
  const usage = json<{ input_tokens?: number; output_tokens?: number }>(row.usage_json, {});
  return {
    forgeCode: code('forge_runs', row.forge_id),
    failureMapCode: code('failure_maps', row.failure_map_id),
    taxonomyCode: code('taxonomies', row.taxonomy_id),
    taxonomyName: row.taxonomy_name,
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

export async function findByRun(runId: number): Promise<ForgeSummary | null> {
  const row = await one<ForgeDb>(
    `${FORGE_SELECT} JOIN failure_maps fm ON fm.id = df.failure_map_id WHERE fm.run_id = ?`,
    [runId],
  );
  return row ? toForge(row) : null;
}

export async function listDocuments(forgeCode: string): Promise<DocumentRow[]> {
  const parsed = parse(forgeCode);
  if (!parsed || parsed.entity !== 'forge_runs') return [];
  const forgeId = parsed.id;
  const rows = await all<DocumentDb>(
    `SELECT d.id, d.topic_id, tp.name AS topic_name, d.title, d.document_type,
            d.novelty_status, d.review_status, d.role, d.word_count, d.max_similarity
       FROM documents d
       JOIN topics tp ON tp.id = d.topic_id
      WHERE d.forge_run_id = ?
      ORDER BY tp.name ASC, d.ordinal ASC`,
    [forgeId],
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
  }));
}
