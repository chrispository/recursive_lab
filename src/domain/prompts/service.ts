import * as repo from './repo.ts';
import * as audit from '../audit/service.ts';

export type { PromptRevision } from './model.ts';

export const active = repo.findActive;
export const list = repo.list;
export const byId = repo.find;

export class PromptError extends Error {}

export async function saveAsNewRevision(input: {
  promptKey: string;
  body: string;
  modelHint?: string;
}) {
  const body = input.body.trim();
  if (!body) throw new PromptError('Prompt body cannot be empty.');
  const revision = await repo.createRevision({
    promptKey: input.promptKey,
    body,
    modelHint: input.modelHint?.trim() ?? '',
  });
  await audit.audit('prompt_revisions', revision.promptRevisionId, 'create', {
    promptKey: revision.promptKey,
    revisionNumber: revision.revisionNumber,
  });
  return revision;
}
