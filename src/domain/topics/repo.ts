/** SQL for topics. */
import { all, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { TopicRow } from './model.ts';

type DbTopic = Row & {
  id: number;
  name: string;
  slug: string;
  description: string;
  verifier_strategy: string;
  status: 'active' | 'archived';
  failure_count: number;
  document_count: number;
  reward: number | null;
  pass_threshold: number | null;
};

/**
 * Membership comes from taxonomy_topics, never from the topics table alone —
 * topics are global rows and appearing in one taxonomy says nothing about
 * another. `reward` is read from the newest validation for the topic's
 * environment; a topic that has never been proved reads null, not zero.
 */
const SELECT = `
  SELECT tp.id, tp.name, tp.slug, tp.description, tp.verifier_strategy, tp.status,
         (SELECT count(*) FROM failure_items fi WHERE fi.topic_id = tp.id) AS failure_count,
         (SELECT count(*) FROM documents d      WHERE d.topic_id  = tp.id) AS document_count,
         vf.pass_threshold AS pass_threshold,
         (SELECT json_extract(ee.metrics_json, '$.per_topic.' || tp.slug)
            FROM environment_evaluations ee
           ORDER BY ee.created_at DESC LIMIT 1) AS reward
    FROM taxonomy_topics tt
    JOIN topics tp ON tp.id = tt.topic_id
    LEFT JOIN verifiers vf ON vf.topic_id = tp.id AND vf.status = 'ready'`;

const toTopic = (row: DbTopic): TopicRow => ({
  id: row.id,
  code: code('topics', row.id),
  name: row.name,
  slug: row.slug,
  description: row.description,
  verifierStrategy: row.verifier_strategy,
  status: row.status,
  failureCount: row.failure_count,
  documentCount: row.document_count,
  reward: row.reward,
  passThreshold: row.pass_threshold,
});

/** Topics in one taxonomy, most-failed first — the order the table shows. */
export async function listByTaxonomy(taxonomyId: number): Promise<TopicRow[]> {
  const rows = await all<DbTopic>(
    `${SELECT} WHERE tt.taxonomy_id = ? ORDER BY failure_count DESC, tp.name ASC`,
    [taxonomyId],
  );
  return rows.map(toTopic);
}
