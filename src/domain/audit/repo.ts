import { all, now, run, type Row } from '../../db/client.ts';
import { code, type Entity } from '../../db/ids.ts';
import type { AuditEvent } from './model.ts';

type AuditDb = Row & {
  entity_type: string;
  entity_id: number;
  action: string;
  details_json: string;
  created_at: string;
};

export async function insertEvent(
  entityType: Entity,
  entityId: number,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await run(
    `INSERT INTO audit_events (entity_type, entity_id, action, details_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entityType, entityId, action, JSON.stringify(details), now()],
  );
}

export async function listForEntity(entityType: Entity, entityId: number): Promise<AuditEvent[]> {
  const rows = await all<AuditDb>(
    `SELECT entity_type, entity_id, action, details_json, created_at
       FROM audit_events
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC, id DESC`,
    [entityType, entityId],
  );
  return rows.map((row) => ({
    entityType: row.entity_type as Entity,
    entityCode: code(row.entity_type as Entity, row.entity_id),
    action: row.action,
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}
