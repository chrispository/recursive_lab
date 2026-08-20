import type { Entity } from '../../db/ids.ts';

/** One recorded change to a domain row. */
export type AuditEvent = {
  entityType: Entity;
  entityCode: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};
