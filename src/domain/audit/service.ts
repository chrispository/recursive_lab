/**
 * The audit trail.
 *
 * Every service that changes a domain row records what it did here, so the
 * question "why does this row look like this?" has an answer that does not
 * depend on anyone having kept a terminal open.
 */
import type { Entity } from '../../db/ids.ts';
import * as repo from './repo.ts';

export type { AuditEvent } from './model.ts';

export const audit = (
  entityType: Entity,
  entityId: number,
  action: string,
  details: Record<string, unknown> = {},
) => repo.insertEvent(entityType, entityId, action, details);

export const history = repo.listForEntity;
