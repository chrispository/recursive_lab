import { db, now, one, type Row } from '../../db/client.ts';
import type { PromptRevision } from './model.ts';

type PromptDb = Row & {
  prompt_revision_id: number;
  prompt_key: string;
  revision_number: number;
  body: string;
  model_hint: string;
};

function toPrompt(row: PromptDb): PromptRevision {
  return {
    promptRevisionId: row.prompt_revision_id,
    promptKey: row.prompt_key,
    revisionNumber: row.revision_number,
    body: row.body,
    modelHint: row.model_hint,
  };
}

const SELECT = `SELECT r.id AS prompt_revision_id, t.prompt_key, r.revision_number, r.body, r.model_hint
                  FROM prompt_revisions r
                  JOIN prompt_templates t ON t.id = r.template_id`;

export async function findActive(promptKey: string): Promise<PromptRevision | null> {
  const row = await one<PromptDb>(
    `${SELECT}
      WHERE t.prompt_key = ? AND r.is_active = 1`,
    [promptKey],
  );
  return row ? toPrompt(row) : null;
}

export async function list(promptKey: string): Promise<PromptRevision[]> {
  const result = await db.execute({
    sql: `${SELECT} WHERE t.prompt_key = ? ORDER BY r.revision_number ASC`,
    args: [promptKey],
  });
  return (result.rows as unknown as PromptDb[]).map(toPrompt);
}

export async function find(promptKey: string, promptRevisionId: number): Promise<PromptRevision | null> {
  const row = await one<PromptDb>(
    `${SELECT} WHERE t.prompt_key = ? AND r.id = ?`,
    [promptKey, promptRevisionId],
  );
  return row ? toPrompt(row) : null;
}

export async function createRevision(input: {
  promptKey: string;
  body: string;
  modelHint: string;
}): Promise<PromptRevision> {
  const tx = await db.transaction('write');
  try {
    const template = await tx.execute({
      sql: 'SELECT id FROM prompt_templates WHERE prompt_key = ?',
      args: [input.promptKey],
    });
    const templateId = (template.rows[0] as { id?: number } | undefined)?.id;
    if (!templateId) throw new Error(`Prompt template '${input.promptKey}' was not found.`);

    const next = await tx.execute({
      sql: 'SELECT coalesce(max(revision_number), 0) + 1 AS revision_number FROM prompt_revisions WHERE template_id = ?',
      args: [templateId],
    });
    const revisionNumber = Number((next.rows[0] as { revision_number?: number } | undefined)?.revision_number ?? 1);
    await tx.execute({
      sql: 'UPDATE prompt_revisions SET is_active = 0 WHERE template_id = ?',
      args: [templateId],
    });
    const inserted = await tx.execute({
      sql: `INSERT INTO prompt_revisions
              (template_id, revision_number, body, model_hint, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, ?)`,
      args: [templateId, revisionNumber, input.body, input.modelHint, now()],
    });
    await tx.commit();
    return {
      promptRevisionId: Number(inserted.lastInsertRowid),
      promptKey: input.promptKey,
      revisionNumber,
      body: input.body,
      modelHint: input.modelHint,
    };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}
