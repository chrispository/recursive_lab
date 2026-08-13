import type { DataForgeSummary, DocumentRow } from '../../domain/data_forge/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Bar } from '../ui/Bar.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Id } from '../ui/Id.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

export function DataForge({ dataForge, documents }: { dataForge: DataForgeSummary | null; documents: DocumentRow[] }) {
  return (
    <>
      <div class="m-title">
        <h2>Data forge novel training documents</h2>
        <p>Generation receives abstract capability specs only. Every artifact is fingerprinted against its benchmark lineage.</p>
      </div>

      <TableBox>
        <Cap title="Data forge run">
          <Tally items={[
            { value: dataForge?.requestedDocuments ?? 0, label: 'requested' },
            { value: dataForge?.createdDocuments ?? 0, label: 'created' },
            { value: dataForge?.novelDocuments ?? 0, label: 'novel', hot: true },
            { value: dataForge?.pendingReview ?? 0, label: 'review' },
          ]} />
        </Cap>
        {dataForge ? (
          <Table>
            <thead><tr><th>Data forge</th><th>Failure map</th><th class="n">Topics</th><th>Backend</th><th>Provider model</th><th class="n">Docs/topic</th><th>Status</th></tr></thead>
            <tbody><tr data-state={dataForge.pendingReview ? 'pending' : 'succeeded'}>
              <td><span class="nm">{dataForge.dataForgeCode}</span><span class="sub">from {dataForge.failureMapCode}</span></td>
              <td>{dataForge.failureMapCode}</td>
              <td class="n">{dataForge.topicCount}</td>
              <td>{dataForge.backend.replaceAll('_', ' ')}</td>
              <td><span class="m-id">{dataForge.providerModel}</span></td>
              <td class="n">{dataForge.docsPerTopic}</td>
              <td><Badge state={dataForge.pendingReview ? 'pending' : 'succeeded'}>{dataForge.pendingReview ? 'review' : 'complete'}</Badge></td>
            </tr></tbody>
          </Table>
        ) : <div class="m-empty">No data forge run for the current failure map.</div>}
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

      <div class="m-split">
        <Panel title="Generation boundary" code="anti-benchmax">
          <p class="m-note">The generator sees topic name, description, verifier strategy, and requested count. It does not receive the original task, criterion text, reference answer, names, dates, or figures.</p>
        </Panel>
        <Panel title="Data forge configuration" code={dataForge?.dataForgeCode ?? 'no run'}>
          <Field label="Novelty threshold"><div class="m-input">{dataForge?.noveltyThreshold.toFixed(2) ?? '—'}</div></Field>
          <Field label="Auto approve"><div class="m-input">{dataForge?.autoApprove ? 'enabled' : 'disabled'}</div></Field>
          <Field label="Token usage"><div class="m-input">{dataForge ? `${(dataForge.inputTokens + dataForge.outputTokens).toLocaleString()} total` : '—'}</div></Field>
        </Panel>
      </div>
    </>
  );
}
