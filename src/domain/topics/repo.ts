/** SQL for topics. */
import { all, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { TopicRow } from './model.ts';

type DbTopic = Row & {
  id: number;
  failure_map_id: number;
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
 * Topics are scoped to the failure map that produced them. `reward` is read
 * from the newest validation for the topic's environment; a topic that has
 * never been proved reads null, not zero.
 */
const SELECT = `
  SELECT tp.id, tp.failure_map_id, tp.name, tp.slug, tp.description, tp.verifier_strategy, tp.status,
         (SELECT count(*) FROM failure_items fi WHERE fi.topic_id = tp.id AND fi.failure_map_id = tp.failure_map_id) AS failure_count,
         (SELECT count(*) FROM documents d      WHERE d.topic_id  = tp.id) AS document_count,
         vf.pass_threshold AS pass_threshold,
         (SELECT json_extract(ee.metrics_json, '$.per_topic.' || tp.slug)
            FROM environment_evaluations ee
           ORDER BY ee.created_at DESC LIMIT 1) AS reward
    FROM topics tp
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

/** Topics extracted from one failure map, most-failed first. */
export async function listByFailureMap(failureMapId: number): Promise<TopicRow[]> {
  const rows = await all<DbTopic>(
    `${SELECT}
      WHERE tp.failure_map_id = ?
        AND EXISTS (
          SELECT 1 FROM failure_items fi0
           WHERE fi0.topic_id = tp.id AND fi0.failure_map_id = tp.failure_map_id
        )
      ORDER BY failure_count DESC, tp.name ASC`,
    [failureMapId],
  );
  return rows.map(toTopic);
}

/** Failed criteria that have not been assigned to a topic in this failure map. */
export async function countUncategorised(failureMapId: number): Promise<number> {
  const row = await all<{ count: number }>(
    `SELECT count(*) AS count
       FROM failure_items fi
      WHERE fi.failure_map_id = ? AND fi.topic_id IS NULL`,
    [failureMapId],
  );
  return row[0]?.count ?? 0;
}
