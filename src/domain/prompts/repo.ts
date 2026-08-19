import { one, type Row } from '../../db/client.ts';
import type { PromptRevision } from './model.ts';

type PromptDb = Row & {
  prompt_revision_id: number;
  prompt_key: string;
  revision_number: number;
  body: string;
  model_hint: string;
};

export async function findActive(promptKey: string): Promise<PromptRevision | null> {
  const row = await one<PromptDb>(
    `SELECT r.id AS prompt_revision_id, t.prompt_key, r.revision_number, r.body, r.model_hint
       FROM prompt_revisions r
       JOIN prompt_templates t ON t.id = r.template_id
      WHERE t.prompt_key = ? AND r.is_active = 1`,
    [promptKey],
  );
  return row
    ? {
        promptRevisionId: row.prompt_revision_id,
        promptKey: row.prompt_key,
        revisionNumber: row.revision_number,
        body: row.body,
        modelHint: row.model_hint,
      }
    : null;
}
