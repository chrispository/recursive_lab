import type { DataForgeSummary, DocumentRow } from '../../domain/data_forge/model.ts';
import { Id } from './Id.tsx';

type ReviewBucket = 'pending' | 'approved' | 'blocked';

function bucketOf(document: DocumentRow): ReviewBucket {
  if (document.noveltyStatus === 'rejected' || document.reviewStatus === 'rejected') return 'blocked';
  if (document.reviewStatus === 'approved') return 'approved';
  return 'pending';
}

function bucketLabel(bucket: ReviewBucket) {
  return bucket === 'pending' ? 'needs review' : bucket;
}

function ReviewBadge({ bucket }: { bucket: ReviewBucket }) {
  return <span class={`m-review-badge ${bucket}`}>{bucketLabel(bucket)}</span>;
}

function ReviewDetail({ document, selected, noveltyThreshold }: { document: DocumentRow; selected: boolean; noveltyThreshold: number }) {
  const bucket = bucketOf(document);
  const canApprove = document.noveltyStatus === 'passed' && document.reviewStatus !== 'approved';
  const canReject = document.noveltyStatus !== 'rejected' && document.reviewStatus !== 'rejected';
  const type = document.documentType.replaceAll('_', ' ');

  return (
    <article id={`review-detail-${document.documentCode}`} class="m-review-detail" data-review-detail={document.documentCode} hidden={!selected}>
      <div class="m-review-detail-head">
        <div>
          <div class="m-review-eyebrow">{document.topicName} / {type}</div>
          <h4>{document.title}</h4>
          <div class="m-review-meta">
            <span><Id value={document.documentCode} /></span>
            <span>{document.wordCount.toLocaleString()} words</span>
            <span>similarity {document.maxSimilarity.toFixed(2)} / max {noveltyThreshold.toFixed(2)}</span>
            <span>role {document.role}</span>
          </div>
        </div>
        <ReviewBadge bucket={bucket} />
      </div>

      <div class="m-review-tabs" role="tablist" aria-label={`Review ${document.documentCode}`}>
        <button type="button" class="is-active" data-review-tab="source" aria-selected="true">Source document</button>
        <button type="button" data-review-tab="task" aria-selected="false">Task</button>
        <button type="button" data-review-tab="reference" aria-selected="false">Hidden reference</button>
        <button type="button" data-review-tab="verifier" aria-selected="false">Verifier targets</button>
      </div>

      <div class="m-review-reading" data-review-tab-panel="source">
        <h5>Generated document</h5>
        <p>{document.content}</p>
      </div>
      <div class="m-review-reading" data-review-tab-panel="task" hidden>
        <h5>Instruction preview</h5>
        <p>{document.taskInstruction}</p>
      </div>
      <div class="m-review-reading" data-review-tab-panel="reference" hidden>
        <h5>Reference answer</h5>
        <p>{document.referenceAnswer}</p>
      </div>
      <div class="m-review-reading" data-review-tab-panel="verifier" hidden>
        <h5>Verifier targets</h5>
        <ul>
          {document.verifierTargets.map((target) => <li>{target}</li>)}
        </ul>
      </div>

      <div class="m-review-actions">
        <span><Id value={document.documentCode} /> · manual gate</span>
        <button
          type="button"
          class="danger compact"
          data-document-review="rejected"
          data-document-code={document.documentCode}
          disabled={!canReject}
        >Reject</button>
        <button
          type="button"
          class="compact"
          data-document-review="approved"
          data-document-code={document.documentCode}
          disabled={!canApprove}
        >{canApprove ? 'Approve & next' : 'Approved'}</button>
      </div>
    </article>
  );
}

export function FocusedReviewInbox({ benchmarkRunId, dataForge, documents }: { benchmarkRunId: number | null; dataForge: DataForgeSummary | null; documents: DocumentRow[] }) {
  const pending = documents.filter((document) => bucketOf(document) === 'pending');
  const approved = documents.filter((document) => bucketOf(document) === 'approved');
  const blocked = documents.filter((document) => bucketOf(document) === 'blocked');
  const topics = [...new Map(documents.map((document) => [document.topicCode, document.topicName])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1]));
  const initialBucket: ReviewBucket = pending.length ? 'pending' : approved.length ? 'approved' : 'blocked';
  const selected = (initialBucket === 'pending' ? pending : initialBucket === 'approved' ? approved : blocked)[0] ?? documents[0] ?? null;
  const complete = Boolean(dataForge && dataForge.novelDocuments >= dataForge.requestedDocuments);
  const handoffReady = complete && pending.length === 0 && blocked.length === 0;

  return (
    <details
      id="focused-review-inbox"
      class="m-review-inbox"
      data-review-inbox
      data-review-status-filter={initialBucket}
      data-review-selected={selected?.documentCode ?? ''}
      open
    >
      <summary class="m-review-inbox-head">
        <div>
          <h3>Focused review inbox</h3>
          <p>One queue, one document open, one decision at a time.</p>
        </div>
        <span class="m-review-head-tools">
          <span class="m-review-recommended">recommended</span>
          <span class="m-review-collapse"><span class="m-review-collapse-open">collapse</span><span class="m-review-collapse-closed">open</span></span>
        </span>
      </summary>

      <div class="m-review-decision-bar">
        <div class="m-review-decision-copy">
          <strong>{pending.length} novel document{pending.length === 1 ? '' : 's'} need a decision</strong>
          <p>Approve individually or clear the passed batch. Novelty failures are permanently blocked.</p>
        </div>
        <label class="m-review-auto">
          <input type="checkbox" checked={Boolean(dataForge?.autoApprove)} disabled />
          <span>Auto-approve future novel docs<small>Controlled by the data forge configuration.</small></span>
        </label>
        <div class="m-review-decision-actions">
          <button type="button" class="secondary compact" data-review-bulk="approved" disabled={!pending.length}>
            Approve all <span data-review-bulk-count>{pending.length}</span> passed
          </button>
          {handoffReady && benchmarkRunId ? (
            <a class="m-review-send compact" href={`/env-lab?run=${benchmarkRunId}`}>Send to Env Lab</a>
          ) : (
            <button type="button" class="compact" disabled title="Every requested slot must be novel and approved first">
              Send to Env Lab
            </button>
          )}
        </div>
      </div>

      <div class="m-review-split">
        <div class="m-review-queue">
          <div class="m-review-queue-tools" role="tablist" aria-label="Document review status">
            <label class="m-review-topic-filter">
              <span>Topic</span>
              <select data-review-topic-filter aria-label="Filter documents by topic">
                <option value="all">All topics</option>
                {topics.map(([code, name]) => <option value={code}>{name}</option>)}
              </select>
            </label>
            <button type="button" class={initialBucket === 'pending' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="pending" aria-pressed={initialBucket === 'pending' ? 'true' : 'false'}>
              Needs review {pending.length}
            </button>
            <button type="button" class={initialBucket === 'approved' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="approved" aria-pressed={initialBucket === 'approved' ? 'true' : 'false'}>
              Approved {approved.length}
            </button>
            <button type="button" class={initialBucket === 'blocked' ? 'm-review-filter is-active' : 'm-review-filter'} data-review-filter="blocked" aria-pressed={initialBucket === 'blocked' ? 'true' : 'false'}>
              Blocked {blocked.length}
            </button>
          </div>
          <div class="m-review-queue-list">
            {documents.map((document) => {
              const bucket = bucketOf(document);
              return (
                <button
                  type="button"
                  class={`m-review-queue-row ${document.documentCode === selected?.documentCode ? 'is-selected' : ''}`}
                  data-review-queue-row
                  data-review-select={document.documentCode}
                  data-review-status={bucket}
                  data-review-topic={document.topicCode}
                  aria-controls={`review-detail-${document.documentCode}`}
                  hidden={bucket !== initialBucket}
                >
                  <i class={`m-review-dot ${bucket}`} aria-hidden="true" />
                  <span>
                    <strong>{document.title}</strong>
                    <small><Id value={document.documentCode} /> / {document.topicName} / {document.wordCount.toLocaleString()} words</small>
                  </span>
                  <ReviewBadge bucket={bucket} />
                </button>
              );
            })}
            {documents.length ? <div class="m-review-empty" data-review-filter-empty hidden>No documents match these filters.</div> : <div class="m-review-empty">No data-forged documents yet. Start a run above to open the review inbox.</div>}
          </div>
        </div>

        <div class="m-review-details" aria-live="polite">
          {documents.map((document) => <ReviewDetail document={document} noveltyThreshold={dataForge?.noveltyThreshold ?? 0.22} selected={document.documentCode === selected?.documentCode} />)}
          {!documents.length ? <div class="m-review-empty m-review-empty-detail">A generated document will appear here after the forge run completes.</div> : null}
        </div>
      </div>
    </details>
  );
}
