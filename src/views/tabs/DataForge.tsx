import type { PromptRevision } from '../../domain/prompts/model.ts';
import type { DataForgeSummary, DocumentRow } from '../../domain/data_forge/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { isLive, type JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Bar } from '../ui/Bar.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Id } from '../ui/Id.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';

export function DataForge({
  benchmarkRun,
  progress,
  availableRuns,
  dataForge,
  documents,
  forgeJob,
  generationBackend,
  generationModel,
  generationConfigured,
  prompt,
  promptRevisions,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  availableRuns: BenchmarkRunSummary[];
  dataForge: DataForgeSummary | null;
  documents: DocumentRow[];
  forgeJob: JobRow | null;
  generationBackend: 'data_designer' | 'frontier';
  generationModel: string;
  generationConfigured: boolean;
  prompt: PromptRevision | null;
  promptRevisions: PromptRevision[];
}) {
  const complete = Boolean(dataForge && dataForge.novelDocuments >= dataForge.requestedDocuments);
  const running = isLive(forgeJob);
  const canStart = Boolean(
    benchmarkRun && progress?.failureMap.entity && generationConfigured && Boolean(prompt) && !running && !complete,
  );

  return (
    <>
      <div class="m-title">
        <h2>Data forge novel training documents</h2>
        <p>Generation receives abstract capability specs only. Every artifact is fingerprinted against its benchmark lineage.</p>
      </div>
      <RunContext benchmarkRun={benchmarkRun} progress={progress} availableRuns={availableRuns} />

      <div class="m-forge-layout">
        <ForgeConfig
          benchmarkRun={benchmarkRun}
          dataForge={dataForge}
          forgeJob={forgeJob}
          failureMapCode={progress?.failureMap.entity ?? null}
          backend={generationBackend}
          model={generationModel}
          generationConfigured={generationConfigured}
          canStart={canStart}
          promptRevisionId={prompt?.promptRevisionId ?? null}
        />
        <PromptCard
          prompt={prompt}
          revisions={promptRevisions}
          benchmarkRunId={benchmarkRun?.benchmarkRunId ?? null}
          promptRevisionLocked={Boolean(dataForge)}
        />
      </div>

      <DataForgeStatus
        runId={benchmarkRun?.benchmarkRunId ?? null}
        job={forgeJob}
        progress={progress}
      />

      <TableBox>
        <Cap title="Data forge ledger">
          <Tally items={[
            { value: dataForge?.requestedDocuments ?? 0, label: 'requested' },
            { value: dataForge?.createdDocuments ?? 0, label: 'created' },
            { value: dataForge?.novelDocuments ?? 0, label: 'novel', hot: true },
            { value: dataForge?.rejectedDocuments ?? 0, label: 'rejected' },
            { value: dataForge?.pendingReview ?? 0, label: 'review' },
          ]} />
        </Cap>
        {dataForge ? (
          <Table>
            <thead><tr><th>Data forge</th><th>Failure map</th><th class="n">Topics</th><th>Backend</th><th>Provider model</th><th class="n">Docs/topic</th><th>Status</th></tr></thead>
            <tbody><tr data-state={running ? 'running' : dataForge.pendingReview ? 'pending' : complete ? 'succeeded' : 'failed'}>
              <td><span class="nm">{dataForge.dataForgeCode}</span><span class="sub">from {dataForge.failureMapCode}</span></td>
              <td>{dataForge.failureMapCode}</td>
              <td class="n">{dataForge.topicCount}</td>
              <td>{dataForge.backend.replaceAll('_', ' ')}</td>
              <td><span class="m-id">{dataForge.providerModel}</span></td>
              <td class="n">{dataForge.docsPerTopic}</td>
              <td><Badge state={running ? 'running' : forgeJob?.status === 'failed' ? 'failed' : dataForge.pendingReview ? 'pending' : complete ? 'succeeded' : 'draft'}>
                {running ? forgeJob?.step || 'generating' : forgeJob?.status === 'failed' ? 'failed' : dataForge.pendingReview ? 'review' : complete ? 'complete' : 'incomplete'}
              </Badge></td>
            </tr></tbody>
          </Table>
        ) : <div class="m-empty">No data forge run for the current failure map. Configure the generation card above to begin.</div>}
      </TableBox>

      <TableBox>
        <Cap title="Document ledger" code={`${documents.length} artifacts`} />
        {documents.length ? (
          <Table>
            <thead><tr><th>Document</th><th>Topic</th><th>Type</th><th class="n">Words</th><th class="n">Similarity</th><th>Novelty</th><th>Review</th></tr></thead>
            <tbody>{documents.map((document) => (
              <tr data-state={document.noveltyStatus === 'passed' ? 'succeeded' : document.noveltyStatus === 'rejected' ? 'rejected' : 'pending'}>
                <td><span class="nm">{document.title}</span><span class="sub"><Id value={document.documentCode} /> · {document.role}</span></td>
                <td>{document.topicName}<span class="sub"><Id value={document.topicCode} /></span></td>
                <td>{document.documentType.replaceAll('_', ' ')}</td>
                <td class="n">{document.wordCount}</td>
                <td class="n"><Bar value={document.maxSimilarity} below={document.maxSimilarity >= (dataForge?.noveltyThreshold ?? 1)} /></td>
                <td><Badge state={document.noveltyStatus === 'passed' ? 'passed' : document.noveltyStatus === 'rejected' ? 'rejected' : 'review'}>{document.noveltyStatus}</Badge></td>
                <td><Badge state={document.reviewStatus}>{document.reviewStatus}</Badge></td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div class="m-empty">No data-forged documents yet.</div>}
      </TableBox>

      {documents.length ? <DocumentReviewQueue documents={documents} /> : null}

      <div class="m-split">
        <Panel title="Generation boundary" code="anti-benchmax">
          <p class="m-note">The generator sees topic name, description, verifier strategy, and requested count. It does not receive the original task, criterion text, reference answer, names, dates, or figures.</p>
        </Panel>
        <Panel title="Data forge configuration" code={dataForge?.dataForgeCode ?? 'not started'}>
          <Field label="Novelty threshold"><div class="m-input">{dataForge?.noveltyThreshold.toFixed(2) ?? '0.22'}</div></Field>
          <Field label="Auto approve"><div class="m-input">{dataForge?.autoApprove ? 'enabled' : 'disabled'}</div></Field>
          <Field label="Token usage"><div class="m-input">{dataForge ? `${(dataForge.inputTokens + dataForge.outputTokens).toLocaleString()} total` : '—'}</div></Field>
        </Panel>
      </div>
      <Handoff stage="forge" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

function ForgeConfig({
  benchmarkRun,
  dataForge,
  forgeJob,
  failureMapCode,
  backend,
  model,
  generationConfigured,
  canStart,
  promptRevisionId,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  dataForge: DataForgeSummary | null;
  forgeJob: JobRow | null;
  failureMapCode: string | null;
  backend: 'data_designer' | 'frontier';
  model: string;
  generationConfigured: boolean;
  canStart: boolean;
  promptRevisionId: number | null;
}) {
  const complete = Boolean(dataForge && dataForge.novelDocuments >= dataForge.requestedDocuments);
  const running = isLive(forgeJob);
  return (
    <section class="m-forge-card">
      <div class="m-forge-card-head">
        <div><h3>Data forge run</h3><p>Choose the generation path, then let the local novelty gate and human review queue decide what moves onward.</p></div>
        <span class="m-code">{dataForge ? dataForge.dataForgeCode : 'recommended path'}</span>
      </div>
      <form class="m-forge-form" hx-post="/ui/data-forge/start" hx-target="#data-forge-status" hx-swap="outerHTML" hx-disabled-elt="find button">
        <input type="hidden" name="benchmark_run_id" value={benchmarkRun ? String(benchmarkRun.benchmarkRunId) : ''} />
        <input id="forge-prompt-revision" type="hidden" name="prompt_revision_id" value={promptRevisionId ? String(promptRevisionId) : ''} />
        <div class="m-forge-field full"><label>Completed failure map + taxonomy</label><div class="m-input">{dataForge?.failureMapCode ?? failureMapCode ?? 'Failure map required before generation'}</div></div>
        <div class="m-forge-field"><label for="forge-backend">Generation backend</label><select id="forge-backend" name="backend" disabled={Boolean(dataForge)}>
          <option value="data_designer" selected={backend === 'data_designer'}>NVIDIA Data Designer</option>
          <option value="frontier" selected={backend === 'frontier'}>Direct frontier model</option>
        </select></div>
        <div class="m-forge-field"><label for="forge-model">Frontier API model</label><input id="forge-model" name="provider_model" value={dataForge?.providerModel ?? model} disabled={Boolean(dataForge)} /></div>
        <div class="m-forge-field"><label for="forge-docs">Documents per failure topic</label><input id="forge-docs" name="docs_per_topic" type="number" min="1" max="100" value={String(dataForge?.docsPerTopic ?? 3)} disabled={Boolean(dataForge)} /><span class="m-field-note">Each topic receives this many novel-document slots.</span></div>
        <div class="m-forge-field"><label for="forge-threshold">Max source similarity</label><input id="forge-threshold" name="novelty_threshold" type="number" min="0.01" max="0.99" step="0.01" value={String(dataForge?.noveltyThreshold ?? 0.22)} disabled={Boolean(dataForge)} /></div>
        <label class="m-forge-check full"><input name="auto_approve" type="checkbox" checked={Boolean(dataForge?.autoApprove)} disabled={Boolean(dataForge)} /><span><b>Auto-approve novel documents</b><small>Novel artifacts skip the manual review queue; rejected artifacts can never be approved.</small></span></label>
        <div class="m-forge-actions full">
          <button type="submit" disabled={!canStart}>{running ? 'Generation running…' : complete ? 'All slots filled' : dataForge ? 'Fill remaining slots' : 'Start data forge'}</button>
          {!generationConfigured ? <span class="m-field-note">Configure a generation model and API key in Settings first.</span> : null}
        </div>
      </form>
    </section>
  );
}

export function PromptCard({
  prompt,
  revisions,
  benchmarkRunId,
  promptRevisionLocked,
  notice = '',
  noticeKind = 'success',
}: {
  prompt: PromptRevision | null;
  revisions: PromptRevision[];
  benchmarkRunId: number | null;
  promptRevisionLocked: boolean;
  notice?: string;
  noticeKind?: 'success' | 'error';
}) {
  return (
    <section id="forge-prompt-card" class="m-forge-card m-prompt-card">
      <div class="m-forge-card-head">
        <div><h3>Document generation prompt</h3><p>{promptRevisionLocked ? 'This forge run is pinned to its original revision.' : 'Choose a revision to inspect or use for the next forge run.'}</p></div>
        <div class="m-prompt-tools">
          {revisions.length ? (
            <form class="m-prompt-revision-picker">
              <input type="hidden" name="benchmark_run_id" value={benchmarkRunId ? String(benchmarkRunId) : ''} />
              <select
                name="prompt_revision_id"
                data-prompt-revision
                aria-label="Document generation prompt revision"
                disabled={promptRevisionLocked}
                hx-get="/ui/data-forge/prompt"
                hx-trigger="change"
                hx-target="#forge-prompt-card"
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
          <button type="button" class="ghost compact m-prompt-settings" data-open-dialog="document-generation-prompt-editor" aria-label="Edit prompt" title="Edit prompt" disabled={!prompt}>
            <Icon name="settings" />
          </button>
        </div>
      </div>
      {notice ? <p class={`m-prompt-notice ${noticeKind === 'error' ? 'is-error' : ''}`}>{notice}</p> : null}
      {prompt ? <textarea class="m-ta m-prompt-editor" readonly>{prompt.body}</textarea> : <div class="m-empty">The document-generation prompt is missing.</div>}
      <p class="m-field-note">Saving creates a new immutable revision and makes it active. Existing forge runs stay pinned to their original revision.</p>
      {prompt ? (
        <dialog id="document-generation-prompt-editor" class="m-dialog m-prompt-dialog">
          <div class="m-dialog-head">
            <div>
              <span class="m-id">REV-{String(prompt.revisionNumber).padStart(5, '0')}</span>
              <strong>Edit document generation prompt</strong>
              <span class="m-dialog-sub">Save as a new revision; the current revision remains immutable.</span>
            </div>
            <button type="button" class="ghost compact" data-close-dialog aria-label="Close"><Icon name="close" /></button>
          </div>
          <form class="m-dialog-body m-prompt-form" hx-post="/ui/data-forge/prompt/revisions" hx-target="#forge-prompt-card" hx-swap="outerHTML" hx-disabled-elt="find button">
            <input type="hidden" name="benchmark_run_id" value={benchmarkRunId ? String(benchmarkRunId) : ''} />
            <input type="hidden" name="prompt_revision_id" value={String(prompt.promptRevisionId)} />
            <input type="hidden" name="prompt_key" value="document-generation" />
            <label class="m-prompt-label" for="document-generation-prompt-body">Prompt body</label>
            <textarea id="document-generation-prompt-body" name="body" class="m-ta m-prompt-dialog-editor" required>{prompt.body}</textarea>
            <label class="m-prompt-label" for="document-generation-model-hint">Model hint <span>(optional)</span></label>
            <input id="document-generation-model-hint" name="model_hint" value={prompt.modelHint} />
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

function DocumentReviewQueue({ documents }: { documents: DocumentRow[] }) {
  return (
    <section class="m-document-queue">
      <div class="m-cap"><h3>Document review queue</h3><span class="m-code">{documents.length} documents</span></div>
      <div class="m-document-grid">
        {documents.map((document) => (
          <article class="m-document-card" data-review={document.reviewStatus}>
            <header><div><h4>{document.title}</h4><span class="sub">{document.topicName} / {document.documentType.replaceAll('_', ' ')}</span></div><Badge state={document.noveltyStatus === 'passed' ? 'passed' : document.noveltyStatus === 'rejected' ? 'rejected' : 'review'}>{document.noveltyStatus}</Badge></header>
            <details><summary>Inspect generated task</summary><div class="m-document-content"><b>Source document</b><p>{document.content}</p><b>Task</b><p>{document.taskInstruction}</p><b>Hidden reference</b><p>{document.referenceAnswer}</p><b>Verifier targets</b><p>{document.verifierTargets.join(' · ')}</p></div></details>
            <div class="m-review-controls"><span class="m-field-note"><Id value={document.documentCode} /> · {document.wordCount} words</span><button type="button" data-document-review="approved" data-document-code={document.documentCode} disabled={document.noveltyStatus !== 'passed' || document.reviewStatus === 'approved'}>Approve</button><button type="button" data-document-review="rejected" data-document-code={document.documentCode} disabled={document.noveltyStatus === 'rejected' || document.reviewStatus === 'rejected'}>Reject</button></div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DataForgeStatus({
  runId,
  job,
  progress,
  refreshWhenReady = false,
}: {
  runId: number | null;
  job: JobRow | null;
  progress: BenchmarkRunProgress | null;
  refreshWhenReady?: boolean;
}) {
  const id = 'data-forge-status';
  if (runId && job && isLive(job)) {
    return <div id={id} class="m-analysis-status" hx-get={`/ui/data-forge/status?run=${runId}`} hx-trigger="every 1s" hx-swap="outerHTML"><Badge state="running">generation running</Badge><span>{job.step || 'Working'} · {job.jobCode}</span></div>;
  }
  if (runId && job?.status === 'failed') return <div id={id} class="m-analysis-status"><Badge state="failed">generation failed</Badge><span>{job.error || 'The data forge job failed.'}</span></div>;
  if (runId && progress?.dataForgeRun.entity && refreshWhenReady) return <div id={id} class="m-analysis-status" hx-get={`/forge?run=${runId}`} hx-trigger="load" hx-target="#workspace" hx-swap="innerHTML"><Badge state="ready">data forge ready</Badge><span>Refreshing the selected run…</span></div>;
  if (progress?.dataForgeRun.entity) return <div id={id} class="m-analysis-status"><Badge state="ready">data forge ready</Badge><span>{progress.dataForgeRun.entity}</span></div>;
  return <div id={id} class="m-analysis-status"><Badge state="pending">not started</Badge><span>Send a completed failure map here to create novel training documents.</span></div>;
}
