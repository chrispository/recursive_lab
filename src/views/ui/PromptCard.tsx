import type { PromptRevision } from '../../domain/prompts/model.ts';
import { Icon } from './Icon.tsx';

export function PromptCard({
  prompt,
  revisions,
  benchmarkRunId,
  promptRevisionLocked,
  notice = '',
  noticeKind = 'success',
  promptKey = 'document-generation',
  title = 'Document generation prompt',
  dialogId = 'document-generation-prompt-editor',
  cardId = 'forge-prompt-card',
  targetInputId = 'forge-prompt-revision',
  promptUrl = '/ui/data-forge/prompt',
  revisionsUrl = '/ui/data-forge/prompt/revisions',
}: {
  prompt: PromptRevision | null;
  revisions: PromptRevision[];
  benchmarkRunId: number | null;
  promptRevisionLocked: boolean;
  notice?: string;
  noticeKind?: 'success' | 'error';
  promptKey?: string;
  title?: string;
  dialogId?: string;
  cardId?: string;
  targetInputId?: string;
  promptUrl?: string;
  revisionsUrl?: string;
}) {
  const subtitle = promptRevisionLocked
    ? 'This run is pinned to its original revision.'
    : 'Choose a revision to inspect or use for the next run.';

  return (
    <section id={cardId} class="m-forge-card m-prompt-card">
      <div class="m-forge-card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div class="m-prompt-tools">
          {revisions.length ? (
            <form class="m-prompt-revision-picker">
              <input type="hidden" name="benchmark_run_id" value={benchmarkRunId ? String(benchmarkRunId) : ''} />
              <select
                name="prompt_revision_id"
                data-prompt-revision
                data-target-input={targetInputId}
                aria-label={`${title} revision`}
                disabled={promptRevisionLocked}
                hx-get={promptUrl}
                hx-trigger="change"
                hx-target={`#${cardId}`}
                hx-swap="outerHTML"
                hx-include="closest form"
              >
                {revisions.map((revision) => (
                  <option value={String(revision.promptRevisionId)} selected={revision.promptRevisionId === prompt?.promptRevisionId}>
                    REV-{String(revision.revisionNumber).padStart(5, '0')}
                  </option>
                ))}
              </select>
            </form>
          ) : <span class="m-code">missing</span>}
          <button type="button" class="ghost compact m-prompt-settings" data-open-dialog={dialogId} aria-label="Edit prompt" title="Edit prompt" disabled={!prompt}>
            <Icon name="settings" />
          </button>
        </div>
      </div>
      {notice ? <p class={`m-prompt-notice ${noticeKind === 'error' ? 'is-error' : ''}`}>{notice}</p> : null}
      {prompt ? <textarea class="m-ta m-prompt-editor" readonly>{prompt.body}</textarea> : <div class="m-empty">The prompt is missing.</div>}
      <p class="m-field-note">Saving creates a new immutable revision and makes it active. Existing runs stay pinned to their original revision.</p>
      {prompt ? (
        <dialog id={dialogId} class="m-dialog m-prompt-dialog">
          <div class="m-dialog-head">
            <div>
              <span class="m-id">REV-{String(prompt.revisionNumber).padStart(5, '0')}</span>
              <strong>Edit {title.toLowerCase()}</strong>
              <span class="m-dialog-sub">Save as a new revision; the current revision remains immutable.</span>
            </div>
            <button type="button" class="ghost compact" data-close-dialog aria-label="Close"><Icon name="close" /></button>
          </div>
          <form class="m-dialog-body m-prompt-form" hx-post={revisionsUrl} hx-target={`#${cardId}`} hx-swap="outerHTML" hx-disabled-elt="find button">
            <input type="hidden" name="benchmark_run_id" value={benchmarkRunId ? String(benchmarkRunId) : ''} />
            <input type="hidden" name="prompt_revision_id" value={String(prompt.promptRevisionId)} />
            <input type="hidden" name="prompt_key" value={promptKey} />
            <label class="m-prompt-label" for={`${dialogId}-body`}>Prompt body</label>
            <textarea id={`${dialogId}-body`} name="body" class="m-ta m-prompt-dialog-editor" required>{prompt.body}</textarea>
            <label class="m-prompt-label" for={`${dialogId}-model-hint`}>Model hint <span>(optional)</span></label>
            <input id={`${dialogId}-model-hint`} name="model_hint" value={prompt.modelHint} />
            <div class="m-dialog-actions">
              <button type="button" class="ghost compact" data-close-dialog>Cancel</button>
              <button type="submit" class="compact">Save as new revision</button>
            </div>
          </form>
        </dialog>
      ) : null}
    </section>
  );
}
