import type { PromptRevision } from '../../domain/prompts/model.ts';
import type { DataForgeSummary, DocumentRow } from '../../domain/data_forge/model.ts';
import type { TopicRow } from '../../domain/topics/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { isLive, type JobRow } from '../../domain/jobs/model.ts';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { FocusedReviewInbox } from '../ui/FocusedReviewInbox.tsx';
import { Icon } from '../ui/Icon.tsx';
import { PromptCard } from '../ui/PromptCard.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';


function Help({ text }: { text: string }) {
  return <span class="m-help" title={text}><Icon name="help" label={text} /></span>;
}

export function DataForge({
  benchmarkRun,
  progress,
  availableRuns,
  dataForge,
  documents,
  topics,
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
  topics: TopicRow[];
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
      <RunContext
        benchmarkRun={benchmarkRun}
        availableRuns={availableRuns}
        failureTopics={progress?.topicCount}
      />

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

      {dataForge ? (
        <TableBox>
          <Cap title="Data forge ledger">
            <Tally items={[
              { value: dataForge.requestedDocuments, label: 'requested' },
              { value: dataForge.createdDocuments, label: 'created' },
              { value: dataForge.novelDocuments, label: 'novel', hot: true },
              { value: dataForge.rejectedDocuments, label: 'rejected' },
              { value: dataForge.pendingReview, label: 'review' },
            ]} />
          </Cap>
          <Table>
            <thead>
              <tr>
                <th>Data forge</th>
                <th>Failure map</th>
                <th class="n">Topics</th>
                <th>Backend</th>
                <th>Provider model</th>
                <th class="n">Docs/topic</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr data-state={running ? 'running' : dataForge.pendingReview ? 'pending' : complete ? 'succeeded' : 'failed'}>
                <td>
                  <span class="nm">{dataForge.dataForgeCode}</span>
                  <span class="sub">from {dataForge.failureMapCode}</span>
                </td>
                <td>{dataForge.failureMapCode}</td>
                <td class="n">{dataForge.topicCount}</td>
                <td>{dataForge.backend.replaceAll('_', ' ')}</td>
                <td><span class="m-id">{dataForge.providerModel}</span></td>
                <td class="n">{dataForge.docsPerTopic}</td>
                <td>
                  <Badge state={running ? 'running' : forgeJob?.status === 'failed' ? 'failed' : dataForge.pendingReview ? 'pending' : complete ? 'succeeded' : 'draft'}>
                    {running ? forgeJob?.step || 'generating' : forgeJob?.status === 'failed' ? 'failed' : dataForge.pendingReview ? 'review' : complete ? 'complete' : 'incomplete'}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </Table>
        </TableBox>
      ) : null}

      <TopicTable topics={topics} documents={documents} dataForge={dataForge} failureMapCode={progress?.failureMap.entity ?? null} />

      <FocusedReviewInbox benchmarkRunId={benchmarkRun?.benchmarkRunId ?? null} dataForge={dataForge} documents={documents} />

      <Handoff stage="forge" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}

function TopicTable({
  topics,
  documents,
  dataForge,
  failureMapCode,
}: {
  topics: TopicRow[];
  documents: DocumentRow[];
  dataForge: DataForgeSummary | null;
  failureMapCode: string | null;
}) {
  const docsByTopic = new Map<string, { total: number; novel: number; rejected: number }>();
  for (const document of documents) {
    const counts = docsByTopic.get(document.topicCode) ?? { total: 0, novel: 0, rejected: 0 };
    counts.total += 1;
    if (document.noveltyStatus === 'passed') counts.novel += 1;
    if (document.noveltyStatus === 'rejected' || document.reviewStatus === 'rejected') counts.rejected += 1;
    docsByTopic.set(document.topicCode, counts);
  }

  return (
    <TableBox>
      <Cap title="Topics" code={failureMapCode ?? undefined}>
        <Tally
          items={[
            { value: topics.length, label: 'topics' },
            { value: documents.length, label: 'docs' },
            ...(dataForge ? [
              { value: dataForge.novelDocuments, label: 'novel', hot: true },
              { value: Math.max(0, dataForge.requestedDocuments - dataForge.novelDocuments), label: 'slots open' },
            ] : []),
          ]}
        />
      </Cap>
      {topics.length ? (
        <Table>
          <thead>
            <tr>
              <th>Topic</th>
              <th>Id</th>
              <th class="n">Docs</th>
              <th class="n">Novel</th>
              <th class="n">Rejected</th>
              <th class="n">Target</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic) => {
              const counts = docsByTopic.get(topic.code) ?? { total: 0, novel: 0, rejected: 0 };
              return (
                <tr data-state={dataForge && counts.novel >= dataForge.docsPerTopic ? 'ready' : counts.total ? 'pending' : 'failed'}>
                  <td>
                    <span class="nm">{topic.name}</span>
                    <span class="sub">{topic.description}</span>
                  </td>
                  <td><span class="m-id">{topic.code}</span></td>
                  <td class="n">{counts.total}</td>
                  <td class="n">{counts.novel}</td>
                  <td class="n">{counts.rejected}</td>
                  <td class="n">{dataForge?.docsPerTopic ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <div class="m-empty">{failureMapCode ? 'No topics found for this failure map.' : 'Create a failure map to populate the topic list.'}</div>
      )}
    </TableBox>
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
        <div>
          <h3>Data forge run</h3>
          <p>Recommended: choose NVIDIA Data Designer; it calls the frontier LLM.</p>
        </div>
        <span class="m-code">{dataForge ? dataForge.dataForgeCode : 'recommended path'}</span>
      </div>
      <form class="m-forge-form" hx-post="/ui/data-forge/start" hx-target="#data-forge-status" hx-swap="outerHTML" hx-disabled-elt="find button">
        <input type="hidden" name="benchmark_run_id" value={benchmarkRun ? String(benchmarkRun.benchmarkRunId) : ''} />
        <input id="forge-prompt-revision" type="hidden" name="prompt_revision_id" value={promptRevisionId ? String(promptRevisionId) : ''} />
        <div class="m-forge-field full">
          <label>Completed failure map + taxonomy</label>
          <div class="m-input">{dataForge?.failureMapCode ?? failureMapCode ?? 'Failure map required before generation'}</div>
        </div>
        <div class="m-forge-field">
          <label for="forge-backend">Generation backend</label>
          <select id="forge-backend" name="backend" disabled={Boolean(dataForge)}>
            <option value="data_designer" selected={backend === 'data_designer'}>NVIDIA Data Designer</option>
            <option value="frontier" selected={backend === 'frontier'}>Direct frontier model</option>
          </select>
        </div>
        <div class="m-forge-field">
          <label for="forge-model">Frontier API model</label>
          <input id="forge-model" name="provider_model" value={dataForge?.providerModel ?? model} disabled={Boolean(dataForge)} />
        </div>
        <div class="m-forge-field">
          <label for="forge-docs">
            Documents per failure topic{' '}
            <Help text="Recommended value: 20. Each failure topic receives this many novel-document slots; higher values increase generation and review work." />
          </label>
          <input id="forge-docs" name="docs_per_topic" type="number" min="1" max="100" value={String(dataForge?.docsPerTopic ?? 3)} disabled={Boolean(dataForge)} />
        </div>

        <div class="m-forge-field">
          <label for="forge-threshold">
            Max source similarity{' '}
            <Help text="Recommended value: 0.22. Lower values enforce stricter novelty against the source criteria; higher values allow more similar documents through." />
          </label>
          <input id="forge-threshold" name="novelty_threshold" type="number" min="0.01" max="0.99" step="0.01" value={String(dataForge?.noveltyThreshold ?? 0.22)} disabled={Boolean(dataForge)} />
        </div>
        <div class="m-forge-actions full">
          <button type="submit" disabled={!canStart}>
            {running ? 'Generation running…' : complete ? 'All slots filled' : dataForge ? 'Fill remaining slots' : 'Start data forge'}
          </button>
          <label class="m-forge-check">
            <input name="auto_approve" type="checkbox" checked={Boolean(dataForge?.autoApprove)} disabled={Boolean(dataForge)} />
            <span>
              <b>Auto-approve novel documents</b>
              <small>Novel artifacts skip the manual review queue; rejected artifacts can never be approved.</small>
            </span>
          </label>
          {!generationConfigured ? <span class="m-field-note">Configure a generation model and API key in Settings first.</span> : null}
        </div>
      </form>
    </section>
  );
}

export { PromptCard } from '../ui/PromptCard.tsx';

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
    return (
      <div
        id={id}
        class="m-analysis-progress"
        role="status"
        aria-live="polite"
        hx-get={`/ui/data-forge/status?run=${runId}`}
        hx-trigger="every 1s"
        hx-swap="outerHTML"
      >
        <div class="m-analysis-progress-label">
          <span class="m-analysis-progress-step">{job.step || 'Working'}</span>
          <span class="m-id">{job.jobCode}</span>
        </div>
        <div class="m-analysis-progress-track" role="progressbar" aria-label="Generation in progress">
          <span class="m-analysis-progress-fill" aria-hidden="true" />
        </div>
      </div>
    );
  }
  if (runId && job?.status === 'failed') {
    return (
      <div id={id} class="m-analysis-status">
        <Badge state="failed">generation failed</Badge>
        <span>{job.error || 'The data forge job failed.'}</span>
      </div>
    );
  }
  if (runId && progress?.dataForgeRun.entity && refreshWhenReady) {
    return (
      <div id={id} class="m-analysis-status" hx-get={`/forge?run=${runId}`} hx-trigger="load" hx-target="#workspace" hx-swap="innerHTML">
        <Badge state="ready">data forge ready</Badge>
        <span>Refreshing the selected run…</span>
      </div>
    );
  }
  if (progress?.dataForgeRun.entity) {
    return <div id={id} class="m-analysis-status"><Badge state="ready">data forge ready</Badge><span>{progress.dataForgeRun.entity}</span></div>;
  }
  return <div id={id} class="m-analysis-status"><Badge state="pending">not started</Badge><span>Send a completed failure map here to create novel training documents.</span></div>;
}
